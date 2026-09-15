-- HubDB Importer — Phase 1 initial schema.
--
-- We're on Supabase cloud (no local CLI in v1). To apply this migration:
--   1. Open your project's SQL Editor in the Supabase dashboard
--   2. Paste the contents of this file and run
--   3. Keep this file checked in as the source of truth; hand-edit it before
--      any subsequent SQL run and paste again
--
-- When we adopt the Supabase CLI later, this file's filename already follows
-- the CLI's timestamped-migration convention (YYYYMMDDHHMMSS_name.sql).

-- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── portals ──────────────────────────────────────────────────────────────
-- One row per HubSpot portal the user has connected. Token stored encrypted
-- (AES-256-GCM via lib/crypto.ts) — server-side decrypt only, never returned
-- to the client after save (F1).
CREATE TABLE portals (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    label             TEXT        NOT NULL,
    env               TEXT        NOT NULL CHECK (env IN ('sandbox', 'production')),
    hub_id            TEXT,                                       -- HubSpot Hub ID, discovered at token-validation time
    token_ciphertext  TEXT        NOT NULL,                       -- base64 of iv || tag || ciphertext
    scopes            TEXT[],                                     -- scopes detected on the token at save time
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX portals_label_env_uniq ON portals (label, env);

-- ─── mappings ─────────────────────────────────────────────────────────────
-- One row per named mapping profile against a portal. Schema-file and import
-- mapping are stored together in v1 (PRD §13.6 — one-file-or-two remains open).
-- table_ids is written back after successful provisioning (F3) so subsequent
-- imports can skip the diff.
CREATE TABLE mappings (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    portal_id     UUID        NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
    name          TEXT        NOT NULL,
    schema_json   JSONB       NOT NULL,                           -- validated by lib/schema at write time
    table_ids     JSONB,                                          -- { schemaName: portalTableId } after provisioning
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (portal_id, name)
);

CREATE INDEX mappings_portal_id_idx ON mappings (portal_id);

-- ─── jobs ─────────────────────────────────────────────────────────────────
-- One row per run: dry-run, import, or publish. Progress persists here so a
-- crashed runner can resume (F8 "runner separate from request handler").
CREATE TABLE jobs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    mapping_id    UUID        NOT NULL REFERENCES mappings(id) ON DELETE CASCADE,
    kind          TEXT        NOT NULL CHECK (kind IN ('dry_run', 'import', 'publish')),
    status        TEXT        NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    totals        JSONB,                                          -- per-table {created, updated, skipped, failed}
    error         TEXT,                                           -- top-level failure message when status='failed'
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX jobs_mapping_id_idx ON jobs (mapping_id);
CREATE INDEX jobs_status_idx ON jobs (status);

-- ─── job_batches ──────────────────────────────────────────────────────────
-- One row per 100-row batch we sent (or plan to send). Cursor for resume:
-- if a job crashes mid-way, we know which batches succeeded and can skip them
-- on retry. Composite unique on (job_id, table_name, batch_index) ensures
-- idempotent re-enqueue.
CREATE TABLE job_batches (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id        UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    table_name    TEXT        NOT NULL,
    batch_index   INTEGER     NOT NULL,
    status        TEXT        NOT NULL CHECK (status IN ('pending', 'sent', 'succeeded', 'failed')),
    sent_at       TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    UNIQUE (job_id, table_name, batch_index)
);

CREATE INDEX job_batches_job_id_idx ON job_batches (job_id);

-- ─── job_errors ───────────────────────────────────────────────────────────
-- Row-level errors so the UI can render a filtered log (F10).
CREATE TABLE job_errors (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id         UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    table_name     TEXT        NOT NULL,
    source_index   INTEGER,                                       -- offset into source array; null for table-level errors
    kind           TEXT        NOT NULL,                          -- matches RowErrorKind in lib/hubdb/import.ts
    detail         TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX job_errors_job_id_idx ON job_errors (job_id);

-- ─── key_maps ─────────────────────────────────────────────────────────────
-- Persisted natural-key -> row-id maps per (job, table). Enables resume
-- without re-fetching foreign tables. `entries` is { normalizedKey: rowId }.
-- Overwritten as each table's pass-1 completes; downstream tables read it.
CREATE TABLE key_maps (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id        UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    table_name    TEXT        NOT NULL,
    entries       JSONB       NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, table_name)
);

CREATE INDEX key_maps_job_id_idx ON key_maps (job_id);

-- ─── touch triggers ──────────────────────────────────────────────────────
-- Keep updated_at fresh on portals + mappings without app-code duty.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER portals_set_updated_at BEFORE UPDATE ON portals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER mappings_set_updated_at BEFORE UPDATE ON mappings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
