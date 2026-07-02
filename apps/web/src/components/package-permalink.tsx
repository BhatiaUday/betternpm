"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ArrowLeft, ChevronDown, TerminalSquare } from "lucide-react";
import { isVersionTag, parseSlug } from "../lib/package-slug";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.betternpm.org").replace(/\/$/, "");

type RiskLevel = "low" | "medium" | "high" | "blocked";
type Severity = RiskLevel | "info";

interface Finding {
  severity: Severity;
  code: string;
  title: string;
  detail?: string;
  evidence?: Array<{ file: string; sourceUrl?: string }>;
}

interface TranscriptStep {
  kind: "assistant" | "tool_call" | "tool_result" | "verdict";
  tool?: string;
  input?: unknown;
  text?: string;
}

interface AuditRecord {
  identity: { target: string; packageName: string; version: string; provider: string; model: string };
  facts: { downloads?: { weekly?: number }; sourceScan?: { scanned: boolean; filesScanned: number } };
  risk: { level: RiskLevel; score: number; findings: Finding[]; confidence?: string; summary?: string };
  createdAt?: string;
  requestedByUserId?: string;
  transcript?: TranscriptStep[];
}

interface AuditHistoryEntry {
  version: string;
  target: string;
  provider: string;
  model: string;
  riskLevel: RiskLevel;
  score: number;
  createdAt: string;
  username?: string;
}

