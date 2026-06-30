// GitHub OAuth + stateless, HMAC-signed session tokens for the betternpm API.
//
// Flow: /v1/auth/github/start sets a short-lived, httpOnly state cookie and
// redirects to GitHub. /v1/auth/github/callback verifies the state cookie (CSRF),
// exchanges the code, fetches the GitHub user, and issues a signed session token
// delivered to the web app via URL fragment. The session token is verified on
// later requests (Authorization: Bearer) to attribute audits to a verified handle.

export interface GithubConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  webAppUrl: string;
  apiBaseUrl: string;
}

interface GithubEnv {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SIGNING_SECRET?: string;
  WEB_APP_URL?: string;
  API_BASE_URL?: string;
}

export function readGithubConfig(env: GithubEnv): GithubConfig | undefined {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SIGNING_SECRET) {
    return undefined;
  }

  return {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    sessionSecret: env.SESSION_SIGNING_SECRET,
    webAppUrl: env.WEB_APP_URL ?? "https://www.betternpm.org",
    apiBaseUrl: env.API_BASE_URL ?? "https://api.betternpm.org"
  };
}

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const STATE_COOKIE = "bnpm_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function redirectUri(config: GithubConfig): string {
  return `${config.apiBaseUrl}/v1/auth/github/callback`;
}

export function buildAuthorizeUrl(config: GithubConfig, state: string): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config));
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");
  return url.toString();
}

export function stateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/v1/auth; Max-Age=600`;
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/v1/auth; Max-Age=0`;
}

export function readStateCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie");

  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");

    if (name === STATE_COOKIE) {
      return rest.join("=");
    }
  }

  return undefined;
}

export async function exchangeCodeForToken(config: GithubConfig, code: string): Promise<string> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "betternpm-api"
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri(config)
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed (${response.status}).`);
  }

  const data = await response.json() as { access_token?: string; error_description?: string; error?: string };

  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "GitHub did not return an access token.");
  }

  return data.access_token;
}

export interface GithubUser {
  id: number;
  login: string;
  avatarUrl?: string;
}

export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "betternpm-api"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub user lookup failed (${response.status}).`);
  }

  const data = await response.json() as { id: number; login: string; avatar_url?: string };

  if (typeof data.id !== "number" || typeof data.login !== "string") {
    throw new Error("GitHub user response was malformed.");
  }

  return { id: data.id, login: data.login, avatarUrl: data.avatar_url };
}

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";

export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

// Kicks off the OAuth device flow for headless clients (the CLI). Returns a user
// code the person types at the verification URL. Needs "Enable Device Flow" on the
// GitHub OAuth app; otherwise GitHub returns an error here.
export async function startDeviceFlow(config: GithubConfig): Promise<DeviceFlowStart> {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "betternpm-api"
    },
    body: JSON.stringify({ client_id: config.clientId, scope: "read:user" })
  });

  const data = await response.json().catch(() => ({})) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    interval?: number;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
    const detail = data.error_description ?? data.error;

    if (data.error === "device_flow_disabled" || (detail ?? "").toLowerCase().includes("device flow")) {
      throw new Error("GitHub Device Flow is not enabled on the OAuth app. Turn on \"Enable Device Flow\" in the OAuth app settings, then retry.");
    }

    throw new Error(detail ? `GitHub device code request failed: ${detail}` : `GitHub device code request failed (${response.status}).`);
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: typeof data.interval === "number" ? data.interval : 5,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 900
  };
}

export type DeviceFlowPoll =
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "complete"; accessToken: string }
  | { status: "error"; error: string };

// Polls GitHub once for the device-flow token. The device flow is a public-client
// flow, so no client secret is sent here.
export async function pollDeviceFlow(config: GithubConfig, deviceCode: string): Promise<DeviceFlowPoll> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "betternpm-api"
    },
    body: JSON.stringify({
      client_id: config.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    })
  });

  const data = await response.json().catch(() => ({})) as {
    access_token?: string;
    error?: string;
    interval?: number;
    error_description?: string;
  };

  if (data.access_token) {
    return { status: "complete", accessToken: data.access_token };
  }

  switch (data.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down", interval: typeof data.interval === "number" ? data.interval : 10 };
    case "expired_token":
      return { status: "error", error: "The login code expired. Run the login command again." };
    case "access_denied":
      return { status: "error", error: "Authorization was denied." };
    default:
      return { status: "error", error: data.error_description ?? data.error ?? "GitHub device authorization failed." };
  }
}

export interface SessionClaims {
  login: string;
  id: number;
  iat: number;
  exp: number;
}

export async function signSession(secret: string, user: GithubUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { login: user.login, id: user.id, iat: now, exp: now + SESSION_TTL_SECONDS };
  const payload = base64url(JSON.stringify(claims));
  const signature = await hmac(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifySession(secret: string, token: string | undefined): Promise<SessionClaims | undefined> {
  if (!token) {
    return undefined;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return undefined;
  }

  const expected = await hmac(secret, payload);

  if (!timingSafeEqual(signature, expected)) {
    return undefined;
  }

  try {
    const claims = JSON.parse(base64urlDecode(payload)) as SessionClaims;

    if (typeof claims.login !== "string" || typeof claims.exp !== "number") {
      return undefined;
    }

    if (Math.floor(Date.now() / 1000) > claims.exp) {
      return undefined;
    }

    return claims;
  } catch {
    return undefined;
  }
}

export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");

  if (!header) {
    return undefined;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64urlBytes(new Uint8Array(signature));
}

function base64url(text: string): string {
  return base64urlBytes(new TextEncoder().encode(text));
}

function base64urlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
