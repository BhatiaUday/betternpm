DROP TABLE IF EXISTS users;

CREATE TABLE IF NOT EXISTS leaderboard (
  username TEXT PRIMARY KEY,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  total_audits INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS leaderboard_rank_idx
  ON leaderboard (total_cost_usd DESC, total_audits DESC);

ALTER TABLE audit_requests ADD COLUMN request_ip TEXT;
