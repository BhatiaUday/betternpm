import {
  createAuditRequestRecord,
  markAuditRequestCompleted,
  markAuditRequestFailed,
  markAuditRequestRunning,
  readAuditRequestRecord
} from "./audit-requests.js";
import { createAuditId, readAuditRecord, readAuditRecordById, readLatestAuditRecord, readLatestAuditForPackage, readAuditHistoryForPackage, writeAuditRecord } from "./audit-records.js";
import { buildPackageFacts, fetchPackageMetadata, fetchWeeklyDownloads, resolveVersion, searchNpmRegistry, type NpmSearchHit } from "./npm.js";
import { queryOsv } from "./osv.js";
import { defaultModelFor, runProviderAudit } from "./provider-audit.js";
import { createWorkspace } from "./workspace.js";
import { estimateCostUsd } from "./pricing.js";
import { incrementLeaderboard, readAuditedStatusForPackages, readLeaderboard, searchAudits } from "./leaderboard.js";
import { bearerToken, buildAuthorizeUrl, clearStateCookie, exchangeCodeForToken, fetchGithubUser, pollDeviceFlow, readGithubConfig, readStateCookie, signSession, startDeviceFlow, stateCookie, verifySession } from "./auth.js";
import { upsertAccount } from "./accounts.js";
import { SCANNER_PROFILE_VERSION, type AuditIdentity, type AuditProvider, type AuditRecord, type AuditTargetKind, type Finding, type OsvVulnerability, type PackageFacts, type RiskAssessment, type RiskLevel, type TokenUsage } from "./types.js";

interface AuditQueueMessage {
  requestId: string;
  target: AuditTargetKind;
  packageName: string;
  version: string;
  provider: Exclude<AuditProvider, "local">;
  model: string;
  apiKey: string;
  includeOsv: boolean;
  forceRefresh: boolean;
  username?: string;
}

export interface Env {
  DB: D1Database;
  AUDIT_QUEUE: Queue<AuditQueueMessage>;
  ALLOWED_ORIGINS?: string;
  API_RATE_LIMITER?: RateLimitBinding;
  AUDIT_RATE_LIMITER?: RateLimitBinding;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SIGNING_SECRET?: string;
  WEB_APP_URL?: string;
  API_BASE_URL?: string;
}

// Minimal shape of the Cloudflare Rate Limiting binding. Declared locally so the
// Worker does not depend on a specific @cloudflare/workers-types version.
interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface AuditRequest {
  target?: AuditTargetKind;
  packageName?: string;
  version?: string;
  integrity?: string;
  provider?: AuditProvider;
  model?: string;
  apiKey?: string;
  includeOsv?: boolean;
  forceRefresh?: boolean;
  username?: string;
  sessionToken?: string;
}

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const defaultAllowedOrigins = new Set([
  "https://betternpm.org",
  "https://www.betternpm.org",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:8787"
]);

/**
 * Best-effort abuse protection for the open, unauthenticated endpoints. Uses the
 * Cloudflare Rate Limiting binding keyed by client IP + collapsed route. Audit
 * creation (which can trigger paid provider calls) uses a stricter limiter. Fails
 * open: if the binding is unavailable or errors, the request proceeds.
 */
