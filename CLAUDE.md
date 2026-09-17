# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

**Phase 1 (MVP) in progress.** Full `lib/` layer is shipped and tested (169 vitest cases / 14 suites). F1 (portal connection) + F2 (source ingestion) + F3 (portal introspection UI + diff + provision) + F4 (column mapping UI) + F5 (foreign-relationship config) + F6 (dependency-order display) + F7 (dry run + unresolved-refs CSV download) + F8 (execute + optional publish) are wired end-to-end — the full source → mapping → execute → publish loop runs at `/import`. Full-pipeline sandbox spike also green (`scripts/spike/13-import-end-to-end.ts`) and the `/execute` endpoint validated via curl against fresh namespaced tables. F10 results/logging polish and F11 mapping-profile persistence are the next unblocked items.

- `hubdb-importer-prd.md` — the source-of-truth PRD (v0.1). Sections are stable references throughout the phase docs (F1–F11, §8, §10). **PRD §6 and §8 need revision** — see F0-2 in `phases/phase-0-spike.md`
- `phases/phase-0-spike.md` — closed spike with 9 original findings + 3 Phase-1 addendum findings (F0-10/11/12 on PATCH semantics). Read the addendum before touching `patchTable` / `provision`
- `phases/phase-1-mvp.md` — task checklist; check the boxes there as work lands (F1–F8 shipped; F9 publish/F10 results/F11 mapping profiles remain, plus F8's job-persistence + throttle open items)
- `phases/phase-2.md`, `phase-3.md` — later-phase task lists
- `STATUS.md` — running project log: what's done, what's in flight, what's next. **Read this first** at the start of a session to catch up
- `scripts/spike/` — one-off CLI scripts kept in-tree as regression checks and investigation traces. `00-ping` through `05-publish` proved the Phase-0 API chain; `06-11` traced the PATCH-semantics investigation (F0-10/11/12); `12-supabase-ping` verifies the Supabase migration is applied; `13-import-end-to-end` runs the full `provision → importRows → push-live → verify → cleanup` pipeline against the sandbox (also surfaced F0-13: HubDB label uniqueness). Not part of the app runtime

## What's built

**Core lib** (all typechecked + vitest-covered):

- `lib/hubdb/` — typed HubDB wrapper with per-portal `createHubdbClient({token})` factory, 429/5xx retry honoring `Retry-After`, id normalization to strings, `/rows/draft/batch/*` path enforcement, 100-row cap. Ops: `listTables`, `getTable`, `getDraftTable`, `createTable`, `patchTable`, `pushLive`, `listAll{Draft,Live}Rows`, `batch{Create,Update,Purge}DraftRows`
- `lib/hubdb/provision.ts` — topological two-phase provisioner. Consumes a `DiffPlan` from `lib/schema` + `ProvisionOps` adapter; runs `breakCycles` for the two-phase strategy (create without FK cols → PATCH-in). Sends `portal.columns + new columns` on every PATCH per F0-11
- `lib/hubdb/import.ts` — F8 execution. `importRows(ops, {schema, tableIds, source})` walks the schema in toposort order, fetches existing rows, builds a naturalKey keymap, splits into insert/update, batches at 100. Fresh row ids fold back into the keymap so downstream tables resolve
- `lib/hubdb/introspection.ts` — `validateHubdbToken(token)` for F1's token check
- `lib/hubdb/portal-schema.ts` — `fetchPortalSchema(client)` for F3: list + `getDraftTable` per table in parallel; per-table draft-fetch failures stashed in `draftFetchError` rather than throwing
- `lib/execution.ts` — F8 synthesizer. `synthesizeExecution({sources, mappings, portalTables})` translates the wizard state into the `{schema, tableIds, source}` triple `importRows` expects. Everything is re-keyed into "target space" (schema column names = target names, source rows re-keyed to target names, FK `foreignColumn` becomes the sibling's target column for the picked matchKey). Returns issues (not throws) for missing target / composite key / unmapped key / fk-target-column-missing
- `lib/dry-run.ts` — F7 pure. `computeDryRun` returns `{order, tables, projectedApiCalls, ok}` with per-table create/update/skip counts, unresolved-FK list (source column + row# + value + `foreignSource.matchKey`), coercion warnings, API-call estimate. Caller fetches portal rows and hands them in
- `lib/mapping.ts` — F4 + F5 + F6 pure logic: `normalizeIdent` (identifier-fold, distinct from `normalizeKey`), `autoMap` (claim-once), `detectTypeMismatch`, `validatePathColumn`, F5's `ForeignKeyConfig` shape + `initialForeignKeyConfig` + `normalizeOptionsFor(matching)` + `countResolvable`, plus F6's `MappingState` + `initialMappingState()` + `deriveImportOrder(sourceNames, mappings)` (returns toposort + cycle-break plan for the /import UI). Note: `MappingState` lives here (not in `app/`) so pure code can consume it
- `lib/graph.ts` — `toposort`, `toposortOrThrow`, `breakCycles`. Iterative Tarjan's for SCC / cycle detection. Converters from `HubdbTableInput` and `HubdbTable`
- `lib/schema.ts` — zod parse + cross-ref validation (surfaces all issues at once) + `resolveDefaults` (FK `foreignColumn` defaults to target's single-column naturalKey) + `diffSchema` returning per-table `create | match | update | conflict`
- `lib/resolve.ts` — `normalizeKey` (trim + collapse ws + casefold), `buildKeyMap` (natural key → row id with duplicate detection), `resolveForeignValue` (all-or-nothing per cell; dedupes; empty → `[]`), `splitMultiValue`. `HUBDB_MAX_ROWS_PER_TABLE` constant
- `lib/crypto.ts` — AES-256-GCM `encrypt`/`decrypt` returning `base64(iv || tag || ciphertext)`. Reads `PORTAL_TOKEN_ENCRYPTION_KEY`. `generateEncryptionKey()` helper
- `lib/db/supabase.ts` — server-only `createSupabaseServerClient()` factory. Contains a `ws`-based WebSocket polyfill for Node 20 (retire when we go to Node 22)
- `lib/db/portals.ts` — typed portal repo: `PortalRow` (server) vs `PortalSummary` (client-safe); `createPortal` / `listPortals` / `getPortalById` / `getPortalToken` (server-only decrypt) / `deletePortal`
- `lib/source/csv.ts` — CSV parser (papaparse + BOM sniff for UTF-8/16, delimiter auto-detect, header dedup, `headerRow` override, manual overrides for all three)
- `lib/source/json.ts` — JSON parser: two shapes (`{ table: rows[] }` or `[{ table, rows }]`), nested-value rejection with `path: "table[i].col"` pointer
- `lib/source/validate.ts` — warning collector (row-count cap, cell-length caps, dup natural key, empty required col). Reuses `HUBDB_MAX_ROWS_PER_TABLE` + `normalizeKey`. Natural-key + required-col checks are generic and stay quiet until F4 supplies args

**App surface** (F1 + F2 + F3 + F4 + F5 + F6 + F7 + F8):

- `app/api/portals/route.ts` — GET + POST. `runtime = "nodejs"`. POST validates token before insert; unique-index dupe → 409
- `app/api/sources/csv/route.ts` — F2 CSV upload endpoint (multipart, one or more `file` fields, global delimiter/encoding/headerRow overrides). 20 MB cap per file. Response includes both `preview` (first 20) and full `rows` so F4 mapping can re-validate client-side
- `app/api/sources/json/route.ts` — F2 JSON endpoint (`{ payload: string }` body). Nested-value errors return 400 with `path` pointer. Also returns full `rows` for F4
- `app/api/portals/[id]/diff/route.ts` — F3 diff endpoint: `{ schema }` → parseSchema → fetchPortalSchema → diffSchema → `{ plan, schema, fetchedAt, portal }`. SchemaValidationError → 400 with issue list
- `app/api/portals/[id]/provision/route.ts` — F3 provision endpoint: same pipeline then `provision(opsFromClient(client), plan, { onEvent })`. Returns `{ result, events, plan }`; `ProvisionConflictError` → 409 with conflictTables
- `app/api/portals/[id]/schema/route.ts` — F4 dependency: `GET` returns `{ portal, fetchedAt, tables }` (client-consumable snapshot) so `MappingEditor` can seed the target-table dropdown
- `app/import/mapping-editor.tsx` — F4 + F5 client component. Per-source-table panel: target-table picker → auto-map → column table with `unmapped/ignored/target` three-way select (claim-once), type-mismatch badge, natural-key checkboxes, `hs_name`/`hs_path` (target `useForPages` only). Below the column table, one `ForeignKeyPanel` per source column mapped to a `FOREIGN_ID` target: sibling-source picker, match-key picker, multi+delimiter, onMissing, matching mode, and a live `countResolvable`-driven matched/unmatched/empty preview. Live-refreshes `validateSource` warnings on state change
- `app/import/import-order-panel.tsx` — F6 client component. Numbered vertical list of the derived toposort (or cycle-break) order, with per-row dependencies + deferred-edge callouts. Rendered on `/import` above the table cards once any mapping has FK configs
- `app/api/portals/[id]/dry-run/route.ts` — F7 endpoint: `{sources, mappings}` in, existing draft rows fetched per target, `computeDryRun` report returned
- `app/api/portals/[id]/execute/route.ts` — F8 endpoint: synthesize → `importRows` → optional `pushLive` per publish mode. 400 on synthesis issues, 409 on preflight, 502 on generic HubSpot failure (echoes partial events)
- `app/import/dry-run-panel.tsx` — F7 client component. Run/re-run button, per-table metrics + coercion/unresolved lists, unresolved-refs CSV download
- `app/import/execute-panel.tsx` — F8 client component. Publish selector (`none` / `foreign-only` / `all`), Execute button, per-table result cards (created/updated/skipped/errors), publish results list, collapsible event log
- `app/portals/page.tsx` + `portal-form.tsx` — server list + client form. Red badge for `env: production` per F1. Each row has a `schema →` link to the F3 introspection page
- `app/portals/[id]/schema/page.tsx` + `refresh-button.tsx` — F3 introspection page. Server component decrypts the portal token and calls `fetchPortalSchema`; renders published/draft badge + row count + column list (with FK target-table + display-column ids). `RefreshButton` uses `useTransition` + `router.refresh()`
- `app/import/page.tsx` + `source-uploader.tsx` — F2 page. Server-fetches portals for the target picker + client uploader with CSV/JSON tabs, override controls, and per-table preview grid (first 20 rows) + warnings
- `app/portals/[id]/schema/schema-planner.tsx` — F3 diff/provision client component (paste/upload a schema definition → per-table verdict cards → Provision button when `plan.ok`)
- `app/page.tsx` — home page linking to `/portals` and `/import`; Runs / Results shown as disabled placeholders
- `app/layout.tsx` + `app/globals.css` — Geist wired via `next/font/google`; **watch out**: `--font-sans` in the `@theme` block must point at `--font-geist-sans` (the variable `layout.tsx` exports), not at itself, or the body font silently falls back to Times
- `supabase/migrations/20260915000000_init.sql` — DDL for all 6 phase-1 tables + `set_updated_at()` trigger. Applied against the cloud project; verify via `pnpm spike scripts/spike/12-supabase-ping.ts`

## Stack

- **Next.js 16** App Router (PRD says 15; `create-next-app` shipped 16 — App Router surface is compatible)
- React 19, TypeScript 5, Tailwind CSS v4 (`@tailwindcss/postcss`)
- **shadcn/ui on Base UI** (`base-nova` preset) — components land in `components/ui/`, `cn` helper in `lib/utils.ts`
- pnpm (pinned via `packageManager` in `package.json`)
- ESLint 9 flat config (`eslint.config.mjs`)
- **No `src/` dir** — `app/`, `components/`, `lib/`, `workers/` sit at the repo root (matches PRD §9 layout)
- **Vitest 5** as the test runner, colocated `*.test.ts` next to source (not a `tests/` dir). Note: no `vitest.config.ts` yet — import from `lib/` with relative paths, not the `@/` alias
- Deps: `@supabase/supabase-js`, `ws` (Node 20 WebSocket polyfill), `zod`, `papaparse`

## Commands

```
pnpm dev                                  # next dev
pnpm build                                # next build
pnpm start                                # next start (prod, after build)
pnpm lint                                 # eslint
pnpm test                                 # vitest watch
pnpm test:run                             # vitest one-shot
pnpm exec tsc --noEmit                    # typecheck without emit
pnpm dlx shadcn@latest add <component>    # add a shadcn/ui component

# Spike scripts — read .env.local (HUBSPOT_TOKEN required for hubdb ones)
pnpm spike scripts/spike/00-ping.ts                # list tables via v3 + dated API
pnpm spike scripts/spike/01-provision-foreign.ts   # create brands + categories (idempotent)
pnpm spike scripts/spike/02-provision-main.ts      # create products with FK columns
pnpm spike scripts/spike/03-insert-foreign.ts      # batch-insert 200 rows into each foreign
pnpm spike scripts/spike/04-insert-main.ts         # batch-insert 200 linked products
pnpm spike scripts/spike/05-publish.ts             # push-live in dependency order
pnpm spike scripts/spike/06-patch-semantics.ts     # PATCH sanity — first attempt on root path (returns 401)
pnpm spike scripts/spike/07-patch-auth.ts          # PATCH auth isolation across bases + methods
pnpm spike scripts/spike/08-patch-draft.ts         # discovered /tables/{id}/draft is the write path
pnpm spike scripts/spike/09-patch-draft-semantics.ts   # hit the getTable/live paradox
pnpm spike scripts/spike/10-patch-draft-truth.ts   # verified full-replace via GET /draft + push-live
pnpm spike scripts/spike/11-provision-update.ts    # end-to-end diffSchema → provision → verify
pnpm spike scripts/spike/12-supabase-ping.ts       # counts rows in all 6 Supabase tables
pnpm spike scripts/spike/13-import-end-to-end.ts   # full pipeline: provision → importRows → push-live → verify → cleanup (~10s)
pnpm spike scripts/spike/99-inspect.ts             # draft vs live row counts
```

## What this app does

HubDB Importer resolves relational data into HubSpot HubDB. HubSpot's native CSV import cannot populate `FOREIGN_ID` columns, so foreign relationships must be linked by hand in the UI. This app takes source files (CSV / JSON), resolves foreign keys from human-readable natural keys (SKU, slug, name), and writes rows in topological order so `FOREIGN_ID` cells contain real HubDB row IDs.

Two ideas do most of the work — read PRD §6 and §8 (with the Phase-0 revisions in `phases/phase-0-spike.md`) before touching resolver / provisioner code:

- **Two-pass import.** Foreign tables written first to obtain HubDB row IDs → key map built → main table written with substituted IDs.
- **Name-based FK references.** Schema definitions reference other tables by *name* (e.g. `"foreignTable": "brands"`, `"foreignColumn": "name"`). HubSpot's API accepts `foreignTableName` + `foreignColumnName` on `FOREIGN_ID` columns and resolves them server-side at write time. Schema files stay portable across portals for free — no client-side id-translation step in the happy path. The provisioner still needs the id-translation code path as a fallback for edge cases (topology inspection, cycle-breaking PATCHes). *(This revises the PRD §6/§8 claim that the provisioner **must** translate to integer ids at write time — see F0-2.)*

## Planned architecture (from PRD §9)

```
Vercel host, Supabase for job state (portals, mappings, jobs, job_batches, job_errors, key_maps)

app/api/            server-only HubSpot calls; token never reaches the browser
app/import/[id]/    wizard: source → map → relations → dry run → run
lib/hubdb/          typed HubDB wrapper (batching, backoff), schema diff + provisioning
lib/graph.ts        topological sort — shared by provisioner and importer
lib/resolve.ts      key map + foreign resolution
workers/            long-running job runner (SSE progress; closing tab must not kill it)
```

Non-negotiable rules baked into the PRD:

- **All HubSpot calls are server-side.** No fetch from a React component. Token stored encrypted; never sent to client after save.
- **Provisioning and import share one topological order.** `lib/graph.ts` is used by both. `FOREIGN_ID` columns need a real `foreignTableId`, so referenced tables are created first. Cycles → create tables without FK columns, then PATCH the FK columns in.
- **Never drop or retype an existing HubDB column in v1.** Report the conflict and stop.
- **New tables are created as draft** and unusable via HubL/API until published. Provisioning and row import share one publish step (F9).
- **Job runner is decoupled from request handlers.** UI subscribes via SSE; closing the tab must not kill the import. Persist batch cursor so a failed run resumes rather than restarts.

## HubDB constraints to enforce in code (PRD §10 + Phase-0 findings)

- Batch row create/update: **100 rows per call** (hard API cap)
- Rows per table: 10,000 — block before writing
- Text: 10,000 chars • Rich text: 65,000 chars
- Reads paginate at 1,000 rows default
- Dynamic page paths must be lowercase
- Retry 429/5xx with exponential backoff, honor `Retry-After`, throttle under the portal's requests-per-10s ceiling
- **Batch mutations live under `/rows/draft/batch/{create,update,purge}`** — the top-level `/rows/batch/create` returns an HTML 404 from the edge. Always include the `draft` segment (F0-5)
- **Reads:** `/rows/draft` for draft state, `/rows` for live. `publishedAt: "1970-01-01T00:00:00Z"` is the null-sentinel for "never published" (F0-9)
- **Row IDs are strings in a single global namespace across all tables** (12-digit HubSpot ids). Column IDs are per-table sequential integers — never compare column ids across tables. Wrapper must normalize all ids to strings on ingest (list endpoints return table `id` as string, FK columns echo `foreignTableId` as number) (F0-4)
- **Table schema mutations also live under `/draft`** — `PATCH /tables/{id}/draft`, not `/tables/{id}`. The root path returns HTTP 401 with a misleading "service-to-service not engaged" body. Use `patchTable` from `lib/hubdb/tables.ts` — never build the path by hand (F0-10)
- **`PATCH /tables/{id}/draft` is FULL-REPLACE on the `columns` array** — sending only new columns silently drops existing ones. Always send `portal.columns + new columns` (existing ids preserved). `lib/hubdb/provision.ts` does this correctly; hand-rolled PATCHes will destroy schemas if they're not careful (F0-11)
- **`GET /tables/{id}` returns the LIVE view, not the draft** — use `getDraftTable` from `lib/hubdb/tables.ts` when diffing or verifying pending schema changes (F0-12)
- **`POST /tables` uniqueness applies to LABEL too, not just `name`** — a create with a label that matches any existing table returns 409 `TableValidationError.DUPLICATE_NAME_AND_LABEL`. If a schema definition picks a label that collides, provisioning will fail here. When generating tables programmatically (spikes, tests) namespace both fields (F0-13)

## Foreign ID wire format

Cells are arrays of objects, not bare IDs:

```json
{ "brand": [ { "id": "63100937357", "type": "foreignid" } ] }
```

Verified in Phase 0 to round-trip verbatim — HubSpot does not normalize the cell or add `foreignTableId` to it. The target table is pinned by the *column definition*, not the cell (F0-3).

Creating a `FOREIGN_ID` column requires the target table + column identified — either as ids (`foreignTableId` + `foreignColumnId`) or by name (`foreignTableName` + `foreignColumnName`). Omitting all four returns HTTP 400 with `"Foreign table id or foreign table name must be defined"`. Name-based is the preferred authoring form (F0-2); response echoes back the resolved numeric ids.

## Two related JSON formats — don't confuse them

- **Schema definition** (PRD §F3): declares the HubDB tables to exist. Referenced by schema-local `id`. Portable across portals.
- **Import mapping** (PRD §9): source columns → HubDB columns + foreign relationship rules (`matchOn`, `multi`, `delimiter`, `onMissing`, `normalize`). References HubDB tables by *name*.

Open question §13.6: whether these become one file or two. Not decided.

## Working with the PRD

- PRD Section 13 has six open questions that gate design choices — check there before making assumptions about scope (single vs multiple main tables, absent-row policy, prod-write gating, schema file authoring model, one-file-or-two).
- **Phase 0 status:** complete. API base locked in as `/cms/v3/hubdb/...` (dated `2026-03` is equivalent, kept as a fallback). Rate-limit ceiling and long-job runner strategy are **still open** — rolled into Phase 1. Do not lock those two choices in code before Phase 1 measures them.
- **PRD sections that need revising based on Phase 0** — §6 and §8 (name-based FK references, not id-translated). See F0-2 in `phases/phase-0-spike.md`.
