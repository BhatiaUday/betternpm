-- Verified GitHub accounts. A login here is "claimed": only the authenticated
-- GitHub user may attribute leaderboard audits to that handle.
CREATE TABLE IF NOT EXISTS accounts (
  github_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS accounts_login_idx ON accounts (login);
