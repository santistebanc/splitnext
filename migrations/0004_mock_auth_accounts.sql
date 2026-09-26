CREATE TABLE mock_auth_accounts (
  account_name TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL UNIQUE REFERENCES access_identities(id),
  created_at TEXT NOT NULL
);

UPDATE app_metadata SET value = '4' WHERE key = 'schema_version';
