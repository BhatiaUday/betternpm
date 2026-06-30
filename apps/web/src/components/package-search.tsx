"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ExternalLink, KeyRound, Loader2, Play, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useBrowserSettings, type Provider } from "../lib/browser-settings";
import { loadBinMap } from "../lib/npm-detect";
import { AccountControls } from "./account-controls";

type RiskLevel = "low" | "medium" | "high" | "blocked";

interface RegistryResult {
  name: string;
  version: string;
  description?: string;
  date?: string;
  publisher?: string;
  links?: { npm?: string; homepage?: string; repository?: string };
  audited: boolean;
  audit: { version: string; riskLevel: RiskLevel; score: number; auditedAt: string } | null;
}

interface AuditRecordLite {
  identity: { packageName: string; version: string; provider: string; model: string };
  risk: { level: RiskLevel; score: number; summary?: string; findings: Array<{ severity: string; title: string }> };
}

interface QueueResult {
  version: string;
  level: RiskLevel;
  score: number;
  provider: string;
  model: string;
  summary?: string;
  findings: number;
}

function toQueueResult(audit: AuditRecordLite): QueueResult {
  return {
    version: audit.identity.version,
    level: audit.risk.level,
    score: audit.risk.score,
    provider: audit.identity.provider,
    model: audit.identity.model,
    summary: audit.risk.summary,
    findings: audit.risk.findings?.length ?? 0
  };
}

const MODEL_POLICY: Record<Provider, { model: string; thinking: string }> = {
  anthropic: { model: "claude-opus-4-8", thinking: "high" },
  openai: { model: "gpt-5.5", thinking: "high" }
};

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 150_000;

