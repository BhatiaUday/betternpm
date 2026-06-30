"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Loader2, Play, Search, ShieldCheck } from "lucide-react";

type RiskLevel = "low" | "medium" | "high" | "blocked";
type Severity = RiskLevel | "info";
type Provider = "anthropic" | "openai";
type Target = "npm-install" | "npx";

interface FindingEvidence {
  file: string;
  sourceUrl?: string;
}

interface Finding {
  severity: Severity;
  code: string;
  title: string;
  detail?: string;
  evidence?: FindingEvidence[];
}

interface AuditRecord {
  identity: {
    target: string;
    packageName: string;
    version: string;
    provider: string;
    model: string;
  };
  facts: {
    downloads?: { weekly?: number };
    sourceScan?: { scanned: boolean; filesScanned: number };
  };
  risk: {
    level: RiskLevel;
    score: number;
    findings: Finding[];
    confidence?: string;
    summary?: string;
  };
}

interface VersionsResponse {
  name: string;
  latest?: string;
  versions: string[];
}

interface QueueResponse {
  queued?: boolean;
  cached?: boolean;
  request?: { id: string };
  audit?: AuditRecord | null;
  error?: string;
}

interface PollResponse {
  request: { id: string; status: "queued" | "running" | "completed" | "failed"; error?: string };
  audit: AuditRecord | null;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 150_000;

// Mirrors the server model policy (apps/api provider-audit.ts DEFAULT_PROVIDER_MODELS).
const MODEL_POLICY: Record<Provider, { model: string; thinking: string }> = {
  anthropic: { model: "claude-opus-4-8", thinking: "high" },
  openai: { model: "gpt-5.5", thinking: "high" }
};

export function AuditConsole({ apiUrl }: { apiUrl: string }) {
  const endpoint = useMemo(() => apiUrl.replace(/\/$/, ""), [apiUrl]);

  const [packageInput, setPackageInput] = useState("");
  const [resolvedName, setResolvedName] = useState<string>();
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState("");
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [target, setTarget] = useState<Target>("npm-install");
  const [binByVersion, setBinByVersion] = useState<Record<string, boolean>>({});
  const [targetTouched, setTargetTouched] = useState(false);
  const [apiKey, setApiKey] = useState("");

  const [versionStatus, setVersionStatus] = useState<"idle" | "loading" | "error">("idle");
  const [auditStatus, setAuditStatus] = useState<"idle" | "running" | "error">("idle");
  const [progress, setProgress] = useState<string>();
  const [audit, setAudit] = useState<AuditRecord>();
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string>();

  const loadVersions = useCallback(async () => {
    const name = parsePackageName(packageInput);

    if (!name) {
      setError("Enter a package name or an npm package URL.");
      return;
    }

    setVersionStatus("loading");
    setError(undefined);

    try {
      const response = await fetch(`${endpoint}/v1/packages/${encodeURIComponent(name)}/versions`);

      if (!response.ok) {
        throw new Error(`Could not find "${name}" on the npm registry.`);
      }

      const data = await response.json() as VersionsResponse;
      const selected = data.latest ?? data.versions[0] ?? "";
      setResolvedName(data.name);
      setVersions(data.versions);
      setVersion(selected);
      setTargetTouched(false);
      setBinByVersion(await loadBinMap(data.name));
      setVersionStatus("idle");
    } catch (caught) {
      setVersionStatus("error");
      setError(caught instanceof Error ? caught.message : "Failed to load versions.");
    }
  }, [endpoint, packageInput]);

  const runAudit = useCallback(async () => {
    const name = resolvedName ?? parsePackageName(packageInput);

    if (!name) {
      setError("Enter a package name first, then load its versions.");
      return;
    }

    if (!apiKey.trim()) {
      setError("Paste your Anthropic or OpenAI API key to run an audit.");
      return;
    }

    setAuditStatus("running");
    setError(undefined);
    setAudit(undefined);
    setProgress("Submitting audit request…");

    try {
      const response = await fetch(`${endpoint}/v1/audit-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target,
          packageName: name,
          version: version || "latest",
          provider,
          apiKey: apiKey.trim()
        })
      });

      const data = await response.json() as QueueResponse;

      if (!response.ok) {
        throw new Error(data.error ?? `Audit request failed (${response.status}).`);
      }

      if (data.cached && data.audit) {
        setAudit(data.audit);
        setCached(true);
        setAuditStatus("idle");
        setProgress(undefined);
        return;
      }

      if (!data.request?.id) {
        throw new Error(data.error ?? "The audit was not queued.");
      }

      const completed = await pollAudit(endpoint, data.request.id, setProgress);
      setAudit(completed);
      setCached(false);
      setAuditStatus("idle");
      setProgress(undefined);
    } catch (caught) {
      setAuditStatus("error");
      setProgress(undefined);
      setError(caught instanceof Error ? caught.message : "The audit failed.");
    }
  }, [endpoint, resolvedName, packageInput, apiKey, target, version, provider]);

  // Identify the command automatically: a package with no bin is a library you can
  // only `npm install`; one that ships a bin is what you'd `npx`. Manual picks win.
  useEffect(() => {
    if (!version) return;
    const hasBin = binByVersion[version];
    if (hasBin === undefined) return;
    setTarget((current) => {
      if (hasBin === false) return "npm-install";
      if (!targetTouched) return "npx";
      return current;
    });
  }, [version, binByVersion, targetTouched]);

  const busy = auditStatus === "running";

  return (
    <section className="audit-panel" aria-label="Package audit console">
      <div className="audit-form">
        <div className="field">
          <label htmlFor="package-input">Package or npm URL</label>
          <div className="input-row">
            <input
              id="package-input"
              className="text-input"
              placeholder="left-pad  or  https://www.npmjs.com/package/left-pad"
              value={packageInput}
              onChange={(event) => setPackageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void loadVersions();
                }
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button type="button" className="ghost-button" onClick={() => void loadVersions()} disabled={versionStatus === "loading"}>
              {versionStatus === "loading" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
              <span>Load versions</span>
            </button>
          </div>
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="version-select">Version</label>
            <select
              id="version-select"
              className="select-input"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              disabled={versions.length === 0}
            >
              {versions.length === 0
                ? <option value="">Load a package first</option>
                : versions.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
            </select>
          </div>

          <div className="field">
            <label>Command</label>
            <div className="segmented" role="group" aria-label="Audit target">
              <button type="button" className={target === "npm-install" ? "seg active" : "seg"} onClick={() => { setTargetTouched(true); setTarget("npm-install"); }}>npm install</button>
              <button
                type="button"
                className={target === "npx" ? "seg active" : "seg"}
                onClick={() => { setTargetTouched(true); setTarget("npx"); }}
                disabled={Boolean(version) && binByVersion[version] === false}
                title={Boolean(version) && binByVersion[version] === false ? "This package ships no executable (bin), so it can only be installed." : undefined}
              >npx</button>
            </div>
            {Boolean(version) && binByVersion[version] !== undefined && (
              <p className="field-hint">
                {binByVersion[version]
                  ? "Auto-detected an executable (bin) — defaulting to npx. Switch to npm install to weigh install-script risk instead."
                  : "Library package (no bin) — npx doesn't apply, so this audits the npm install path."}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="provider-select">Provider</label>
            <select
              id="provider-select"
              className="select-input"
              value={provider}
              onChange={(event) => setProvider(event.target.value as Provider)}
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (GPT)</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="api-key">{provider === "anthropic" ? "Anthropic" : "OpenAI"} API key</label>
          <div className="input-row">
            <span className="input-icon" aria-hidden="true"><KeyRound size={16} /></span>
            <input
              id="api-key"
              className="text-input key-input"
              type="password"
              placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <p className="field-hint">
            Runs <code>{MODEL_POLICY[provider].model}</code> at <strong>{MODEL_POLICY[provider].thinking}</strong> thinking.
            {" "}Your key is sent over HTTPS only to run this audit and is never stored.
          </p>
        </div>

        <button type="button" className="run-button" onClick={() => void runAudit()} disabled={busy}>
          {busy ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          <span>{busy ? (progress ?? "Auditing…") : "Run audit"}</span>
        </button>

        {error && <p className="error-line" role="alert">{error}</p>}
      </div>

      {audit ? <AuditResult audit={audit} cached={cached} /> : <EmptyState />}
    </section>
  );
}

function AuditResult({ audit, cached }: { audit: AuditRecord; cached: boolean }) {
  const { identity, facts, risk } = audit;

  return (
    <div className="audit-result">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{identity.target} · {identity.provider} · {identity.model}</p>
          <h2>{identity.packageName}@{identity.version}</h2>
        </div>
        <span className={`risk-badge risk-${risk.level}`}>{risk.level} {risk.score}</span>
      </div>

      {risk.summary && <p className="audit-summary">{risk.summary}</p>}

      <div className="audit-stats">
        <span><ShieldCheck size={15} aria-hidden="true" /> {cached ? "cached community audit" : "fresh audit"}</span>
        {risk.confidence && <span>confidence: {risk.confidence}</span>}
        <span>{facts.downloads?.weekly?.toLocaleString() ?? "unknown"} weekly downloads</span>
        {facts.sourceScan?.scanned && <span>{facts.sourceScan.filesScanned} files in package</span>}
      </div>

      <div className="finding-list" aria-label="Audit findings">
        {risk.findings.length === 0
          ? <p className="finding-empty">No security findings were raised.</p>
          : risk.findings.map((finding, index) => (
            <article className="finding-row" key={`${finding.code}-${index}`}>
              <span className={`severity severity-${finding.severity}`}>{finding.severity}</span>
              <div>
                <strong>{finding.title}</strong>
                {finding.detail && <p>{finding.detail}</p>}
                {finding.evidence?.[0]?.sourceUrl && (
                  <a href={finding.evidence[0].sourceUrl} rel="noreferrer" target="_blank">review source</a>
                )}
              </div>
            </article>
          ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="audit-empty">
      <ShieldCheck size={22} aria-hidden="true" />
      <p>Load a package, pick a version, and run an AI audit. Cached community audits return instantly.</p>
    </div>
  );
}

function parsePackageName(input: string): string | undefined {
  const trimmed = input.trim();

  if (!trimmed) {
    return undefined;
  }

  const urlMatch = trimmed.match(/npmjs\.com\/package\/([^?#\s]+)/i);

  if (urlMatch?.[1]) {
    const path = urlMatch[1].replace(/\/v\/.*$/, "").replace(/\/+$/, "");
    return safeDecode(path);
  }

  return stripVersion(trimmed);
}

function stripVersion(spec: string): string {
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");

    if (slash === -1) {
      return spec;
    }

    const at = spec.indexOf("@", slash);
    return at === -1 ? spec : spec.slice(0, at);
  }

  const at = spec.indexOf("@");
  return at === -1 ? spec : spec.slice(0, at);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Reads each published version's `bin` from the npm registry (CORS-enabled) so the
// console can pick the right command automatically. Returns {} on any failure so the
// UI gracefully falls back to a manual choice.
async function loadBinMap(name: string): Promise<Record<string, boolean>> {
  const path = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);

  try {
    const response = await fetch(`https://registry.npmjs.org/${path}`, {
      headers: { accept: "application/vnd.npm.install-v1+json" }
    });

    if (!response.ok) {
      return {};
    }

    const doc = await response.json() as { versions?: Record<string, { bin?: unknown }> };
    const map: Record<string, boolean> = {};

    for (const [value, meta] of Object.entries(doc.versions ?? {})) {
      map[value] = hasExecutable(meta?.bin);
    }

    return map;
  } catch {
    return {};
  }
}

function hasExecutable(bin: unknown): boolean {
  if (typeof bin === "string") {
    return bin.trim().length > 0;
  }

  if (bin && typeof bin === "object") {
    return Object.keys(bin as Record<string, unknown>).length > 0;
  }

  return false;
}

async function pollAudit(
  endpoint: string,
  requestId: string,
  setProgress: (value: string) => void
): Promise<AuditRecord> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await fetch(`${endpoint}/v1/audit-requests/${encodeURIComponent(requestId)}`);

    if (!response.ok) {
      throw new Error(`Audit polling failed (${response.status}).`);
    }

    const data = await response.json() as PollResponse;
    setProgress(data.request.status === "running" ? "Auditing package…" : "Queued…");

    if (data.request.status === "completed" && data.audit) {
      return data.audit;
    }

    if (data.request.status === "failed") {
      throw new Error(data.request.error ?? "The audit failed on the server.");
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error("The audit timed out. Please try again.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
