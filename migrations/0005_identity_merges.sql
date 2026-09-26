CREATE TABLE identity_merges (
  source_identity_id TEXT PRIMARY KEY REFERENCES access_identities(id),
  target_identity_id TEXT NOT NULL REFERENCES access_identities(id),
  merged_at TEXT NOT NULL,
  CHECK (source_identity_id != target_identity_id)
);

UPDATE app_metadata SET value = '5' WHERE key = 'schema_version';
