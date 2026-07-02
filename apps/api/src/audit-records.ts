import type { AuditIdentity, AuditProvider, AuditRecord, AuditTargetKind, Finding, PackageFacts, RiskAssessment, RiskLevel, TranscriptStep } from "./types.js";

interface AuditRecordRow {
  id: string;
  audit_target: AuditTargetKind;
  package_name: string;
  version: string;
  integrity: string;
  scanner_profile: string;
  provider: AuditProvider;
  model: string;
  requested_by_user_id: string | null;
  risk_level: RiskLevel;
  score: number;
  findings_json: string;
  facts_json: string;
  created_at: string;
  transcript_json?: string | null;
}

export async function createAuditId(identity: AuditIdentity): Promise<string> {
  const key = createAuditCacheKey(identity);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createAuditCacheKey(identity: AuditIdentity): string {
  return [
    "npm",
    identity.target,
    `${identity.packageName}@${identity.version}`,
    identity.integrity,
    identity.scannerProfile,
    identity.provider,
    identity.model
  ].join(":");
}

export async function readAuditRecord(db: D1Database, identity: AuditIdentity): Promise<AuditRecord | undefined> {
  const row = await db.prepare(`
    SELECT * FROM audit_records
    WHERE audit_target = ?
      AND package_name = ?
      AND version = ?
      AND integrity = ?
      AND scanner_profile = ?
      AND provider = ?
      AND model = ?
    LIMIT 1
  `).bind(
    identity.target,
    identity.packageName,
    identity.version,
    identity.integrity,
    identity.scannerProfile,
    identity.provider,
    identity.model
  ).first<AuditRecordRow>();

  return row ? rowToAuditRecord(row) : undefined;
}

export async function readAuditRecordById(db: D1Database, id: string): Promise<AuditRecord | undefined> {
  const row = await db.prepare("SELECT * FROM audit_records WHERE id = ? LIMIT 1").bind(id).first<AuditRecordRow>();
  return row ? rowToAuditRecord(row) : undefined;
}

export async function readLatestAuditRecord(input: {
  db: D1Database;
  packageName: string;
  version: string;
  target: AuditTargetKind;
  scannerProfile: string;
  provider: AuditProvider;
  model: string;
}): Promise<AuditRecord | undefined> {
  const row = await input.db.prepare(`
    SELECT * FROM audit_records
    WHERE audit_target = ?
      AND package_name = ?
      AND version = ?
      AND scanner_profile = ?
      AND provider = ?
      AND model = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(
    input.target,
    input.packageName,
    input.version,
    input.scannerProfile,
    input.provider,
    input.model
  ).first<AuditRecordRow>();

  return row ? rowToAuditRecord(row) : undefined;
}

export async function readLatestAuditForPackage(input: {
  db: D1Database;
  packageName: string;
  version: string;
  target?: AuditTargetKind;
}): Promise<AuditRecord | undefined> {
  const conditions = ["package_name = ?", "version = ?"];
  const bindings: string[] = [input.packageName, input.version];

  if (input.target) {
    conditions.push("audit_target = ?");
    bindings.push(input.target);
  }

  const row = await input.db.prepare(`
    SELECT * FROM audit_records
    WHERE ${conditions.join(" AND ")}
    ORDER BY CASE WHEN provider = 'local' THEN 1 ELSE 0 END, created_at DESC
    LIMIT 1
  `).bind(...bindings).first<AuditRecordRow>();

  return row ? rowToAuditRecord(row) : undefined;
}

export interface AuditHistoryEntry {
  version: string;
  target: AuditTargetKind;
  provider: AuditProvider;
  model: string;
  riskLevel: RiskLevel;
  score: number;
  createdAt: string;
  username?: string;
}

// Returns audit history for a package. Without a version: the latest audit per
// version, newest first (the overview timeline). With a version: every audit of
// that exact version (different providers/models/rescans), for the per-version view.
export async function readAuditHistoryForPackage(db: D1Database, packageName: string, options: { version?: string; limit?: number } = {}): Promise<AuditHistoryEntry[]> {
  const capped = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = options.version
    ? await db.prepare(`
        SELECT version, audit_target, provider, model, risk_level, score, created_at, requested_by_user_id
        FROM audit_records
        WHERE package_name = ? AND version = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(packageName, options.version, capped).all<{
        version: string;
        audit_target: AuditTargetKind;
        provider: AuditProvider;
        model: string;
        risk_level: RiskLevel;
        score: number;
        created_at: string;
        requested_by_user_id: string | null;
      }>()
    : await db.prepare(`
        SELECT version, audit_target, provider, model, risk_level, score, MAX(created_at) AS created_at, requested_by_user_id
        FROM audit_records
        WHERE package_name = ?
        GROUP BY version
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(packageName, capped).all<{
        version: string;
        audit_target: AuditTargetKind;
        provider: AuditProvider;
        model: string;
        risk_level: RiskLevel;
        score: number;
        created_at: string;
        requested_by_user_id: string | null;
      }>();

  return (rows.results ?? []).map((row) => ({
    version: row.version,
    target: row.audit_target,
    provider: row.provider,
    model: row.model,
    riskLevel: row.risk_level,
    score: row.score,
    createdAt: row.created_at,
    username: row.requested_by_user_id ?? undefined
  }));
}

export async function writeAuditRecord(db: D1Database, record: AuditRecord): Promise<void> {
  await db.prepare(`
    INSERT INTO audit_records (
      id,
      audit_target,
      package_name,
      version,
      integrity,
      scanner_profile,
      provider,
      model,
      requested_by_user_id,
      risk_level,
      score,
      findings_json,
      facts_json,
      created_at,
      transcript_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(audit_target, package_name, version, integrity, scanner_profile, provider, model)
    DO UPDATE SET
      requested_by_user_id = excluded.requested_by_user_id,
      risk_level = excluded.risk_level,
      score = excluded.score,
      findings_json = excluded.findings_json,
      facts_json = excluded.facts_json,
      created_at = excluded.created_at,
      transcript_json = excluded.transcript_json
  `).bind(
    record.id,
    record.identity.target,
    record.identity.packageName,
    record.identity.version,
    record.identity.integrity,
    record.identity.scannerProfile,
    record.identity.provider,
    record.identity.model,
    record.requestedByUserId ?? null,
    record.risk.level,
    record.risk.score,
    JSON.stringify(record.risk),
    JSON.stringify(record.facts),
    record.createdAt,
    record.transcript && record.transcript.length > 0 ? JSON.stringify(record.transcript) : null
  ).run();
}

function rowToAuditRecord(row: AuditRecordRow): AuditRecord {
  return {
    id: row.id,
    identity: {
      target: row.audit_target ?? "npx",
      packageName: row.package_name,
      version: row.version,
      integrity: row.integrity,
      scannerProfile: row.scanner_profile,
      provider: row.provider,
      model: row.model
    },
    facts: JSON.parse(row.facts_json) as PackageFacts,
    risk: parseRisk(row.findings_json, row.risk_level, row.score),
    auditedAt: row.created_at,
    requestedByUserId: row.requested_by_user_id ?? undefined,
    createdAt: row.created_at,
    transcript: parseTranscript(row.transcript_json)
  };
}

function parseTranscript(raw: string | null | undefined): TranscriptStep[] | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as TranscriptStep[] : undefined;
  } catch {
    return undefined;
  }
}

function parseRisk(rawJson: string, level: RiskLevel, score: number): RiskAssessment {
  try {
    const parsed = JSON.parse(rawJson) as unknown;

    if (Array.isArray(parsed)) {
      return { level, score, findings: parsed as Finding[] };
    }

    if (parsed && typeof parsed === "object") {
      const risk = parsed as Partial<RiskAssessment>;
      return {
        level: risk.level ?? level,
        score: typeof risk.score === "number" ? risk.score : score,
        findings: Array.isArray(risk.findings) ? risk.findings : [],
        confidence: risk.confidence,
        summary: risk.summary
      };
    }
  } catch {
    // Fall through to column-derived risk below.
  }

  return { level, score, findings: [] };
}