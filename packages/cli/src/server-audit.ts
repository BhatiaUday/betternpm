import type { PackageInspection } from "betternpm-core";
import type { BetterNpxConfig } from "./config.js";
import { getProviderKey } from "./credentials.js";

export type ServerRiskLevel = "low" | "medium" | "high" | "blocked";

export interface ServerAuditRecord {
  identity: {
    target: string;
    packageName: string;
    version: string;
    integrity: string;
    scannerProfile: string;
    provider: string;
    model: string;
  };
  risk: {
    level: ServerRiskLevel;
    score: number;
    findings: Array<{ severity: string; code: string; title: string; detail?: string }>;
  };
  auditedAt?: string;
  createdAt: string;
  requestedByUserId?: string;
}

export interface ServerAuditResult {
  cached: boolean;
  refreshed?: boolean;
  audit: ServerAuditRecord;
}

interface QueuedAuditRequestRecord {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
}

interface QueueAuditResponse {
  queued?: boolean;
  cached?: boolean;
  request?: QueuedAuditRequestRecord;
  audit?: ServerAuditRecord | null;
  error?: string;
}

interface PollAuditResponse {
  request: QueuedAuditRequestRecord;
  audit: ServerAuditRecord | null;
}

export interface RunServerAuditOptions {
  forceRefresh?: boolean;
  target?: "npx" | "npm-install";
  inlineApiKey?: string;
  onBeforeProviderCharge?: (info: { provider: string; model?: string }) => Promise<boolean>;
}

export type ServerAuditUnavailableReason = "provider-disabled" | "key-missing" | "declined";

export type ServerAuditOutcome =
  | { status: "completed"; result: ServerAuditResult }
  | { status: "unavailable"; reason: ServerAuditUnavailableReason };

export async function runServerAudit(
  inspection: PackageInspection,
  config: BetterNpxConfig,
  options: RunServerAuditOptions = {}
): Promise<ServerAuditOutcome> {
  if (config.llmProvider === "none") {
    return { status: "unavailable", reason: "provider-disabled" };
  }

  const body = {
    target: options.target ?? "npx",
    packageName: inspection.facts.name,
    version: inspection.facts.version,
    integrity: inspection.facts.integrity,
    provider: config.llmProvider,
    model: config.llmModel,
    username: config.username,
    forceRefresh: options.forceRefresh === true
  };

  const firstResponse = await postAuditRequest(config.auditServerUrl, body);

  if (firstResponse.ok) {
    const result = await normalizeQueueResponse(await firstResponse.json() as QueueAuditResponse, config.auditServerUrl);
    return { status: "completed", result };
  }

  const firstError = await firstResponse.text();

  if (firstResponse.status !== 400 || !firstError.includes("apiKey is required")) {
    throw new Error(friendlyProviderError(firstResponse.status, firstError, config.llmProvider));
  }

  // The package has no cached community audit, and the server needs a key to run an AI audit.
  // With no local key, report unavailable so the caller can fall back to static analysis.
  const apiKey = await resolveApiKey(config, options.inlineApiKey);

  if (!apiKey) {
    return { status: "unavailable", reason: "key-missing" };
  }

  // A fresh audit will spend money on the user's BYOK key. Give the caller a chance
  // to confirm (or veto via a cost cap) before we actually trigger the provider call.
  if (options.onBeforeProviderCharge) {
    const approved = await options.onBeforeProviderCharge({ provider: config.llmProvider, model: config.llmModel });

    if (!approved) {
      return { status: "unavailable", reason: "declined" };
    }
  }

  const response = await postAuditRequest(config.auditServerUrl, { ...body, apiKey });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(friendlyProviderError(response.status, text, config.llmProvider));
  }

  const result = await normalizeQueueResponse(await response.json() as QueueAuditResponse, config.auditServerUrl);
  return { status: "completed", result };
}

function postAuditRequest(auditServerUrl: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${auditServerUrl.replace(/\/$/, "")}/v1/audit-requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function resolveApiKey(config: BetterNpxConfig, inlineApiKey?: string): Promise<string | undefined> {
  if (inlineApiKey && inlineApiKey.trim()) {
    return inlineApiKey.trim();
  }

  if (config.llmProvider === "anthropic" || config.llmProvider === "openai") {
    const saved = await getProviderKey(config.llmProvider);

    if (saved) {
      return saved;
    }
  }

  return config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
}

/**
 * Turn raw provider/server error payloads into a short, actionable CLI message.
 * Billing and auth failures are the common BYOK failure modes and deserve a clear
 * fast message instead of a generic status dump.
 */
function friendlyProviderError(status: number, body: string, provider: string): string {
  const haystack = body.toLowerCase();
  const name = provider === "anthropic"
    ? "Anthropic"
    : provider === "openai"
      ? "OpenAI"
      : haystack.includes("anthropic")
        ? "Anthropic"
        : haystack.includes("openai")
          ? "OpenAI"
          : "The provider";
  const loginHint = provider === "anthropic" || provider === "openai" ? provider : "anthropic|openai";

  if (haystack.includes("credit balance is too low") || haystack.includes("insufficient_quota") || haystack.includes("exceeded your current quota") || haystack.includes("billing")) {
    return `Your ${name} API key has no available credit. Add billing/credit or use a different key, then re-run. (No audit was charged.)`;
  }

  if (status === 401 || haystack.includes("invalid_api_key") || haystack.includes("invalid api key") || haystack.includes("incorrect api key") || haystack.includes("authentication")) {
    return `Your ${name} API key was rejected. Re-run \`betternpm login ${loginHint}\` with a valid key.`;
  }

  if (status === 429) {
    return `${name} rate-limited the audit (HTTP 429). Wait a moment and try again.`;
  }

  return `Server audit failed (${status}): ${body}`;
}

async function normalizeQueueResponse(response: QueueAuditResponse, auditServerUrl: string): Promise<ServerAuditResult> {
  if (response.cached && response.audit) {
    return { cached: true, refreshed: false, audit: response.audit };
  }

  if (!response.queued || !response.request) {
    throw new Error(response.error ?? "Server audit did not return a queued request.");
  }

  const completed = await pollAuditRequest(auditServerUrl, response.request.id);

  if (!completed.audit) {
    throw new Error("Server audit completed without an audit result.");
  }

  return { cached: false, refreshed: false, audit: completed.audit };
}

async function pollAuditRequest(auditServerUrl: string, requestId: string): Promise<PollAuditResponse> {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const response = await fetch(`${auditServerUrl.replace(/\/$/, "")}/v1/audit-requests/${encodeURIComponent(requestId)}`);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Server audit polling failed (${response.status}): ${text}`);
    }

    const body = await response.json() as PollAuditResponse;

    if (body.request.status === "completed") {
      return body;
    }

    if (body.request.status === "failed") {
      throw new Error(friendlyProviderError(502, body.request.error ?? "unknown error", ""));
    }

    await delay(2_000);
  }

  throw new Error(`Server audit timed out while waiting for request ${requestId}.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
