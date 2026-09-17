# Phase 1 — MVP

**Goal:** Ship a usable importer for CSV + JSON sources with schema provisioning, foreign-key resolution, dry run, upsert, and publish.

## Project scaffolding
- [x] Initialize Next.js 15 (App Router, TypeScript) project (shipped as Next.js 16)
- [x] Set up Supabase project + connection (`@supabase/supabase-js` installed; `lib/db/supabase.ts` factory; SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env expected — cloud project creation is user-side)
- [x] Create DB tables: `portals`, `mappings`, `jobs`, `job_batches`, `job_errors`, `key_maps` (SQL in `supabase/migrations/20260915000000_init.sql`; paste into dashboard SQL Editor to apply)
- [ ] Configure Vercel deployment target
- [x] Set up encryption utility for token storage (server-side only) — `lib/crypto.ts` AES-256-GCM, 10 vitest cases

## F1 — Portal connection
- [ ] `POST /api/portals` — create portal (label, env, token)
- [ ] Validate token with test call before saving
- [ ] Encrypt token at rest; never expose to client after save
- [ ] `GET /api/portals` — list saved portals with env badge
- [ ] Check `hubdb` scope on the token; block save if missing
- [ ] UI: portal picker with sandbox/prod badge (red for prod)

## F2 — Source ingestion
- [x] CSV upload endpoint with delimiter/encoding/header detection (`POST /api/sources/csv`; BOM sniff + papaparse auto-delimiter)
- [x] Manual override UI for delimiter, encoding, header row (form controls on `/import`)
- [x] JSON upload — accept `{ "tableId": [...] }` and `[{ "table": "...", "rows": [...] }]` (`POST /api/sources/json`)
- [x] Reject nested objects with pointer to offending JSON path (400 with `path: "table[row].col"`)
- [x] Preview first 20 rows per table in UI (`SOURCE_PREVIEW_ROWS` constant; grid rendered in `source-uploader.tsx`)
- [x] Validation warnings: duplicate natural keys, empty required cols, row count > 10k, text > 10k / rich text > 65k chars (`lib/source/validate.ts`; natural-key + required-col checks are generic and stay quiet until F4 supplies them)

## F3 — Introspection & provisioning
- [x] `lib/hubdb/client.ts` — typed HubDB wrapper with batching + backoff
- [x] Fetch draft schemas including `columns[].type`, `foreignTableId`, `foreignColumnId` (`lib/hubdb/portal-schema.ts::fetchPortalSchema` — list + `getDraftTable` per table)
- [x] Per-session schema cache with manual refresh (Refresh button on `/portals/[id]/schema` calls `router.refresh()`; page is `dynamic = "force-dynamic"` so no stale cache — trades a re-fetch per view for correctness)
- [x] Display published/draft state + row count per table (badges + row count in `/portals/[id]/schema`)
- [x] `lib/schema.ts` — parse + validate schema definition file
- [x] Diff schema vs portal; render plan (create / add / match / conflict) (`POST /api/portals/[id]/diff` + `SchemaPlanner` client component on `/portals/[id]/schema`)
- [x] Create only missing tables and columns; never drop or retype (`POST /api/portals/[id]/provision` wires it end-to-end; UI shows a Provision button when `plan.ok && has changes`)
- [x] Topologically ordered provisioning (foreign tables first) (`lib/graph.ts`; provisioner + importer both consume it)
- [x] Resolve `foreignTable` → `foreignTableId` and `foreignDisplayColumn` → `foreignColumnId` (Phase-0 F0-2: HubSpot accepts name-based FK; happy path skips id translation)
- [x] Default `foreignDisplayColumn` to target's natural key column when absent (`resolveDefaults` in `lib/schema.ts`)
- [x] Cycle handling: create tables without FK cols, PATCH cols in after (`lib/graph.ts::breakCycles` + `lib/hubdb/provision.ts` two-phase)
- [ ] Write provisioned table IDs back into mapping profile

## F4 — Column mapping UI
- [x] Auto-match source → target on normalized name (`lib/mapping.ts::autoMap` + `normalizeIdent`; claim-once — a target column can only be assigned to one source header)
- [x] Show target column type; flag type mismatches (`detectTypeMismatch` fires on NUMBER/CURRENCY/BOOLEAN/DATE/DATETIME; TEXT/RICHTEXT/URL are permissive)
- [x] Explicit "ignored" toggle for unmapped source columns (assignment kinds are `mapped` / `ignored` / `unmapped`; three-way dropdown per row)
- [x] Natural key selector (one or more columns per table) (checkboxes on mapped rows; re-fires `validateSource` client-side so `duplicate-natural-key` warning appears the moment a key is picked)
- [x] `hs_name` / `hs_path` mapping with lowercase + uniqueness validation (fields appear only when target `useForPages`; `validatePathColumn` flags non-lowercase / invalid-char / duplicate / empty)

