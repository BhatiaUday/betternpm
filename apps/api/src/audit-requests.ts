import type { AuditProvider, AuditTargetKind } from "./types.js";

export type AuditRequestStatus = "queued" | "running" | "completed" | "failed";

interface AuditRequestRow {
  id: string;
  request_status: AuditRequestStatus;
  audit_target: AuditTargetKind;
  package_name: string;
  version: string;
  provider: AuditProvider;
  model: string;
  scanner_profile: string;
  audit_id: string | null;
  error: string | null;
  requested_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditRequestRecord {
  id: string;
  status: AuditRequestStatus;
  target: AuditTargetKind;
  packageName: string;
  version: string;
  provider: AuditProvider;
  model: string;
  scannerProfile: string;
  auditId?: string;
  error?: string;
  requestedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export async function createAuditRequestRecord(db: D1Database, input: {
  id: string;
  target: AuditTargetKind;
  packageName: string;
  version: string;
  provider: AuditProvider;
  model: string;
  scannerProfile: string;
  requestedByUserId?: string;
  requestIp?: string;
  now: string;
}): Promise<AuditRequestRecord> {
  await db.prepare(`
    INSERT INTO audit_requests (
      id,
      request_status,
      audit_target,
      package_name,
      version,
      provider,
      model,
      scanner_profile,
      requested_by_user_id,
      request_ip,
      created_at,
      updated_at
    ) VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.id,
    input.target,
    input.packageName,
    input.version,
    input.provider,
    input.model,
    input.scannerProfile,
    input.requestedByUserId ?? null,
    input.requestIp ?? null,
    input.now,
    input.now
  ).run();

  const record = await readAuditRequestRecord(db, input.id);

  if (!record) {
    throw new Error("Audit request was not created.");
  }

  return record;
}

export async function readAuditRequestRecord(db: D1Database, id: string): Promise<AuditRequestRecord | undefined> {
  const row = await db.prepare("SELECT * FROM audit_requests WHERE id = ? LIMIT 1").bind(id).first<AuditRequestRow>();
  return row ? rowToAuditRequestRecord(row) : undefined;
}

export async function markAuditRequestRunning(db: D1Database, id: string, now: string): Promise<void> {
  await db.prepare(`
    UPDATE audit_requests
    SET request_status = 'running', updated_at = ?
    WHERE id = ? AND request_status IN ('queued', 'running')
  `).bind(now, id).run();
}

export async function markAuditRequestCompleted(db: D1Database, input: { id: string; auditId: string; now: string }): Promise<void> {
  await db.prepare(`
    UPDATE audit_requests
    SET request_status = 'completed', audit_id = ?, error = NULL, updated_at = ?
    WHERE id = ?
  `).bind(input.auditId, input.now, input.id).run();
}

export async function markAuditRequestFailed(db: D1Database, input: { id: string; error: string; now: string }): Promise<void> {
  await db.prepare(`
    UPDATE audit_requests
    SET request_status = 'failed', error = ?, updated_at = ?
    WHERE id = ?
  `).bind(input.error, input.now, input.id).run();
}

function rowToAuditRequestRecord(row: AuditRequestRow): AuditRequestRecord {
  return {
    id: row.id,
    status: row.request_status,
    target: row.audit_target,
    packageName: row.package_name,
    version: row.version,
    provider: row.provider,
    model: row.model,
    scannerProfile: row.scanner_profile,
    auditId: row.audit_id ?? undefined,
    error: row.error ?? undefined,
    requestedByUserId: row.requested_by_user_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
