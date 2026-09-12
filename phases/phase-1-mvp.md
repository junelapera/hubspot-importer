# Phase 1 — MVP

**Goal:** Ship a usable importer for CSV + JSON sources with schema provisioning, foreign-key resolution, dry run, upsert, and publish.

## Project scaffolding
- [ ] Initialize Next.js 15 (App Router, TypeScript) project
- [ ] Set up Supabase project + connection
- [ ] Create DB tables: `portals`, `mappings`, `jobs`, `job_batches`, `job_errors`, `key_maps`
- [ ] Configure Vercel deployment target
- [ ] Set up encryption utility for token storage (server-side only)

## F1 — Portal connection
- [ ] `POST /api/portals` — create portal (label, env, token)
- [ ] Validate token with test call before saving
- [ ] Encrypt token at rest; never expose to client after save
- [ ] `GET /api/portals` — list saved portals with env badge
- [ ] Check `hubdb` scope on the token; block save if missing
- [ ] UI: portal picker with sandbox/prod badge (red for prod)

## F2 — Source ingestion
- [ ] CSV upload endpoint with delimiter/encoding/header detection
- [ ] Manual override UI for delimiter, encoding, header row
- [ ] JSON upload — accept `{ "tableId": [...] }` and `[{ "table": "...", "rows": [...] }]`
- [ ] Reject nested objects with pointer to offending JSON path
- [ ] Preview first 20 rows per table in UI
- [ ] Validation warnings: duplicate natural keys, empty required cols, row count > 10k, text > 10k / rich text > 65k chars

## F3 — Introspection & provisioning
- [ ] `lib/hubdb/client.ts` — typed HubDB wrapper with batching + backoff
- [ ] Fetch draft schemas including `columns[].type`, `foreignTableId`, `foreignColumnId`
- [ ] Per-session schema cache with manual refresh
- [ ] Display published/draft state + row count per table
- [ ] `lib/schema.ts` — parse + validate schema definition file
- [ ] Diff schema vs portal; render plan (create / add / match / conflict)
- [ ] Create only missing tables and columns; never drop or retype
- [ ] Topologically ordered provisioning (foreign tables first)
- [ ] Resolve `foreignTable` → `foreignTableId` and `foreignDisplayColumn` → `foreignColumnId`
- [ ] Default `foreignDisplayColumn` to target's natural key column when absent
- [ ] Cycle handling: create tables without FK cols, PATCH cols in after
- [ ] Write provisioned table IDs back into mapping profile

## F4 — Column mapping UI
- [ ] Auto-match source → target on normalized name
- [ ] Show target column type; flag type mismatches
- [ ] Explicit "ignored" toggle for unmapped source columns
- [ ] Natural key selector (one or more columns per table)
- [ ] `hs_name` / `hs_path` mapping with lowercase + uniqueness validation

## F5 — Foreign relationship config
- [ ] Per-FK-column panel: pick foreign source table (pre-filled from `foreignTableId`)
- [ ] Pick match key (foreign table column whose values appear in main file)
- [ ] Multi-value toggle + delimiter picker (`,` `|` `;` newline)
- [ ] `onMissing` selector: `fail` | `skip row` | `null the cell` | `create stub row`
- [ ] Matching mode: default (trim + casefold) vs strict
- [ ] Support multiple FK columns per table, resolved independently

## F6 — Dependency ordering
- [ ] `lib/graph.ts` — directed graph from FK relationships (shared with provisioner)
- [ ] Topological sort
- [ ] Cycle detection: reject with clear message OR offer two-phase write
- [ ] Show resolved import order in UI before running

## F7 — Dry run
- [ ] Mandatory before first execute of any mapping
- [ ] Report: rows to create/update, refs resolved/unresolved (with row# + value), coercion warnings, projected API call count
- [ ] No writes performed
- [ ] Download unresolved-references CSV

## F8 — Execution
- [ ] `lib/resolve.ts` — key map builder + foreign resolution
- [ ] Pass 1: upsert foreign tables; fetch all existing rows (paginated) into key map
- [ ] Pass 2: main table rows with FK cell values as `[{ id, type: "foreignid" }]`
- [ ] Batch at 100 rows per API call
- [ ] Upsert: PATCH matches, POST rest (matched by natural key)
- [ ] Persist job + batch cursor to Supabase
- [ ] Retry on 429/5xx with exponential backoff, honor `Retry-After`
- [ ] Throttle to stay under request-per-10s ceiling
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
- [ ] Normalize function: trim → collapse ws → casefold; record exact function in job log
- [ ] Abort validation on duplicate natural keys in foreign source
- [ ] Deduplicate repeated foreign values within a single main cell
- [ ] Empty FK cell → empty array (not null)
- [ ] Detect stale ID on write error → re-resolve once, then report
- [ ] Self-reference tables treated as cycle
- [ ] Block with explicit error when foreign table reaches 10k rows

## Constraint enforcement (Section 10)
- [ ] Enforce rows/table (10k), text (10k chars), rich text (65k chars)
- [ ] Enforce batch size (100)
- [ ] Enforce lowercase dynamic page paths
- [ ] Paginate reads (1000-row default page size)

## SSE progress
- [ ] `GET /api/jobs/[id]/stream` — SSE endpoint
- [ ] UI subscribes and renders per-table + per-batch progress
