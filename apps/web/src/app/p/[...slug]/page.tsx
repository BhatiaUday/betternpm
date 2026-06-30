"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, ShieldCheck, ArrowLeft } from "lucide-react";

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

interface AuditRecord {
  identity: { target: string; packageName: string; version: string; provider: string; model: string };
  facts: { downloads?: { weekly?: number }; sourceScan?: { scanned: boolean; filesScanned: number } };
  risk: { level: RiskLevel; score: number; findings: Finding[]; confidence?: string; summary?: string };
  createdAt?: string;
}

const VERSION_TAGS = new Set(["latest", "next", "beta", "alpha", "canary", "rc"]);

function looksLikeVersion(segment: string): boolean {
  return /^v?\d+\.\d+/.test(segment) || VERSION_TAGS.has(segment);
}

/**
 * Split a catch-all slug into a package name and (optional) version. The last
 * segment is treated as a version only when it looks like one, so scoped names
 * such as `@scope/pkg` and bare names both resolve correctly.
 */
function parseSlug(slug: string[]): { name: string; version?: string } {
  const parts = slug.map((part) => decodeURIComponent(part)).filter(Boolean);

  if (parts.length === 0) {
    return { name: "" };
  }

  const last = parts[parts.length - 1] as string;

  if (parts.length > 1 && looksLikeVersion(last)) {
    return { name: parts.slice(0, -1).join("/"), version: last };
  }

  return { name: parts.join("/") };
}

export default function PackagePermalinkPage() {
  const params = useParams();
  const rawSlug = params.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug : rawSlug ? [rawSlug] : [];
  const { name, version: requestedVersion } = parseSlug(slug);

  const [status, setStatus] = useState<"loading" | "found" | "missing" | "error">("loading");
  const [audit, setAudit] = useState<AuditRecord>();
  const [resolvedVersion, setResolvedVersion] = useState<string | undefined>(requestedVersion);

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

        if (!version || VERSION_TAGS.has(version)) {
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
          setStatus(name ? "error" : "error");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [name, requestedVersion]);

  return (
    <main className="audit-shell">
      <header className="audit-masthead">
        <p className="kicker">package audit</p>
        <h1 className="audit-title">{name || "Unknown package"}{resolvedVersion ? `@${resolvedVersion}` : ""}</h1>
        <p className="audit-sub">
          The latest cached Better npm audit for this package.{" "}
          <a href="/leaderboard"><ArrowLeft size={13} aria-hidden="true" /> Back to search</a>
        </p>
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
            <a href="/audit">Run a fresh AI audit →</a>
          </p>
        </div>
      )}

      {status === "found" && audit && <AuditResult audit={audit} />}
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
    </div>
  );
}
