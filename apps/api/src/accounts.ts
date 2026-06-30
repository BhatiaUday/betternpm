// Verified GitHub accounts. A login present here is "claimed": only the
// authenticated GitHub user may attribute audits to that handle.

export async function upsertAccount(db: D1Database, input: {
  githubId: number;
  login: string;
  avatarUrl?: string;
  now: string;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO accounts (github_id, login, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(github_id) DO UPDATE SET
      login = excluded.login,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
  `).bind(input.githubId, input.login, input.avatarUrl ?? null, input.now, input.now).run();
}

export async function isClaimedLogin(db: D1Database, login: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS present FROM accounts WHERE login = ? LIMIT 1").bind(login).first<{ present: number }>();
  return Boolean(row);
}

export async function listClaimedLogins(db: D1Database, logins: string[]): Promise<Set<string>> {
  const claimed = new Set<string>();
  const unique = [...new Set(logins.filter((login) => login.length > 0))].slice(0, 100);

  if (unique.length === 0) {
    return claimed;
  }

  const placeholders = unique.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT login FROM accounts WHERE login IN (${placeholders})`
  ).bind(...unique).all<{ login: string }>();

  for (const row of result.results ?? []) {
    claimed.add(row.login);
  }

  return claimed;
}
