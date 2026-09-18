-- HubDB Importer — F11-1 fix.
--
-- The init migration declared `jobs.mapping_id NOT NULL REFERENCES
-- mappings(id) ON DELETE CASCADE`, which turned every profile deletion
-- into a silent history wipe — confirmed live during F11 chunk-2
-- verification: deleting the smoke-test profile also 404'd the job that
-- ran under it. Bad default for an audit trail.
--
-- This migration keeps history alive across profile deletions by:
--   1. Making `jobs.mapping_id` nullable (a job with a deleted profile
--      keeps its totals + row errors, just loses its provenance link)
--   2. Recreating the FK with ON DELETE SET NULL
--
-- Apply via the Supabase SQL Editor (toggle Read only OFF).

ALTER TABLE jobs
    DROP CONSTRAINT jobs_mapping_id_fkey,
    ALTER COLUMN mapping_id DROP NOT NULL;

ALTER TABLE jobs
    ADD CONSTRAINT jobs_mapping_id_fkey
        FOREIGN KEY (mapping_id) REFERENCES mappings(id) ON DELETE SET NULL;
