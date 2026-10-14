-- Currency belongs to each expense; groups have no authoritative currency.
-- Retain all access rows while removing the obsolete derived-index field.
ALTER TABLE identity_group_access DROP COLUMN currency_code;

UPDATE app_metadata SET value = '4' WHERE key = 'schema_version';
