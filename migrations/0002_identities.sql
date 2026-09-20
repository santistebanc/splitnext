CREATE TABLE access_identities (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE identity_devices (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES access_identities(id),
  credential_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX identity_devices_identity_id
ON identity_devices (identity_id);

UPDATE app_metadata SET value = '2' WHERE key = 'schema_version';