async function enforceRateLimit(request: Request, env: Env, url: URL): Promise<Response | undefined> {
  if (url.pathname === "/" || url.pathname === "/health") {
    return undefined;
  }

  const isAuditCreate = request.method === "POST" && url.pathname === "/v1/audit-requests";
  const limiter = isAuditCreate ? env.AUDIT_RATE_LIMITER : env.API_RATE_LIMITER;

  if (!limiter) {
    return undefined;
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const key = `${ip}:${routeBucket(request.method, url.pathname)}`;

  try {
    const { success } = await limiter.limit({ key });

    if (!success) {
      return json({ error: "Rate limit exceeded. Please slow down and try again shortly." }, 429, request, env);
    }
  } catch {
    // Fail open on limiter errors so a limiter outage never takes down the API.
    return undefined;
  }

  return undefined;
}

function routeBucket(method: string, pathname: string): string {
  const collapsed = pathname
    .replace(/^\/v1\/audit-requests\/[^/]+$/, "/v1/audit-requests/:id")
    .replace(/^\/v1\/packages\/.+\/versions$/, "/v1/packages/:pkg/versions")
    .replace(/^\/v1\/packages\/.+\/audits$/, "/v1/packages/:pkg/audits")
    .replace(/^\/v1\/packages\/.+\/[^/]+\/summary$/, "/v1/packages/:pkg/:version/summary")
    .replace(/^\/v1\/packages\/.+\/[^/]+\/audit$/, "/v1/packages/:pkg/:version/audit");

  return `${method} ${collapsed}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env)
      });
    }

    const rateLimited = await enforceRateLimit(request, env, url);
    if (rateLimited) {
      return rateLimited;
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "betternpm-api",
        endpoints: {
          health: "/health",
          audits: "/v1/audits",
          auditRequests: "/v1/audit-requests",
          packageVersions: "/v1/packages/:package/versions",
          packageSummary: "/v1/packages/:package/:version/summary",
          packageAudits: "/v1/packages/:package/audits",
          leaderboard: "/v1/leaderboard",
          search: "/v1/search?q=",
          registrySearch: "/v1/registry-search?q=",
          githubLogin: "/v1/auth/github/start",
          cliLogin: "/v1/auth/cli/start"
        }
      }, 200, request, env);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "betternpm-api" }, 200, request, env);
    }

    const summaryMatch = url.pathname.match(/^\/v1\/packages\/(.+)\/([^/]+)\/summary$/);
    if (request.method === "GET" && summaryMatch) {
      const packageName = decodeURIComponent(summaryMatch[1] ?? "");
      const version = decodeURIComponent(summaryMatch[2] ?? "");

      return getPackageSummary(request, url, env, packageName, version);
    }

    const packageAuditMatch = url.pathname.match(/^\/v1\/packages\/(.+)\/([^/]+)\/audit$/);
    if (request.method === "GET" && packageAuditMatch) {
      const packageName = decodeURIComponent(packageAuditMatch[1] ?? "");
      const version = decodeURIComponent(packageAuditMatch[2] ?? "");

      return getPackageAudit(request, url, env, packageName, version);
    }

    const versionsMatch = url.pathname.match(/^\/v1\/packages\/(.+)\/versions$/);
    if (request.method === "GET" && versionsMatch) {
      return getPackageVersions(request, env, decodeURIComponent(versionsMatch[1] ?? ""));
    }

    const packageAuditsMatch = url.pathname.match(/^\/v1\/packages\/(.+)\/audits$/);
    if (request.method === "GET" && packageAuditsMatch) {
      return getPackageAudits(request, env, decodeURIComponent(packageAuditsMatch[1] ?? ""));
    }

    if (request.method === "POST" && url.pathname === "/v1/audits") {
      return getAudit(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/audit-requests") {
      return createAuditRequest(request, env);
    }

    const auditRequestMatch = url.pathname.match(/^\/v1\/audit-requests\/([^/]+)$/);
    if (request.method === "GET" && auditRequestMatch) {
      return getAuditRequest(request, env, decodeURIComponent(auditRequestMatch[1] ?? ""));
    }

    if (request.method === "GET" && url.pathname === "/v1/leaderboard") {
      return getLeaderboard(request, env, url);
    }

    if (request.method === "GET" && url.pathname === "/v1/search") {
      return getSearch(request, env, url);
    }

    if (request.method === "GET" && url.pathname === "/v1/registry-search") {
      return getRegistrySearch(request, env, url);
    }

    if (request.method === "GET" && url.pathname === "/v1/auth/github/start") {
      return authGithubStart(request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/auth/github/callback") {
      return authGithubCallback(request, env, url);
    }

    if (request.method === "GET" && url.pathname === "/v1/auth/me") {
      return authMe(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/auth/cli/start") {
      return authCliStart(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/auth/cli/poll") {
      return authCliPoll(request, env);
    }

    return json({ error: "Not found" }, 404, request, env);
  },

  async queue(batch: MessageBatch<AuditQueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processAuditQueueMessage(message.body, env);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: "audit_queue_message_failed",
          messageId: message.id,
          requestId: message.body.requestId,
          attempts: message.attempts,
          error: errorMessage(error)
        }));

        if (message.attempts >= 3) {
          try {
            await markAuditRequestFailed(env.DB, {
              id: message.body.requestId,
              error: errorMessage(error),
              now: new Date().toISOString()
            });
            message.ack();
          } catch {
            message.retry({ delaySeconds: 300 });
          }
        } else {
          message.retry({ delaySeconds: Math.min(300, 30 * message.attempts) });
        }
      }
    }
  }
};

async function getPackageSummary(request: Request, url: URL, env: Env, packageName: string, version: string): Promise<Response> {
  const provider = parseProvider(url.searchParams.get("provider")) ?? "local";
  const target = parseTarget(url.searchParams.get("target")) ?? "npx";
  const model = url.searchParams.get("model") ?? SCANNER_PROFILE_VERSION;
  const scannerProfile = url.searchParams.get("scannerProfile") ?? SCANNER_PROFILE_VERSION;
  const integrity = url.searchParams.get("integrity");
  const record = integrity
    ? await readAuditRecord(env.DB, { target, packageName, version, integrity, scannerProfile, provider, model })
    : await readLatestAuditRecord({ db: env.DB, target, packageName, version, scannerProfile, provider, model });

  return json({
    target,
    packageName,
    version,
    cached: Boolean(record),
    audit: record ?? null
  }, 200, request, env);
}

async function getPackageAudit(request: Request, url: URL, env: Env, packageName: string, version: string): Promise<Response> {
  if (!packageName || !version) {
    return json({ error: "packageName and version are required" }, 400, request, env);
  }

  const target = parseTarget(url.searchParams.get("target"));
  const record = await readLatestAuditForPackage({ db: env.DB, packageName, version, target: target ?? undefined });

  return json({
    packageName,
    version,
    cached: Boolean(record),
    audit: record ?? null
  }, 200, request, env);
}

async function getPackageVersions(request: Request, env: Env, packageName: string): Promise<Response> {
  if (!packageName) {
    return json({ error: "packageName is required" }, 400, request, env);
  }

  try {
    const metadata = await fetchPackageMetadata(packageName);
    const distTags = metadata["dist-tags"] ?? {};
    const time = metadata.time ?? {};
    const versions = Object.keys(metadata.versions ?? {}).sort((a, b) => {
      const timeA = time[a];
      const timeB = time[b];

      if (timeA && timeB) {
        return timeB.localeCompare(timeA);
      }

      return b.localeCompare(a, undefined, { numeric: true });
    }).slice(0, 300);

    return json({
      name: metadata.name,
      latest: distTags.latest,
      distTags,
      versions
    }, 200, request, env);
  } catch (error) {
    return json({ error: `Unable to resolve "${packageName}" on the npm registry.`, detail: errorMessage(error) }, 404, request, env);
  }
}

async function getPackageAudits(request: Request, env: Env, packageName: string): Promise<Response> {
  if (!packageName) {
    return json({ error: "packageName is required" }, 400, request, env);
  }

  const audits = await readAuditHistoryForPackage(env.DB, packageName, 50);
  return json({ packageName, audits }, 200, request, env);
}

async function getAudit(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => undefined) as AuditRequest | undefined;

  if (!body?.packageName) {
    return json({ error: "packageName is required" }, 400, request, env);
  }

  const provider = parseProvider(body.provider ?? null);

  if (!provider) {
    return json({ error: "provider must be local, anthropic, or openai." }, 400, request, env);
  }

  const target = parseTarget(body.target ?? null);

  if (!target) {
    return json({ error: "target must be npx or npm-install." }, 400, request, env);
  }

  const metadata = await fetchPackageMetadata(body.packageName);
  const versionMetadata = resolveVersion(metadata, body.version);
  const integrity = versionMetadata.dist?.integrity ?? versionMetadata.dist?.shasum ?? "no-integrity";

  if (body.integrity && body.integrity !== integrity) {
    return json({
      error: "Provided integrity does not match npm registry metadata.",
      expectedIntegrity: integrity
    }, 409, request, env);
  }

  const identity: AuditIdentity = {
    target,
    packageName: versionMetadata.name,
    version: versionMetadata.version,
    integrity,
    scannerProfile: SCANNER_PROFILE_VERSION,
    provider,
    model: body.model ?? defaultModelFor(provider)
  };
  const audit = await readAuditRecord(env.DB, identity);

  if (!audit) {
    return json({
      cached: false,
      audit: null,
      error: "Audit is not cached. Submit /v1/audit-requests to enqueue an AI audit."
    }, 404, request, env);
  }

  return json({ cached: true, refreshed: false, audit }, 200, request, env);
}

async function createAuditRequest(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => undefined) as AuditRequest | undefined;

  if (!body?.packageName) {
    return json({ error: "packageName is required" }, 400, request, env);
  }

  const target = parseTarget(body.target ?? null) ?? "npm-install";
  const provider = parseProvider(body.provider ?? null);

  if (!provider || provider === "local") {
    return json({ error: "Queued audits require provider anthropic or openai." }, 400, request, env);
  }

  const session = await resolveSession(request, env, body.sessionToken);
  // Attribution is GitHub-only: a verified session sets the handle. Any free-text
  // `username` in the request body is ignored, so handles can't be self-asserted.
  const username = session?.login;

  const requestIp = clientIp(request);
  const model = body.model ?? defaultModelFor(provider);
  const requestedVersion = body.version ?? "latest";
  const metadata = await fetchPackageMetadata(body.packageName);
  const versionMetadata = resolveVersion(metadata, requestedVersion);
  const integrity = versionMetadata.dist?.integrity ?? versionMetadata.dist?.shasum ?? "no-integrity";
  const identity: AuditIdentity = {
    target,
    packageName: versionMetadata.name,
    version: versionMetadata.version,
    integrity,
    scannerProfile: SCANNER_PROFILE_VERSION,
    provider,
    model
  };
  const cached = await readAuditRecord(env.DB, identity);

  if (cached && body.forceRefresh !== true) {
    return json({ queued: false, cached: true, audit: cached }, 200, request, env);
  }

  if (!body.apiKey) {
    return json({ error: "apiKey is required to enqueue an AI audit. The key is held only in the queue message and is not stored in D1." }, 400, request, env);
  }

  const now = new Date().toISOString();
  const auditRequest = await createAuditRequestRecord(env.DB, {
    id: crypto.randomUUID(),
    target,
    packageName: body.packageName,
    version: requestedVersion,
    provider,
    model,
    scannerProfile: SCANNER_PROFILE_VERSION,
    requestedByUserId: username,
    requestIp,
    now
  });

  const message: AuditQueueMessage = {
    requestId: auditRequest.id,
    target,
    packageName: body.packageName,
    version: requestedVersion,
    provider,
    model,
    apiKey: body.apiKey,
    includeOsv: body.includeOsv ?? true,
    forceRefresh: body.forceRefresh === true,
    username
  };

  await env.AUDIT_QUEUE.send(message, { contentType: "json" });

  return json({ queued: true, request: auditRequest }, 202, request, env);
}

async function getAuditRequest(request: Request, env: Env, id: string): Promise<Response> {
  const auditRequest = await readAuditRequestRecord(env.DB, id);

  if (!auditRequest) {
    return json({ error: "Audit request not found." }, 404, request, env);
  }

  const audit = auditRequest.auditId ? await readAuditRecordById(env.DB, auditRequest.auditId) : undefined;

  return json({ request: auditRequest, audit: audit ?? null }, 200, request, env);
}

async function processAuditQueueMessage(message: AuditQueueMessage, env: Env): Promise<void> {
  const auditRequest = await readAuditRequestRecord(env.DB, message.requestId);

  if (!auditRequest || auditRequest.status === "completed") {
    return;
  }

  await markAuditRequestRunning(env.DB, message.requestId, new Date().toISOString());

  const result = await runAudit({
    target: message.target,
    packageName: message.packageName,
    version: message.version,
    provider: message.provider,
    model: message.model,
    apiKey: message.apiKey,
    includeOsv: message.includeOsv,
    forceRefresh: message.forceRefresh,
    username: message.username
  }, env);

  await markAuditRequestCompleted(env.DB, {
    id: message.requestId,
    auditId: result.audit.id,
    now: new Date().toISOString()
  });
}

async function runAudit(input: {
  target: AuditTargetKind;
  packageName: string;
  version?: string;
  integrity?: string;
  provider: Exclude<AuditProvider, "local">;
  model: string;
  apiKey: string;
  includeOsv: boolean;
  forceRefresh: boolean;
  username?: string;
}, env: Env): Promise<{ cached: boolean; refreshed: boolean; audit: AuditRecord; status: number }> {
  const forceRefresh = input.forceRefresh;

  const metadata = await fetchPackageMetadata(input.packageName);
  const versionMetadata = resolveVersion(metadata, input.version);
  const integrity = versionMetadata.dist?.integrity ?? versionMetadata.dist?.shasum ?? "no-integrity";

  if (input.integrity && input.integrity !== integrity) {
    throw new AuditError("Provided integrity does not match npm registry metadata.", 409, { expectedIntegrity: integrity });
  }

  const identity: AuditIdentity = {
    target: input.target,
    packageName: versionMetadata.name,
    version: versionMetadata.version,
    integrity,
    scannerProfile: SCANNER_PROFILE_VERSION,
    provider: input.provider,
    model: input.model
  };
  const cached = await readAuditRecord(env.DB, identity);

  if (cached && !forceRefresh) {
    return { cached: true, refreshed: false, audit: cached, status: 200 };
  }

  const [downloads, vulnerabilities] = await Promise.all([
    fetchWeeklyDownloads(versionMetadata.name),
    input.includeOsv ? safeQueryOsv(versionMetadata.name, versionMetadata.version) : Promise.resolve([])
  ]);

  if (!versionMetadata.dist?.tarball) {
    throw new AuditError(`No downloadable tarball found for ${versionMetadata.name}@${versionMetadata.version}.`, 422);
  }

  const workspace = await createWorkspace({
    tarballUrl: versionMetadata.dist.tarball,
    integrity,
    repository: versionMetadata.repository ?? metadata.repository,
    gitHead: versionMetadata.gitHead
  });
  const facts = buildPackageFacts({
    requested: input.packageName,
    metadata,
    versionMetadata,
    downloads,
    vulnerabilities,
    sourceScan: workspace.summary()
  });
  const providerRisk = await runProviderAudit({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    target: input.target,
    facts,
    workspace
  });
  const risk = floorRisk(providerRisk.risk, facts);
  const auditedAt = new Date().toISOString();
  const audit = {
    id: await createAuditId(identity),
    identity,
    facts,
    risk,
    auditedAt,
    requestedByUserId: input.username,
    createdAt: auditedAt
  };

  await writeAuditRecord(env.DB, audit);

  if (input.username) {
    await recordLeaderboardUsage(env, input.username, input.provider, input.model, providerRisk.usage, auditedAt);
  }

  return { cached: false, refreshed: Boolean(cached), audit, status: cached ? 200 : 201 };
}

function clientIp(request: Request): string | undefined {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? undefined;
}

async function recordLeaderboardUsage(
  env: Env,
  username: string,
  provider: Exclude<AuditProvider, "local">,
  model: string,
  usage: TokenUsage | undefined,
  now: string
): Promise<void> {
  try {
    const tokens = usage ?? { inputTokens: 0, outputTokens: 0 };
    const costUsd = estimateCostUsd(provider, model, tokens);
    await incrementLeaderboard(env.DB, {
      username,
      costUsd,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      now
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "leaderboard_increment_failed", username, error: errorMessage(error) }));
  }
}

async function authGithubStart(request: Request, env: Env): Promise<Response> {
  const config = readGithubConfig(env);

  if (!config) {
    return json({ error: "GitHub login is not configured on this server." }, 503, request, env);
  }

  const state = crypto.randomUUID();

  return new Response(null, {
    status: 302,
    headers: {
      location: buildAuthorizeUrl(config, state),
      "set-cookie": stateCookie(state),
      "cache-control": "no-store"
    }
  });
}

async function authGithubCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const config = readGithubConfig(env);

  if (!config) {
    return json({ error: "GitHub login is not configured on this server." }, 503, request, env);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = readStateCookie(request);

  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectToWebAuth(config.webAppUrl, "error=auth_failed&message=Sign-in could not be verified. Please try again.");
  }

  try {
    const accessToken = await exchangeCodeForToken(config, code);
    const user = await fetchGithubUser(accessToken);
    await upsertAccount(env.DB, { githubId: user.id, login: user.login, avatarUrl: user.avatarUrl, now: new Date().toISOString() });
    const token = await signSession(config.sessionSecret, user);
    return redirectToWebAuth(config.webAppUrl, `token=${encodeURIComponent(token)}&login=${encodeURIComponent(user.login)}`);
  } catch (error) {
    console.error(JSON.stringify({ event: "github_oauth_failed", error: errorMessage(error) }));
    return redirectToWebAuth(config.webAppUrl, "error=auth_failed&message=GitHub sign-in failed. Please try again.");
  }
}

function redirectToWebAuth(webAppUrl: string, fragment: string): Response {
  const target = new URL(`${webAppUrl}/auth/callback`);
  target.hash = fragment;
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      "set-cookie": clearStateCookie(),
      "cache-control": "no-store"
    }
  });
}

async function authMe(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  return json({ authenticated: Boolean(session), login: session?.login ?? null }, 200, request, env);
}

// CLI GitHub login uses the OAuth device flow: the CLI calls /start to get a user
// code + verification URL, the user authorizes in a browser, and the CLI polls
// /poll until a signed betternpm session token is issued. Requires "Enable Device
// Flow" on the GitHub OAuth app.
async function authCliStart(request: Request, env: Env): Promise<Response> {
  const config = readGithubConfig(env);

  if (!config) {
    return json({ error: "GitHub login is not configured on this server." }, 503, request, env);
  }

  try {
    const flow = await startDeviceFlow(config);
    return json({
      deviceCode: flow.deviceCode,
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
      interval: flow.interval,
      expiresIn: flow.expiresIn
    }, 200, request, env);
  } catch (error) {
    return json({ error: errorMessage(error) }, 502, request, env);
  }
}

async function authCliPoll(request: Request, env: Env): Promise<Response> {
  const config = readGithubConfig(env);

  if (!config) {
    return json({ error: "GitHub login is not configured on this server." }, 503, request, env);
  }

  const body = await request.json().catch(() => undefined) as { deviceCode?: string } | undefined;

  if (!body?.deviceCode) {
    return json({ error: "deviceCode is required." }, 400, request, env);
  }

  const poll = await pollDeviceFlow(config, body.deviceCode);

  if (poll.status === "pending") {
    return json({ status: "pending" }, 200, request, env);
  }

  if (poll.status === "slow_down") {
    return json({ status: "slow_down", interval: poll.interval }, 200, request, env);
  }

  if (poll.status === "error") {
    return json({ status: "error", error: poll.error }, 200, request, env);
  }

  try {
    const user = await fetchGithubUser(poll.accessToken);
    await upsertAccount(env.DB, { githubId: user.id, login: user.login, avatarUrl: user.avatarUrl, now: new Date().toISOString() });
    const token = await signSession(config.sessionSecret, user);
    return json({ status: "complete", token, login: user.login }, 200, request, env);
  } catch (error) {
    return json({ status: "error", error: errorMessage(error) }, 200, request, env);
  }
}

async function resolveSession(request: Request, env: Env, bodyToken?: string): Promise<{ login: string } | undefined> {
  const config = readGithubConfig(env);

  if (!config) {
    return undefined;
  }

  const claims = await verifySession(config.sessionSecret, bearerToken(request) ?? bodyToken);
  return claims ? { login: claims.login } : undefined;
}

async function getLeaderboard(request: Request, env: Env, url: URL): Promise<Response> {
  const limit = clampLimit(url.searchParams.get("limit"), 25, 100);
  const leaderboard = await readLeaderboard(env.DB, limit);
  return json({ leaderboard }, 200, request, env);
}

async function getSearch(request: Request, env: Env, url: URL): Promise<Response> {
  const query = (url.searchParams.get("q") ?? "").trim();

  if (query.length < 2) {
    return json({ query, results: [] }, 200, request, env);
  }

  const limit = clampLimit(url.searchParams.get("limit"), 25, 50);
  const results = await searchAudits(env.DB, query, limit);
  return json({ query, results }, 200, request, env);
}

async function getRegistrySearch(request: Request, env: Env, url: URL): Promise<Response> {
  const query = (url.searchParams.get("q") ?? "").trim();

  if (query.length < 2) {
    return json({ query, results: [] }, 200, request, env);
  }

  const limit = clampLimit(url.searchParams.get("limit"), 20, 30);
  let hits: NpmSearchHit[];

  try {
    hits = await searchNpmRegistry(query, limit);
  } catch (error) {
    return json({ error: "npm registry search is unavailable. Try again shortly.", detail: errorMessage(error) }, 502, request, env);
  }

  const statuses = await readAuditedStatusForPackages(env.DB, hits.map((hit) => hit.name));
  const results = hits.map((hit) => {
    const status = statuses.get(hit.name);
    return {
      name: hit.name,
      version: hit.version,
      description: hit.description,
      date: hit.date,
      publisher: hit.publisher,
      links: hit.links,
      audited: Boolean(status),
      audit: status
        ? { version: status.version, riskLevel: status.riskLevel, score: status.score, auditedAt: status.auditedAt }
        : null
    };
  });

  return json({ query, results }, 200, request, env);
}

function clampLimit(value: string | null, fallback: number, max: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

async function safeQueryOsv(name: string, version: string): Promise<OsvVulnerability[]> {
  try {
    return await queryOsv(name, version);
  } catch {
    return [];
  }
}

function parseProvider(value: string | null): AuditProvider | undefined {
  if (value === "local" || value === "anthropic" || value === "openai") {
    return value;
  }

  return undefined;
}

function parseTarget(value: string | null): AuditTargetKind | undefined {
  if (value === "npx" || value === "npm-install") {
    return value;
  }

  return undefined;
}

function json(data: unknown, status = 200, request?: Request, env?: Env): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...jsonHeaders,
      ...(request && env ? corsHeaders(request, env) : {})
    }
  });
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };

  if (origin && isAllowedOrigin(origin, env)) {
    headers["access-control-allow-origin"] = origin;
  }

  return headers;
}

function isAllowedOrigin(origin: string, env: Env): boolean {
  const configured = env.ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return defaultAllowedOrigins.has(origin) || configured.includes(origin);
}

class AuditError extends Error {
  constructor(message: string, readonly status: number, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "blocked"];

function atLeast(current: RiskLevel, floor: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(floor) > RISK_ORDER.indexOf(current) ? floor : current;
}

function scoreCeiling(level: RiskLevel): number {
  switch (level) {
    case "blocked": return 25;
    case "high": return 55;
    case "medium": return 85;
    case "low": return 100;
  }
}

// One-way safety net: hard, unambiguous signals can only RAISE the AI verdict, never lower it.
// Defends against prompt-injected "low" verdicts and missed install-script risk.
function floorRisk(risk: RiskAssessment, facts: PackageFacts): RiskAssessment {
  const scripts = facts.scripts ?? {};
  const installScripts = ["preinstall", "install", "postinstall"].filter((name) => scripts[name]);
  const dangerousInstall = installScripts.some((name) => /\b(curl|wget|bash|sh|node\s+-e|eval|base64|child_process|powershell)\b|https?:\/\//i.test(scripts[name] ?? ""));
  const findings: Finding[] = [...risk.findings];
  let level = risk.level;

  if (facts.vulnerabilities.length > 0) {
    level = atLeast(level, "high");
    findings.push({ severity: "high", code: "dependency-risk", title: "Known vulnerabilities (OSV)", detail: facts.vulnerabilities.slice(0, 3).map((vuln) => vuln.id).join(", ") });
  }

  if (dangerousInstall) {
    level = atLeast(level, "blocked");
    findings.push({ severity: "blocked", code: "install-script", title: "Install lifecycle script runs network/shell/dynamic code" });
  } else if (installScripts.length > 0) {
    level = atLeast(level, "medium");
  }

  if (level === risk.level) {
    return risk;
  }

  return { ...risk, level, score: Math.min(risk.score, scoreCeiling(level)), findings };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