export function PackageSearch({ apiUrl }: { apiUrl: string }) {
  const endpoint = apiUrl.replace(/\/$/, "");
  const { settings, setProvider, setKey } = useBrowserSettings();
  const apiKey = settings.keys[settings.provider];

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistryResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "error">("idle");
  const [searched, setSearched] = useState(false);

  const [selected, setSelected] = useState<string>();
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState("");
  const [binByVersion, setBinByVersion] = useState<Record<string, boolean>>({});
  const [queueStatus, setQueueStatus] = useState<"idle" | "loading" | "running" | "error">("idle");
  const [progress, setProgress] = useState<string>();
  const [queueError, setQueueError] = useState<string>();
  const [queueResult, setQueueResult] = useState<QueueResult>();

  const runSearch = useCallback(async (override?: string) => {
    const raw = (override ?? query).trim();
    const urlName = parseNpmUrl(raw);
    const term = urlName ?? raw;

    if (term.length < 2) {
      return;
    }

    // Reflect the resolved package name (a pasted URL → its name) or an override.
    const reflected = urlName ?? (override !== undefined ? override : undefined);
    if (reflected !== undefined) {
      setQuery(reflected);
    }

    setSearchStatus("loading");
    setSearched(true);
    setSelected(undefined);

    try {
      const response = await fetch(`${endpoint}/v1/registry-search?q=${encodeURIComponent(term)}`);

      if (!response.ok) {
        throw new Error();
      }

      const data = await response.json() as { results?: RegistryResult[] };
      let results = data.results ?? [];

      // A package URL points at exactly one package — narrow to that match.
      if (urlName) {
        const exact = results.filter((result) => result.name.toLowerCase() === urlName.toLowerCase());
        if (exact.length > 0) {
          results = exact;
        }
      }

      setResults(results);
      setSearchStatus("idle");
    } catch {
      setSearchStatus("error");
    }
  }, [endpoint, query]);

  // Deep links like /search?q=left-pad (e.g. the "Run a fresh AI audit" link on a
  // package page) pre-fill the box and run the search immediately.
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial && initial.trim().length >= 2) {
      void runSearch(initial.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAudit = useCallback(async (name: string) => {
    setSelected(name);
    setVersions([]);
    setVersion("");
    setBinByVersion({});
    setQueueStatus("idle");
    setProgress(undefined);
    setQueueError(undefined);
    setQueueResult(undefined);

    try {
      const response = await fetch(`${endpoint}/v1/packages/${encodeURIComponent(name)}/versions`);

      if (response.ok) {
        const data = await response.json() as { latest?: string; versions: string[] };
        setVersions(data.versions);
        setVersion(data.latest ?? data.versions[0] ?? "");
      }
    } catch {
      // Leave versions empty; the dropdown shows a loading/empty state.
    }

    setBinByVersion(await loadBinMap(name));
  }, [endpoint]);

  const queueAudit = useCallback(async () => {
    if (!selected) {
      return;
    }

    if (!apiKey.trim()) {
      setQueueError(`Add your ${settings.provider === "anthropic" ? "Anthropic" : "OpenAI"} API key above to queue an audit.`);
      return;
    }

    // Identify the command automatically: executables (bin) map to npx, libraries to npm install.
    const target = binByVersion[version] ? "npx" : "npm-install";

    setQueueStatus("loading");
    setQueueError(undefined);
    setQueueResult(undefined);
    setProgress("Submitting audit request…");

    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (settings.session) {
        headers.authorization = `Bearer ${settings.session.token}`;
      }

      const response = await fetch(`${endpoint}/v1/audit-requests`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          target,
          packageName: selected,
          version: version || "latest",
          provider: settings.provider,
          apiKey: apiKey.trim()
        })
      });

      const data = await response.json() as {
        cached?: boolean;
        audit?: AuditRecordLite | null;
        request?: { id: string };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? `Audit request failed (${response.status}).`);
      }

      if (data.cached && data.audit) {
        setQueueResult(toQueueResult(data.audit));
        setQueueStatus("idle");
        setProgress(undefined);
        return;
      }

      if (!data.request?.id) {
        throw new Error(data.error ?? "The audit was not queued.");
      }

      setQueueStatus("running");
      const audit = await pollRequest(endpoint, data.request.id, setProgress);
      setQueueResult(toQueueResult(audit));
      setQueueStatus("idle");
      setProgress(undefined);
    } catch (caught) {
      setQueueStatus("error");
      setProgress(undefined);
      setQueueError(caught instanceof Error ? caught.message : "The audit failed.");
    }
  }, [endpoint, selected, version, binByVersion, apiKey, settings.provider, settings.session]);

  const busy = queueStatus === "loading" || queueStatus === "running";

  return (
    <section className="search-panel" aria-label="Package search">
      <div className="input-row search-bar">
        <input
          className="text-input"
          placeholder="search npm or paste a package URL — e.g. lodash, npmjs.com/package/react"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void runSearch();
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button type="button" className="ghost-button" onClick={() => void runSearch()} disabled={searchStatus === "loading"}>
          {searchStatus === "loading" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
          <span>Search</span>
        </button>
      </div>
      <p className="field-hint search-note">
        Search is free and needs no API key — browse any package and see if it&apos;s been audited.
        You can also <strong>paste an npm link</strong> (e.g. npmjs.com/package/react) to jump straight to it.
        Add your provider and key below only when you want to <strong>queue an AI audit</strong>.
      </p>

      <details className="settings-disclosure">
        <summary>
          <span className="disclosure-label">
            <SlidersHorizontal size={15} aria-hidden="true" />
            Audit settings
            <span className="disclosure-tag">optional</span>
          </span>
          <ChevronDown className="disclosure-chevron" size={16} aria-hidden="true" />
        </summary>
        <div className="settings-body">
          <div className="search-settings">
            <div className="field">
              <label htmlFor="ps-provider">Provider</label>
              <select id="ps-provider" className="select-input" value={settings.provider} onChange={(event) => setProvider(event.target.value as Provider)}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
              </select>
            </div>
            <AccountControls apiUrl={endpoint} />
            <div className="field">
              <label htmlFor="ps-key">{settings.provider === "anthropic" ? "Anthropic" : "OpenAI"} API key</label>
              <div className="input-row">
                <span className="input-icon" aria-hidden="true"><KeyRound size={16} /></span>
                <input
                  id="ps-key"
                  className="text-input key-input"
                  type="password"
                  placeholder={settings.provider === "anthropic" ? "sk-ant-…" : "sk-…"}
                  value={apiKey}
                  onChange={(event) => setKey(settings.provider, event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
            </div>
          </div>
          <p className="field-hint">
            Saved in this browser only. Your key is sent over HTTPS solely to run an audit and is never stored on our servers.
            Set a handle to appear on the <a href="/leaderboard">leaderboard</a>.
          </p>
        </div>
      </details>

      {searchStatus === "error" && <p className="error-line" role="alert">Search failed. Try again.</p>}
      {searched && searchStatus === "idle" && results.length === 0 && (
        <p className="muted">No packages match that query.</p>
      )}

      <div className="pkg-list">
        {results.map((result) => (
          <div className={`pkg-card${selected === result.name ? " pkg-card--open" : ""}`} key={result.name}>
            <div className="pkg-head">
              <div className="pkg-id">
                <a href={`/p/${result.name}`}>
                  <strong>{result.name}</strong>
                </a>
                <span className="pkg-version">{result.version}</span>
                <a className="pkg-npm-link" href={`https://www.npmjs.com/package/${result.name}`} target="_blank" rel="noreferrer" aria-label="View on npm">
                  npm <ExternalLink size={11} aria-hidden="true" />
                </a>
              </div>
              {result.audited && result.audit
                ? <a className={`risk-badge risk-${result.audit.riskLevel}`} href={`/p/${result.name}/${result.audit.version}`}>{result.audit.riskLevel} {result.audit.score}</a>
                : <span className="pill-muted">Not audited</span>}
            </div>

            {result.description && <p className="pkg-desc">{result.description}</p>}

            <div className="pkg-meta">
              {result.publisher && <span>{result.publisher}</span>}
              {result.date && <span>{new Date(result.date).toLocaleDateString()}</span>}
              {result.audited && result.audit && (
                <a href={`/p/${result.name}/${result.audit.version}`}>view audit</a>
              )}
              <button
                type="button"
                className="link-button"
                onClick={() => (selected === result.name ? setSelected(undefined) : void openAudit(result.name))}
              >
                {selected === result.name ? "Close" : result.audited ? "Re-audit" : "Audit"}
              </button>
            </div>

            {selected === result.name && (
              <div className="inline-audit">
                <div className="field-grid">
                  <div className="field">
                    <label htmlFor={`v-${result.name}`}>Version</label>
                    <select
                      id={`v-${result.name}`}
                      className="select-input"
                      value={version}
                      onChange={(event) => setVersion(event.target.value)}
                      disabled={versions.length === 0}
                    >
                      {versions.length === 0
                        ? <option value="">Loading…</option>
                        : versions.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Command</label>
                    <div className="auto-field">
                      {version && binByVersion[version] !== undefined
                        ? binByVersion[version] ? "npx (auto)" : "npm install (auto)"
                        : "auto-detecting…"}
                    </div>
                  </div>
                  <div className="field">
                    <label>Engine</label>
                    <div className="auto-field">{MODEL_POLICY[settings.provider].model} · {MODEL_POLICY[settings.provider].thinking}</div>
                  </div>
                </div>

                <button type="button" className="run-button" onClick={() => void queueAudit()} disabled={busy}>
                  {busy ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                  <span>{queueStatus === "running" ? (progress ?? "Auditing…") : queueStatus === "loading" ? "Submitting…" : "Queue audit"}</span>
                </button>

                {queueError && <p className="error-line" role="alert">{queueError}</p>}
                {queueResult && (
                  <div className="queue-result">
                    <div className="queue-result-head">
                      <ShieldCheck size={16} aria-hidden="true" />
                      <span className={`risk-badge risk-${queueResult.level}`}>{queueResult.level} {queueResult.score}</span>
                      <span className="queue-engine">{queueResult.provider} · {queueResult.model}</span>
                    </div>
                    {queueResult.summary && <p className="queue-summary">{queueResult.summary}</p>}
                    <p className="queue-meta">
                      {queueResult.findings} {queueResult.findings === 1 ? "finding" : "findings"}
                      {" · "}
                      <a href={`/p/${result.name}/${queueResult.version}`}>view full audit →</a>
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

async function pollRequest(endpoint: string, id: string, onProgress: (value: string) => void): Promise<AuditRecordLite> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);

    const response = await fetch(`${endpoint}/v1/audit-requests/${id}`);

    if (!response.ok) {
      continue;
    }

    const data = await response.json() as {
      request: { status: "queued" | "running" | "completed" | "failed"; error?: string };
      audit: AuditRecordLite | null;
    };

    if (data.request.status === "completed" && data.audit) {
      return data.audit;
    }

    if (data.request.status === "failed") {
      throw new Error(data.request.error ?? "The audit failed.");
    }

    onProgress(data.request.status === "running" ? "Auditing…" : "Queued…");
  }

  throw new Error("The audit is taking longer than expected — check the package page shortly.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Detects an npm package URL (npmjs.com/package/<name>[/v/<version>]) and returns
// the package name, so pasting a URL resolves to that one package.
function parseNpmUrl(input: string): string | undefined {
  const match = input.match(/npmjs\.com\/package\/([^?#\s]+)/i);

  if (!match?.[1]) {
    return undefined;
  }

  const path = match[1].replace(/\/v\/.*$/, "").replace(/\/+$/, "");

  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
