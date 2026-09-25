-- A derived index of the groups each identity can access, so a device can list
-- them. Each group's Durable Object stays authoritative; rows are refreshed
-- from its snapshots whenever the identity creates, joins, or synchronizes.
CREATE TABLE identity_group_access (
  identity_id TEXT NOT NULL REFERENCES access_identities(id),
  group_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  hidden_at TEXT,
  PRIMARY KEY (identity_id, group_id)
);

UPDATE app_metadata SET value = '3' WHERE key = 'schema_version';
