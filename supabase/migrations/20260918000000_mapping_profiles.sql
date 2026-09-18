-- HubDB Importer — F11 mapping profiles + job history support.
--
-- Two changes bundled since the file has not been applied yet:
--
-- 1. `mappings` gains `state_json` for the wizard state (a Record<
--    sourceTableName, MappingState>). The /import wizard is portal-first
--    (target picked from an existing portal, not authored from a schema
--    file), so the pre-existing schema-first `schema_json` column is made
--    nullable and left in place — a second migration can lean on it if
--    schema-first authoring lands later.
--
-- 2. `job_errors` gains `column_name` to line up with the RowError.column
--    field added in F10. Nullable — table-level errors and `unmapped-table`
--    row errors legitimately have no column.
--
-- Apply via the Supabase SQL Editor (toggle Read-only OFF).

-- Default lets ADD COLUMN succeed if any legacy rows exist; new writes must
-- always supply a real state payload (enforced at repo layer).
ALTER TABLE mappings
    ADD COLUMN state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ALTER COLUMN schema_json DROP NOT NULL;

ALTER TABLE mappings
    ALTER COLUMN state_json DROP DEFAULT;

ALTER TABLE job_errors
    ADD COLUMN column_name TEXT;
