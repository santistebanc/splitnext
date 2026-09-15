CREATE TABLE app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_metadata (key, value) VALUES ('schema_version', '1');
