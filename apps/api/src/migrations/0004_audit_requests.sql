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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_requests_status_idx
  ON audit_requests (request_status, created_at);

CREATE INDEX IF NOT EXISTS audit_requests_package_idx
  ON audit_requests (audit_target, package_name, version, provider, model, scanner_profile, created_at);