## F5 — Foreign relationship config
- [x] Per-FK-column panel: pick foreign source table (pre-filled from `foreignTableId`) (`ForeignKeyPanel` in `mapping-editor.tsx`; auto-inserted for every mapped source column whose target is `FOREIGN_ID`)
- [x] Pick match key (foreign table column whose values appear in main file) (dropdown seeded from the chosen foreign source's headers; independent of HubSpot's `foreignColumnId`)
- [x] Multi-value toggle + delimiter picker (`,` `|` `;` newline) (delimiter disabled until multi-value is on)
- [x] `onMissing` selector: `fail` | `skip row` | `null the cell` | `create stub row` (config only; runtime enforcement lives in `lib/hubdb/import.ts` and the F7 dry run)
- [x] Matching mode: default (trim + casefold) vs strict (`FkMatching` type; `normalizeOptionsFor` toggles `lib/resolve`'s NormalizeOptions)
- [x] Support multiple FK columns per table, resolved independently (foreignKeys map keyed by source column; each panel is standalone with its own live-resolvability counts via `countResolvable`)

## F6 — Dependency ordering
- [x] `lib/graph.ts` — directed graph from FK relationships (shared with provisioner)
- [x] Topological sort
- [x] Cycle detection: reject with clear message OR offer two-phase write (`breakCycles` + deferred-edges output)
- [x] Show resolved import order in UI before running (`ImportOrderPanel` on `/import` — appears once any mapping has FK configs; renders the toposort or the cycle-break order with deferred-edge callouts)

## F7 — Dry run
- [ ] Mandatory before first execute of any mapping (UX gate — will land with F8 execution)
- [x] Report: rows to create/update, refs resolved/unresolved (with row# + value), coercion warnings, projected API call count (`lib/dry-run.ts::computeDryRun`, `POST /api/portals/[id]/dry-run`, `DryRunPanel` on /import)
- [x] No writes performed (endpoint only calls `listAllDraftRows`; no POST/PATCH)
- [x] Download unresolved-references CSV (client-side blob download from `DryRunPanel`; columns: sourceTable, rowIndex, sourceColumn, foreignSource, matchKey, value)

## F8 — Execution
- [x] `lib/resolve.ts` — key map builder + foreign resolution
- [x] Pass 1: upsert foreign tables; fetch all existing rows (paginated) into key map
- [x] Pass 2: main table rows with FK cell values as `[{ id, type: "foreignid" }]`
- [x] Batch at 100 rows per API call
- [x] Upsert: PATCH matches, POST rest (matched by natural key)
- [ ] Persist job + batch cursor to Supabase (deferred — F11 territory)
- [x] Retry on 429/5xx with exponential backoff, honor `Retry-After` (wrapper-level)
- [ ] Throttle to stay under request-per-10s ceiling (deferred)
- [x] UI wiring: `POST /api/portals/[id]/execute` + `ExecutePanel` on /import (synthesizes schema+rows from mapping state via `lib/execution.ts::synthesizeExecution`, calls `importRows`, optional publish step in dep order)
- [ ] Cancel button — stops at batch boundary
- [ ] Runner separate from request handler (SSE subscriber, closing tab doesn't kill job)
- [ ] Bounded slice per invocation + re-enqueue (or queue worker) for long jobs

## F9 — Publish
- [ ] `push-live` each touched table in dependency order after clean run
- [ ] Options: publish all / none / foreign tables only
- [ ] UI reminder: draft rows preview but don't render live until published

## F10 — Results & logging
- [ ] Per-table summary: created / updated / skipped / failed
- [ ] Row-level error log: source row #, column, HubSpot error message
- [ ] Download log as CSV + JSON
- [ ] Job history list: mapping name, portal, timestamp, outcome

## Foreign key resolution correctness (Section 8)
- [x] Normalize function: trim → collapse ws → casefold; record exact function in job log (`DEFAULT_NORMALIZE` in `lib/resolve.ts`)
- [x] Abort validation on duplicate natural keys in foreign source (`ImportPreflightError`)
- [x] Deduplicate repeated foreign values within a single main cell (`resolveForeignValue` dedupes by default)
- [x] Empty FK cell → empty array (not null)
- [ ] Detect stale ID on write error → re-resolve once, then report
- [x] Self-reference tables treated as cycle (graph handles; provisioner defers)
- [x] Block with explicit error when foreign table reaches 10k rows (`ImportPreflightError` pre-flight)

## Constraint enforcement (Section 10)
- [x] Enforce rows/table (10k) — importer pre-flight; text (10k chars), rich text (65k chars) still TBD
- [x] Enforce batch size (100) — asserted in `lib/hubdb/rows.ts` and chunked in importer
- [ ] Enforce lowercase dynamic page paths
- [x] Paginate reads (1000-row default page size)

## SSE progress
- [ ] `GET /api/jobs/[id]/stream` — SSE endpoint
- [ ] UI subscribes and renders per-table + per-batch progress
