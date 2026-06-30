CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  enc_key_anthropic TEXT,
  enc_key_openai TEXT,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  total_audits INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS users_leaderboard_idx
  ON users (total_cost_usd DESC, total_audits DESC);
