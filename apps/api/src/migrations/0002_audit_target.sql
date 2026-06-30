ALTER TABLE audit_records ADD COLUMN audit_target TEXT NOT NULL DEFAULT 'npx';

DROP INDEX IF EXISTS audit_records_cache_key_idx;

CREATE UNIQUE INDEX IF NOT EXISTS audit_records_cache_key_idx
  ON audit_records (audit_target, package_name, version, integrity, scanner_profile, provider, model);