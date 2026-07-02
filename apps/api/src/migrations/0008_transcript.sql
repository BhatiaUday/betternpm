-- Agent conversation transcripts for audits (tool calls, results, verdict),
-- viewable on the package page. Nullable: deterministic quick scans have none.
ALTER TABLE audit_records ADD COLUMN transcript_json TEXT;
