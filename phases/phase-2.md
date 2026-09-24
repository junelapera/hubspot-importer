# Phase 2 — Reusability & robustness

**Goal:** Make imports repeatable, resumable, and friendlier for wider source formats.

## F11 — Mapping profiles
- [x] Save named mapping profiles (create, list, rename) (Phase 1 — `lib/db/mappings.ts` + `ProfilePanel`)
- [x] Duplicate profile action (`POST /api/mappings/[id]/duplicate` → server-side `duplicateMapping` picks a non-colliding `Copy of X` name via `nextCopyName`)
- [x] Export profile as JSON (`serializeProfileExport` wraps in a versioned envelope; client-side blob download from `ProfilePanel`)
- [x] Import profile from JSON (`parseProfileExport` zod-validates the envelope; auto-renames via `nextCopyName` when the incoming name collides on the target portal)
- [ ] Re-run saved mapping against a new file
- [ ] Re-run saved mapping against a different portal (lookup by name)

## Resume from failure
- [ ] Detect interrupted jobs on runner restart (Phase 3 — belongs with the Inngest step-function rewrite; the persist-and-resume slice below doesn't require a runner daemon)
- [x] Resume from last completed batch cursor (`lib/hubdb/import.ts` gains `ImportHooks` — `onBatchStart` / `onBatchComplete` write per-batch rows to `job_batches` via `lib/db/job-batches.ts`. Resume is upsert-idempotent by natural key so re-running just re-classifies prior successes as no-op updates; the audit trail in `job_batches` makes it inspectable)
- [x] UI: "resume" action on failed jobs in history (Resume button on `/jobs/[id]` for failed / cancelled jobs; deep-links to `/import?resume=<jobId>&portalId=<...>&mappingId=<...>`; wizard auto-selects the portal + auto-loads the mapping profile + shows a banner; `resumeJobId` threads through `ExecutePanel` → `POST /api/portals/[id]/execute` which reuses the existing job row instead of creating a new one)
- [x] Preserve key map across resume (`onKeyMapReady` hook writes each table's natural-key → row-id map to `key_maps` via `lib/db/key-maps.ts` when pass-1 finishes. `loadKeyMaps` reads them back for future Inngest wiring; the current sync executor rebuilds via `listAllDraftRows` since the resume runs in one request)

## Stub creation (F5 extension)
- [ ] Implement `onMissing: create_stub` — insert placeholder row in foreign table
- [ ] Log stub creations distinctly in results
- [ ] Stub uses the unresolved token as its natural key value

## Cycle handling (full implementation)
- [ ] Two-phase write for cyclic FK graphs: insert rows without FK cells, PATCH cells after
- [ ] UI: explicit cycle-detected + two-phase-mode confirmation
- [ ] Self-referencing table (parent/child) supported end-to-end

## Schema inference
- [x] Infer starting schema from CSV headers (`lib/schema-infer.ts::inferSchema` — pure, 21 vitest cases)
- [x] Type inference: TEXT / RICHTEXT / NUMBER / CURRENCY / BOOLEAN / DATE / DATETIME / URL / IMAGE / FOREIGN_ID from cell samples (currency = numeric + name-hint; image = URL + image extension; FK = cross-table value membership)
- [x] UI to correct inferred types before provisioning (`SchemaInferPanel` on `/import` — per-column type dropdown, natural-key checkbox, FK target picker; live counts of inferred NKs + FKs in the header)
- [x] Export inferred schema as schema definition JSON (`toSchema` strips UI-only fields; client-side blob download named `schema.json`)

## XLSX source
- [x] Upload endpoint for `.xlsx` (`POST /api/sources/xlsx`; 25 MB per-file cap; multipart with one or more `file` fields)
- [x] Sheet-per-table detection (`lib/source/xlsx.ts::parseXlsx` uses SheetJS; each sheet becomes an independent table. Single-sheet workbooks use the filename as table name; multi-sheet workbooks combine as `filename__sheetname`)
- [x] Preview + validation parity with CSV path (same `{name, headers, preview, rows, totalRows, parseWarnings, validationWarnings}` shape; `SchemaInferPanel` / mapping wizard / dry run / execute all work unchanged)

## Google Sheets source
- [ ] OAuth flow for Google Sheets read access
- [ ] Sheet picker UI
- [ ] Refresh-from-sheet action for saved mappings
