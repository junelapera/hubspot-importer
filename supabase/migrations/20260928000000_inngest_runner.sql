-- HubDB Importer — Phase 2 runner rework.
--
-- Enables the Inngest step-function runner: /api/portals/[id]/execute stops
-- running the import synchronously, instead persists the full input onto the
-- jobs row, enqueues an Inngest event, and returns 202. The Inngest handler
-- reads the input back out of the row and drives importRows + pushLive out of
-- band. The browser polls GET /api/jobs/[id] for status + progress + the
-- final response payload.
--
-- Additive migration — no drops, no renames. Existing rows keep working:
-- input_* + response + cancel_requested + portal_id default to NULL/false, so
-- historic completed jobs still render (their totals + error + status are
-- untouched).
--
-- To apply: paste into the Supabase SQL Editor with "Read only" toggled OFF.

ALTER TABLE jobs
    ADD COLUMN input_sources     JSONB,                           -- [{name, rows}] snapshot at enqueue time
    ADD COLUMN input_mappings    JSONB,                           -- Record<sourceName, MappingState> snapshot
    ADD COLUMN input_publish     TEXT CHECK (input_publish IN ('none', 'foreign-only', 'all')),
    ADD COLUMN dry_run_signature TEXT,                            -- audit link to the dry-run that gated the execute
    ADD COLUMN response          JSONB,                           -- {result, events, published, hubspot?} — what ExecutePanel renders
    ADD COLUMN cancel_requested  BOOLEAN NOT NULL DEFAULT false,  -- polled from the importRows hook to trigger ImportCancelledError
    ADD COLUMN portal_id         UUID REFERENCES portals(id) ON DELETE SET NULL;

-- Extend the status CHECK to allow 'queued' — Inngest picks up the event
-- asynchronously so there's a brief window where the row exists but the run
-- hasn't started. 'running' still gets set inside the preflight step.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
    CHECK (status IN ('queued', 'pending', 'running', 'succeeded', 'failed', 'cancelled'));

-- Backfill portal_id for existing rows from their mapping. Best-effort; safe
-- to leave NULL on jobs whose mapping was already deleted.
UPDATE jobs
SET portal_id = m.portal_id
FROM mappings m
WHERE jobs.mapping_id = m.id
  AND jobs.portal_id IS NULL;

CREATE INDEX IF NOT EXISTS jobs_portal_id_idx ON jobs (portal_id);
