# Phase 2 — Reusability & robustness

**Goal:** Make imports repeatable, resumable, and friendlier for wider source formats.

## F11 — Mapping profiles
- [x] Save named mapping profiles (create, list, rename) (Phase 1 — `lib/db/mappings.ts` + `ProfilePanel`)
- [x] Duplicate profile action (`POST /api/mappings/[id]/duplicate` → server-side `duplicateMapping` picks a non-colliding `Copy of X` name via `nextCopyName`)
- [x] Export profile as JSON (`serializeProfileExport` wraps in a versioned envelope; client-side blob download from `ProfilePanel`)
- [x] Import profile from JSON (`parseProfileExport` zod-validates the envelope; auto-renames via `nextCopyName` when the incoming name collides on the target portal)
- [ ] Re-run saved mapping against a new file
- [ ] Re-run saved mapping against a different portal (lookup by name)

## Async runner (Inngest)
- [x] `POST /api/portals/[id]/execute` enqueue-and-return (validates + `createJob(status="queued")` + `inngest.send`; returns 202 `{jobId}` in ms — see `lib/inngest/functions/execute-import.ts` for the step function)
- [x] Inngest step function: `preflight → import-rows → publish:<table> → finalize` (all read state fresh from the `jobs` row; closure state does NOT cross step boundaries — steps are independent HTTP invocations)
- [x] Client polling every 2s via `GET /api/jobs/[id]` — polling endpoint returns `{status, batchesDone, totals?, response?}`; `ExecutePanel` reads `.response` on terminal status and dispatches into the existing `done` / `fail-fast` / `cancelled` / `error` stages (zero rewrite of `ResultView`)
- [x] Cancel via DB flag (`POST /api/jobs/[id]/cancel` flips `cancel_requested`; import-rows step polls it every 1s and aborts via existing `AbortController` contract; effect at next batch boundary)
- [x] Migration `20260928000000_inngest_runner.sql` adds `input_sources` / `input_mappings` / `input_publish` / `dry_run_signature` / `response` / `cancel_requested` / `portal_id` on `jobs` + `queued` status
- [x] `pnpm dev:inngest` script + `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` env vars (blank in dev — `isDev: process.env.NODE_ENV !== "production"` short-circuits HMAC verification for the CLI dev server)
- [x] `/api/inngest` in `proxy.ts` `PUBLIC_PREFIXES` so Inngest webhook calls skip the Supabase auth gate (HMAC verification handled by `serve` in prod)
- [ ] Per-batch step splitting (defer — whole-`importRows` in one step is safe because upserts are idempotent, and Inngest retries on timeout. Revisit if the 300s per-step cap actually bites repeatedly)
- [ ] Detect interrupted jobs on runner restart — Inngest solves this by construction now (steps that never complete get retried); leave as-is unless we see stuck-queued jobs in practice

## Resume from failure
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

## User authentication
- [x] Supabase Auth integration (`lib/db/supabase-browser.ts` + `lib/db/supabase-server-auth.ts` — anon-key clients for auth flow, service-role client stays separate for DB queries)
- [x] `/login` + `/register` pages with email+password forms (auth pages skip the sidebar chrome via a pathname check in `nav.tsx`)
- [x] `/api/auth/register` server-side re-validates the @saltedstone.com domain (pure helper `lib/auth/email-domain.ts::normalizeAndCheckEmail` with 8 vitest cases covering casing / whitespace / malformed input / other domains / subdomains / non-string input)
- [x] `/api/auth/logout` + `LogoutButton` client component (double-clears: browser signOut + server cookie clear)
- [x] Sidebar shows signed-in email + Sign out link; `layout.tsx` fetches current user server-side via `getCurrentUser` and passes to `Sidebar` as a prop
- [x] `proxy.ts` gates all routes: if `BASIC_AUTH_*` env vars set → Basic Auth (legacy, unchanged); otherwise Supabase session check → redirect to `/login?next=<url>` if unauthenticated. Public paths (`/login`, `/register`, `/api/auth/*`, static) always pass through. Middleware supports both Auth backends without a code change — env-var-driven

## Wizard state persistence
- [x] Persist wizard state across nav (`app/import/source-uploader.tsx` — mode + mappings + selectedProfileId + gsheetRows saved to `sessionStorage` under `hubdb-importer:wizard:{portalId}` on every change; hydrated on mount client-side; resume flow takes precedence. Raw parsed rows intentionally NOT persisted — sessionStorage's ~5 MB cap can't hold a 10k-row CSV, and re-parsing is one click. Blue "Restored N mapping(s)" banner + "Clear session" button appear when the user returns and mappings were rehydrated but no source is parsed yet)

## Google Sheets source
- [x] Ingest from Published-to-web CSV URLs (`lib/source/gsheets.ts::normalizeGoogleSheetsUrl` accepts `/pub?output=csv`, `/pubhtml`, `/edit#gid=…`, bare sheet URLs, and gviz CSV export; rewrites where safe. `POST /api/sources/gsheets` server-side-fetches each URL with a 30s timeout + 20 MB cap, HTML→502 guard, and pipes through `parseCsv`. `SourceUploader` gains a fourth "Google Sheets" tab with a dynamic list of `{tableName, url}` rows)
- [ ] OAuth flow for private-sheet read access (deferred — needs a GCP project + consent screen. The Published-CSV path covers the common case; upgrade when someone hits the "can't publish this sheet" ceiling)
- [ ] Refresh-from-sheet action for saved mappings (needs to store the sheet URL alongside the mapping profile, then a "re-fetch" button on `/import` that re-runs the gsheets endpoint)
