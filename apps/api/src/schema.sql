CREATE TABLE IF NOT EXISTS audit_records (
  id TEXT PRIMARY KEY,
  audit_target TEXT NOT NULL DEFAULT 'npx',
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  integrity TEXT NOT NULL,
  scanner_profile TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  requested_by_user_id TEXT,
  risk_level TEXT NOT NULL,
  score INTEGER NOT NULL,
  findings_json TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_records_cache_key_idx
  ON audit_records (audit_target, package_name, version, integrity, scanner_profile, provider, model);

CREATE TABLE IF NOT EXISTS audit_requests (
  id TEXT PRIMARY KEY,
  request_status TEXT NOT NULL,
  audit_target TEXT NOT NULL DEFAULT 'npm-install',
  package_name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'latest',
  provider TEXT NOT NULL DEFAULT 'local',
  model TEXT NOT NULL,
  scanner_profile TEXT NOT NULL,
  audit_id TEXT,
  error TEXT,
  requested_by_user_id TEXT,
  request_ip TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_requests_status_idx
  ON audit_requests (request_status, created_at);

CREATE INDEX IF NOT EXISTS audit_requests_package_idx
  ON audit_requests (audit_target, package_name, version, provider, model, scanner_profile, created_at);

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

CREATE TABLE IF NOT EXISTS accounts (
  github_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS accounts_login_idx ON accounts (login);
