-- Which group each invite code opens, so a link can carry the code alone. Rows
-- hold only a hash of the code and stay after the link is replaced, so an old
-- link still reaches its group and is told it was replaced.
CREATE TABLE invite_codes (
  token_hash TEXT PRIMARY KEY,
  group_id TEXT NOT NULL
);

UPDATE app_metadata SET value = '5' WHERE key = 'schema_version';
