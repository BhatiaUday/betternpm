export interface LeaderboardEntry {
  rank: number;
  username: string;
  totalCostUsd: number;
  totalAudits: number;
}

export interface AuditSearchResult {
  packageName: string;
  version: string;
  target: string;
  provider: string;
  riskLevel: string;
  score: number;
  auditedAt: string;
}

export function sanitizeUsername(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 40);
  return cleaned.length > 0 ? cleaned : undefined;
}

export async function incrementLeaderboard(db: D1Database, input: {
  username: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  now: string;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO leaderboard (username, total_cost_usd, total_audits, total_input_tokens, total_output_tokens, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      total_cost_usd = leaderboard.total_cost_usd + excluded.total_cost_usd,
      total_audits = leaderboard.total_audits + 1,
      total_input_tokens = leaderboard.total_input_tokens + excluded.total_input_tokens,
      total_output_tokens = leaderboard.total_output_tokens + excluded.total_output_tokens,
      updated_at = excluded.updated_at
  `).bind(input.username, input.costUsd, input.inputTokens, input.outputTokens, input.now, input.now).run();
}

export async function readLeaderboard(db: D1Database, limit: number): Promise<LeaderboardEntry[]> {
  const result = await db.prepare(`
    SELECT username, total_cost_usd, total_audits
    FROM leaderboard
    ORDER BY total_cost_usd DESC, total_audits DESC
    LIMIT ?
  `).bind(limit).all<{ username: string; total_cost_usd: number; total_audits: number }>();

  return (result.results ?? []).map((row, index) => ({
    rank: index + 1,
    username: row.username,
    totalCostUsd: row.total_cost_usd,
    totalAudits: row.total_audits
  }));
}

export async function searchAudits(db: D1Database, query: string, limit: number): Promise<AuditSearchResult[]> {
  const like = `%${escapeLike(query)}%`;
  const result = await db.prepare(`
    SELECT package_name, version, audit_target, provider, risk_level, score, created_at
    FROM audit_records
    WHERE package_name LIKE ? ESCAPE '\\'
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(like, limit).all<{
    package_name: string;
    version: string;
    audit_target: string;
    provider: string;
    risk_level: string;
    score: number;
    created_at: string;
  }>();

  return (result.results ?? []).map((row) => ({
    packageName: row.package_name,
    version: row.version,
    target: row.audit_target,
    provider: row.provider,
    riskLevel: row.risk_level,
    score: row.score,
    auditedAt: row.created_at
  }));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface PackageAuditStatus {
  packageName: string;
  version: string;
  riskLevel: string;
  score: number;
  auditedAt: string;
}

// Returns the latest audit per package name for a set of names, so search results
// can show which packages are already audited in a single round-trip.
export async function readAuditedStatusForPackages(db: D1Database, names: string[]): Promise<Map<string, PackageAuditStatus>> {
  const map = new Map<string, PackageAuditStatus>();
  const unique = [...new Set(names.filter((name) => name.length > 0))].slice(0, 50);

  if (unique.length === 0) {
    return map;
  }

  const placeholders = unique.map(() => "?").join(", ");
  const result = await db.prepare(`
    SELECT package_name, version, risk_level, score, created_at
    FROM audit_records
    WHERE package_name IN (${placeholders})
    ORDER BY created_at DESC
  `).bind(...unique).all<{
    package_name: string;
    version: string;
    risk_level: string;
    score: number;
    created_at: string;
  }>();

  for (const row of result.results ?? []) {
    if (!map.has(row.package_name)) {
      map.set(row.package_name, {
        packageName: row.package_name,
        version: row.version,
        riskLevel: row.risk_level,
        score: row.score,
        auditedAt: row.created_at
      });
    }
  }

  return map;
}