export function PackagePermalink() {
  const params = useParams();
  const router = useRouter();
  const rawSlug = params.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug : rawSlug ? [rawSlug] : [];
  const { name, version: requestedVersion } = parseSlug(slug);

  const [status, setStatus] = useState<"loading" | "found" | "missing" | "error">("loading");
  const [audit, setAudit] = useState<AuditRecord>();
  const [resolvedVersion, setResolvedVersion] = useState<string | undefined>(requestedVersion);
  const [versions, setVersions] = useState<string[]>([]);
  const [history, setHistory] = useState<AuditHistoryEntry[]>([]);

  // All published versions, for the version dropdown.
  useEffect(() => {
    if (!name) {
      return;
    }

    let active = true;

    (async () => {
      try {
        const response = await fetch(`${API_URL}/v1/packages/${name}/versions`);

        if (!response.ok) {
          return;
        }

        const data = await response.json() as { versions?: string[] };

        if (active) {
          setVersions(data.versions ?? []);
        }
      } catch {
        // Dropdown is progressive enhancement.
      }
    })();

    return () => {
      active = false;
    };
  }, [name]);

  useEffect(() => {
    if (!name) {
      setStatus("error");
      return;
    }

    let active = true;

    (async () => {
      try {
        setStatus("loading");

        let version = requestedVersion;

        if (!version || isVersionTag(version)) {
          const versionsResponse = await fetch(`${API_URL}/v1/packages/${name}/versions`);

          if (!versionsResponse.ok) {
            throw new Error("registry");
          }

          const versionsData = await versionsResponse.json() as { latest?: string; versions?: string[] };
          version = versionsData.latest ?? versionsData.versions?.[0];
        }

        if (!version) {
          throw new Error("no-version");
        }

        if (active) {
          setResolvedVersion(version);
        }

        const auditResponse = await fetch(`${API_URL}/v1/packages/${name}/${version}/audit`);

        if (!auditResponse.ok) {
          throw new Error("audit");
        }

        const data = await auditResponse.json() as { cached: boolean; audit: AuditRecord | null };

        if (!active) {
          return;
        }

        if (data.cached && data.audit) {
          setAudit(data.audit);
          setStatus("found");
        } else {
          setStatus("missing");
        }
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [name, requestedVersion]);

  // Audit history for the currently resolved version (all providers/models/rescans).
  useEffect(() => {
    if (!name || !resolvedVersion) {
      return;
    }

    let active = true;

    (async () => {
      try {
        const response = await fetch(`${API_URL}/v1/packages/${name}/audits?version=${encodeURIComponent(resolvedVersion)}`);

        if (!response.ok) {
          return;
        }

        const data = await response.json() as { audits?: AuditHistoryEntry[] };

        if (active) {
          setHistory(data.audits ?? []);
        }
      } catch {
        // Audit history is best-effort; ignore failures.
      }
    })();

    return () => {
      active = false;
    };
  }, [name, resolvedVersion]);

  return (
    <main className="audit-shell">
      <header className="audit-masthead">
        <p className="kicker">package audit</p>
        <h1 className="audit-title">{name || "Unknown package"}{resolvedVersion ? `@${resolvedVersion}` : ""}</h1>
        <div className="version-row">
          {versions.length > 0 && (
            <label className="version-picker">
              <span>Version</span>
              <select
                className="select-input"
                value={resolvedVersion && versions.includes(resolvedVersion) ? resolvedVersion : ""}
                onChange={(event) => {
                  if (event.target.value) {
                    router.push(`/p/${encodeURIComponent(name)}/${encodeURIComponent(event.target.value)}`);
                  }
                }}
              >
                <option value="" disabled>select…</option>
                {versions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          )}
          <p className="audit-sub">
            Cached audits for this version.{" "}
            <a href="/search"><ArrowLeft size={13} aria-hidden="true" /> Back to search</a>
          </p>
        </div>
      </header>

      {status === "loading" && (
        <div className="audit-empty">
          <Loader2 className="spin" size={22} aria-hidden="true" />
          <p>Loading the latest cached audit…</p>
        </div>
      )}

      {status === "error" && (
        <p className="error-line">Could not load an audit for that package. Check the name and try again.</p>
      )}

      {status === "missing" && (
        <div className="audit-empty">
          <ShieldCheck size={22} aria-hidden="true" />
          <p>
            No cached audit yet for {name}{resolvedVersion ? `@${resolvedVersion}` : ""}.{" "}
            <a href={`/search?q=${encodeURIComponent(name)}`}>Run a fresh AI audit →</a>
          </p>
        </div>
      )}

      {status === "found" && audit && <AuditResult audit={audit} />}

      {history.length > 0 && (
        <section className="audit-history" aria-label="Audit history">
          <h2 className="audit-history-title">Audits of v{resolvedVersion}</h2>
          <ul className="audit-history-list">
            {history.map((entry) => (
              <li key={`${entry.provider}-${entry.model}-${entry.createdAt}`}>
                <span className={`risk-badge risk-${entry.riskLevel}`}>{entry.riskLevel} {entry.score}</span>
                <span className="ah-engine">{entry.provider} · {entry.model}</span>
                {entry.username && <span className="ah-user">by @{entry.username}</span>}
                <time className="ah-date" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString()}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function AuditResult({ audit }: { audit: AuditRecord }) {
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
        <span><ShieldCheck size={15} aria-hidden="true" /> cached community audit</span>
        {risk.confidence && <span>confidence: {risk.confidence}</span>}
        {audit.requestedByUserId && <span>by @{audit.requestedByUserId}</span>}
        <span>{facts.downloads?.weekly?.toLocaleString() ?? "unknown"} weekly downloads</span>
        {facts.sourceScan?.scanned && <span>{facts.sourceScan.filesScanned} files in package</span>}
        {audit.createdAt && <span>audited {new Date(audit.createdAt).toLocaleDateString()}</span>}
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

      {audit.transcript && audit.transcript.length > 0 && (
        <details className="transcript-disclosure">
          <summary>
            <span className="disclosure-label">
              <TerminalSquare size={15} aria-hidden="true" />
              Agent transcript
              <span className="disclosure-tag">{audit.transcript.length} steps</span>
            </span>
            <ChevronDown className="disclosure-chevron" size={16} aria-hidden="true" />
          </summary>
          <div className="transcript-body">
            <p className="transcript-note">
              The audit agent&apos;s investigation, verbatim: what it read, what it searched, and how it
              reached the verdict. Tool results are truncated for storage.
            </p>
            <ol className="transcript-list">
              {audit.transcript.map((step, index) => (
                <li key={index} className={`ts-step ts-${step.kind}`}>
                  <span className="ts-kind">{step.kind.replace("_", " ")}{step.tool ? ` · ${step.tool}` : ""}</span>
                  {step.input !== undefined && <pre className="ts-pre">{JSON.stringify(step.input)}</pre>}
                  {step.text && <pre className="ts-pre">{step.text}</pre>}
                </li>
              ))}
            </ol>
          </div>
        </details>
      )}
    </div>
  );
}
