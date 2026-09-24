# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

**Phase 1 MVP — usable end-to-end.** 255 vitest cases / 19 suites. The full source → mapping → execute → publish loop runs at `/import`: F1 (portal connection) → F2 (source ingestion) → F3 (introspection + diff + provision) → F4 (column mapping) → F5 (foreign-relationship config) → F6 (dependency-order display) → F7 (dry run + unresolved-refs CSV download, execute gated on matching signature) → F8 (execute + optional publish, with server-side cell-length + hs_path preflight, stale-FK retry, and cancel-at-batch-boundary) → F10 (results & logging with CSV/JSON downloads) → F11 (mapping profile save/load with cached target-table id + job history at `/jobs`). All four `onMissing` FK policies wired (skip-row / null / fail / create-stub). Composite naturalKey + multi-value FK working. Node 22+ required (native `WebSocket` global). Delete-table endpoint at `DELETE /api/portals/[id]/tables/[tableId]`. Both Phase-0 open questions closed via spike/15 + `docs/long-job-runner.md`. Deploy scaffolding in place (`vercel.json` + `DEPLOYMENT.md`). Basic Auth gate lives at `proxy.ts` (renamed from `middleware.ts` for Next 16).

**Still open on `phases/phase-1-mvp.md`** (polish + robustness intentionally deferred):
- F3: write provisioned table IDs back into mapping profile (now that `MappingState.targetTableId` exists, only the schema-planner UI needs to write it back)
- F8: per-batch cursor persistence, worker-runner separation, bounded slice + re-enqueue (all cluster under the Phase-2 runner rework in `docs/long-job-runner.md`)
- SSE progress: `GET /api/jobs/[id]/stream` + UI subscriber

- `hubdb-importer-prd.md` — the source-of-truth PRD (v0.1). Sections are stable references throughout the phase docs (F1–F11, §8, §10). **PRD §6 and §8 need revision** — see F0-2 in `phases/phase-0-spike.md`
- `phases/phase-0-spike.md` — closed spike with 9 original findings + 3 Phase-1 addendum findings (F0-10/11/12 on PATCH semantics). Read the addendum before touching `patchTable` / `provision`
- `phases/phase-1-mvp.md` — task checklist; check the boxes as work lands
- `phases/phase-2.md`, `phase-3.md` — later-phase task lists
- `STATUS.md` — running project log: what's done, what's in flight, what's next. **Read this first** at the start of a session to catch up
- `DEPLOYMENT.md` — first-time Vercel + Supabase setup + env-var checklist
- `docs/long-job-runner.md` — Phase-2 runner rework plan (Inngest recommended); read before touching `POST /api/portals/[id]/execute` for the resume/SSE items
- `scripts/spike/` — one-off CLI scripts kept in-tree as regression checks and investigation traces. `00-ping` through `05-publish` proved the Phase-0 API chain; `06-11` traced the PATCH-semantics investigation (F0-10/11/12); `12-supabase-ping` verifies the Supabase migration is applied; `13-import-end-to-end` runs the full `provision → importRows → push-live → verify → cleanup` pipeline against the sandbox; `14-composite-multi-onmissing` exercises composite NK + multi-value FK + all four `onMissing` policies against real HubDB; `15-rate-limit` bursts progressive parallel reads to measure 429 threshold. Not part of the app runtime

## What's built

**Core lib** (all typechecked + vitest-covered):

- `lib/hubdb/` — typed HubDB wrapper with per-portal `createHubdbClient({token})` factory, 429/5xx retry honoring `Retry-After`, id normalization to strings, `/rows/draft/batch/*` path enforcement, 100-row cap. Ops: `listTables`, `getTable`, `getDraftTable`, `createTable`, `patchTable`, `pushLive`, `listAll{Draft,Live}Rows`, `batch{Create,Update,Purge}DraftRows`
- `lib/hubdb/provision.ts` — topological two-phase provisioner. Consumes a `DiffPlan` from `lib/schema` + `ProvisionOps` adapter; runs `breakCycles` for the two-phase strategy (create without FK cols → PATCH-in). Sends `portal.columns + new columns` on every PATCH per F0-11
- `lib/hubdb/import.ts` — F8 execution + **cell-type coercion at the write boundary**. `coerceCellForColumn(raw, columnType)` runs on every non-FK cell before it goes into the batch `values` object: NUMBER / CURRENCY → JSON number (strips `$€£¥`, commas, whitespace before `Number()`); BOOLEAN → `true`/`false` (accepts `true/false/1/0/yes/no`); DATE / DATETIME → epoch milliseconds via `Date.parse()`. Empty strings return the `SKIP_CELL` sentinel (dropped from the row — sending `""` or `null` also 400s on non-string columns). Unparseable values become `type-mismatch` row errors (new `RowErrorKind` variant), so one bad row surfaces as a normal skip rather than aborting the batch. **Critical because CSV / XLSX / gsheets all normalize every cell to `string` — without coercion, `"29.99"` on a NUMBER column → HubDB 400 `"value {type=string} was of type STRING, but we're expecting NUMERIC"`.** `importRows(ops, {schema, tableIds, source})` walks the schema in toposort order, fetches existing rows, builds a naturalKey keymap, splits into insert/update, batches at 100. Fresh row ids fold back into the keymap so downstream tables resolve. **Stale-FK retry**: on 4xx batch failure with a body hinting at foreign-row problems (via `isPossiblyStaleFkError`), re-lists every referenced foreign table, rebuilds their key maps, re-plans the batch, retries once; still-unresolvable rows drop to `result.errors`. **Cancellation**: `ImportOptions.signal?: AbortSignal` checked before each batch — aborted runs throw `ImportCancelledError` with a partial `ImportResult` (in-flight batch always completes)
- `lib/hubdb/introspection.ts` — `validateHubdbToken(token)` for F1's token check
- `lib/hubdb/portal-schema.ts` — `fetchPortalSchema(client)` for F3: list + `getDraftTable` per table in parallel; per-table draft-fetch failures stashed in `draftFetchError` rather than throwing
- `lib/execution.ts` — F8 synthesizer + F7 signature. `synthesizeExecution({sources, mappings, portalTables})` translates the wizard state into the `{schema, tableIds, source}` triple `importRows` expects. Everything is re-keyed into "target space" (schema column names = target names, source rows re-keyed to target names, FK `foreignColumn` becomes the sibling's target column for the picked matchKey). Returns issues (not throws) for: missing target / unmapped key / fk-target-column-missing / **cell-too-long** (TEXT > 10k, RICHTEXT > 65k) / **page-path-invalid** (uppercase, invalid char, duplicate — via `validatePathColumn`). Also exports `computeExecutionSignature(sources, mappings)` — canonical-JSON SHA-256 the execute route checks against a client-supplied `dryRunSignature` to gate execution on a completed dry run
- `lib/dry-run.ts` — F7 pure. `computeDryRun` returns `{order, tables, projectedApiCalls, ok}` with per-table create/update/skip counts, unresolved-FK list (source column + row# + value + `foreignSource.matchKey`), coercion warnings, API-call estimate. Caller fetches portal rows and hands them in
- `lib/mapping.ts` — F4 + F5 + F6 pure logic: `normalizeIdent` (identifier-fold, distinct from `normalizeKey`), `autoMap` (claim-once), `detectTypeMismatch`, `validatePathColumn`, F5's `ForeignKeyConfig` shape + `initialForeignKeyConfig` + `normalizeOptionsFor(matching)` + `countResolvable`, plus F6's `MappingState` + `initialMappingState()` + `deriveImportOrder(sourceNames, mappings)` (returns toposort + cycle-break plan for the /import UI). `MappingState.targetTableId?: string \| null` caches the resolved portal id at target-picker time — round-trips through the profile's `state_json` JSONB blob. Note: `MappingState` lives here (not in `app/`) so pure code can consume it
- `lib/graph.ts` — `toposort`, `toposortOrThrow`, `breakCycles`. Iterative Tarjan's for SCC / cycle detection. Converters from `HubdbTableInput` and `HubdbTable`
- `lib/schema.ts` — zod parse + cross-ref validation (surfaces all issues at once) + `resolveDefaults` (FK `foreignColumn` defaults to target's single-column naturalKey) + `diffSchema` returning per-table `create | match | update | conflict`
- `lib/schema-infer.ts` — pure schema inference from parsed source rows. `inferSchema(sources)` returns `InferredTable[]` with per-column type picked from cell samples (DATE / DATETIME / BOOLEAN / URL / IMAGE / CURRENCY / NUMBER / RICHTEXT / TEXT fallback), a naturalKey candidate (fully-unique + ≥50% fill, ranked by name priority `id > sku > slug > handle > code > key > *_id`), and FK detection via cross-table value membership (all values of column A must appear in table B's NK column, case-insensitive). `toSchema(tables)` converts inferred output to the v1 schema shape the F3 provisioner accepts. Feeds `SchemaInferPanel` on `/import`
- `lib/resolve.ts` — `normalizeKey` (trim + collapse ws + casefold), `buildKeyMap` (natural key → row id with duplicate detection), `resolveForeignValue` (all-or-nothing per cell; dedupes; empty → `[]`), `splitMultiValue`. `HUBDB_MAX_ROWS_PER_TABLE` constant
- `lib/crypto.ts` — AES-256-GCM `encrypt`/`decrypt` returning `base64(iv || tag || ciphertext)`. Reads `PORTAL_TOKEN_ENCRYPTION_KEY`. `generateEncryptionKey()` helper
- `lib/db/supabase.ts` — server-only `createSupabaseServerClient()` factory using the `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS — for DB queries only, never for auth). Requires Node 22+ for the native `WebSocket` global that supabase-js's Realtime constructor needs
- `lib/db/supabase-browser.ts` — client-side `createSupabaseBrowserClient()` using `@supabase/ssr`'s `createBrowserClient` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Only for Supabase Auth flow (signIn / signUp / signOut / getUser). Marked `"use client"`; never import from server code
- `lib/db/supabase-server-auth.ts` — server-side auth client via `createServerClient` + `cookies()` from `next/headers`. Reads + writes the session cookie for the current request. Exports `getCurrentUser()` convenience. Uses anon key + cookies (NOT service_role) so RLS still applies. **Never conflate with `createSupabaseServerClient()` — that one is for DB queries; this one is for reading the auth session.**
- `lib/auth/email-domain.ts` — pure `normalizeAndCheckEmail(input)` returns trimmed+lowercased email if it ends in `@saltedstone.com`, else null. `ALLOWED_EMAIL_DOMAIN` const exported for UI copy. `isAllowedEmail` boolean wrapper. Single source of truth for the domain check — used both client-side (register form) and server-side (`POST /api/auth/register`)
- `lib/db/job-batches.ts` — per-batch cursor persistence for resume-from-failure. `recordBatchStart` upserts `{job_id, table_name, batch_index, status:"sent"}` before each HubSpot batch call; `recordBatchComplete` updates to `succeeded`/`failed`. Wired via `ImportHooks.onBatchStart/Complete` from the execute route. `batchIndex` is monotonic across update-then-insert (updates 1..M, inserts M+1..M+N)
- `lib/db/key-maps.ts` — persisted natural-key → row-id map per (job, table). `upsertKeyMap` called from `ImportHooks.onKeyMapReady` at end of each table's pass-1. `loadKeyMaps` reads all persisted maps back — wired for the future Inngest step-function; the current sync executor re-derives from `listAllDraftRows` since resume runs in one request
- `lib/db/portals.ts` — typed portal repo: `PortalRow` (server) vs `PortalSummary` (client-safe); `createPortal` / `listPortals` / `getPortalById` / `getPortalToken` (server-only decrypt) / `deletePortal`
- `lib/source/csv.ts` — CSV parser (papaparse + BOM sniff for UTF-8/16, delimiter auto-detect, header dedup, `headerRow` override, manual overrides for all three)
- `lib/source/json.ts` — JSON parser: two shapes (`{ table: rows[] }` or `[{ table, rows }]`), nested-value rejection with `path: "table[i].col"` pointer
- `lib/source/xlsx.ts` — Excel parser via SheetJS (`xlsx` npm). `parseXlsx(bytes, {headerRow, sheetNames})` returns `{sheets, warnings}` — each sheet is a `{name, headers, rows, warnings}` independent table. `raw: false` on `sheet_to_json` so numbers / dates / booleans get stringified to match CSV cell semantics; without it downstream validators would see `number` values and misfire
- `lib/source/gsheets.ts` — pure `normalizeGoogleSheetsUrl(url)` for the Google Sheets source. Handles four URL shapes: canonical `/pub?output=csv` (pass-through), `/pubhtml` (rewrite path to `/pub`, set `output=csv`), `/edit#gid=…` and bare `/spreadsheets/d/{id}` (rewrite to `/export?format=csv`, lift `#gid=` from hash → query), and gviz (`/gviz/tq?tqx=out:csv`, pass-through). Non-`docs.google.com` hosts pass through with a warning. Unrecognized `docs.google.com` paths reject with a hint pointing at *File → Share → Publish to web*. Server-side fetch lives in `/api/sources/gsheets`, not here (this module is pure)
- `lib/source/validate.ts` — warning collector (row-count cap, cell-length caps, dup natural key, empty required col). Reuses `HUBDB_MAX_ROWS_PER_TABLE` + `normalizeKey`. Natural-key + required-col checks are generic and stay quiet until F4 supplies args

**App surface** (F1 + F2 + F3 + F4 + F5 + F6 + F7 + F8):

- `app/api/portals/route.ts` — GET + POST. `runtime = "nodejs"`. POST validates token before insert; unique-index dupe → 409
- `app/api/sources/csv/route.ts` — F2 CSV upload endpoint (multipart, one or more `file` fields, global delimiter/encoding/headerRow overrides). 20 MB cap per file. Response includes both `preview` (first 20) and full `rows` so F4 mapping can re-validate client-side
- `app/api/sources/json/route.ts` — F2 JSON endpoint (`{ payload: string }` body). Nested-value errors return 400 with `path` pointer. Also returns full `rows` for F4
- `app/api/sources/gsheets/route.ts` — Phase-2 Google Sheets endpoint. `{ sources: [{tableName, url}, ...] }` body; per source: normalize the URL, `fetch()` server-side with 30s AbortController timeout + 20 MB response cap + explicit User-Agent, guard `Content-Type: text/html` (returns 502 — the sign-in page comes back as HTML when a sheet isn't published; papaparse would silently produce garbage), pipe through `parseCsv` + `validateSource`. Response shape matches CSV/XLSX/JSON so downstream panels light up unchanged. Also emits top-level `warnings[]` carrying per-source "rewrote /edit URL" notices
- `app/api/portals/[id]/diff/route.ts` — F3 diff endpoint: `{ schema }` → parseSchema → fetchPortalSchema → diffSchema → `{ plan, schema, fetchedAt, portal }`. SchemaValidationError → 400 with issue list
- `app/api/portals/[id]/provision/route.ts` — F3 provision endpoint: same pipeline then `provision(opsFromClient(client), plan, { onEvent })`. Returns `{ result, events, plan }`; `ProvisionConflictError` → 409 with conflictTables
- `app/api/portals/[id]/schema/route.ts` — F4 dependency: `GET` returns `{ portal, fetchedAt, tables }` (client-consumable snapshot) so `MappingEditor` can seed the target-table dropdown
- `app/import/mapping-editor.tsx` — F4 + F5 client component. Per-source-table panel: target-table picker → auto-map → column table with `unmapped/ignored/target` three-way select (claim-once), type-mismatch badge, natural-key checkboxes, `hs_name`/`hs_path` (target `useForPages` only). Below the column table, one `ForeignKeyPanel` per source column mapped to a `FOREIGN_ID` target: sibling-source picker, match-key picker, multi+delimiter, onMissing, matching mode, and a live `countResolvable`-driven matched/unmatched/empty preview. Live-refreshes `validateSource` warnings on state change
- `app/import/import-order-panel.tsx` — F6 client component. Numbered vertical list of the derived toposort (or cycle-break) order, with per-row dependencies + deferred-edge callouts. Rendered on `/import` above the table cards once any mapping has FK configs
- `app/api/portals/[id]/dry-run/route.ts` — F7 endpoint: `{sources, mappings}` in, existing draft rows fetched per target, `computeDryRun` report returned
- `app/api/portals/[id]/execute/route.ts` — F8 endpoint: synthesize → `importRows` → optional `pushLive` per publish mode. 400 on synthesis issues, 409 on preflight, 502 on generic HubSpot failure (echoes partial events). Body accepts optional `resumeJobId` — when set, reuses the existing job row (verified via `getJobById`, 404 if gone) instead of creating a new one; the wizard's Resume banner sets it. Passes `ImportHooks` bound to `job-batches` + `key-maps` repos so every batch attempt + completed key map is written for audit + future Inngest wiring. **On any `HubdbError` (via type-guard on `err instanceof HubdbError`), 502 response includes `hubspot: {status, path, method, body: err.responseBody}` so the client can render the actual HubSpot rejection reason — without this, `HubdbError.message` is just `HubDB POST /path → status`, which is opaque. Also `console.error("[execute] HubDB error …", body)` server-side for dev-console visibility.**
- `app/import/dry-run-panel.tsx` — F7 client component. Run/re-run button, per-table metrics + coercion/unresolved lists, unresolved-refs CSV download
- `app/import/execute-panel.tsx` — F8 client component. Publish selector (`none` / `foreign-only` / `all`), Execute button, per-table result cards (created/updated/skipped/errors), publish results list, collapsible event log
- `app/portals/page.tsx` + `portal-form.tsx` — server list + client form. Red badge for `env: production` per F1. Each row has a `schema →` link to the F3 introspection page
- `app/portals/[id]/schema/page.tsx` + `refresh-button.tsx` — F3 introspection page. Server component decrypts the portal token and calls `fetchPortalSchema`; renders published/draft badge + row count + column list (with FK target-table + display-column ids). `RefreshButton` uses `useTransition` + `router.refresh()`
- `app/import/page.tsx` + `source-uploader.tsx` — F2 page. Server-fetches portals for the target picker + client uploader with CSV/XLSX/JSON/Google-Sheets tabs, override controls, and per-table preview grid (first 20 rows) + warnings. **Wizard state persists to `sessionStorage`** under `hubdb-importer:wizard:{portalId}` — mode + mappings + selectedProfileId + gsheetRows, so nav to `/portals/[id]/schema` and back doesn't drop config. Raw parsed rows intentionally NOT persisted (5 MB cap). Hydration uses `useRef` gate (not state — would trip `react-hooks/set-state-in-effect`). Persist effect skips empty payloads and `removeItem`s the key instead — protects against effect-ordering where persist fires before hydration commits and would overwrite saved data with defaults. "Restored N mapping(s)" banner + "Clear session" button appear when hydration loaded mappings but `state.kind === "idle"`. Resume flow (`?resume=<jobId>`) takes precedence over session hydration
- `app/portals/[id]/schema/schema-planner.tsx` — F3 diff/provision client component (paste/upload a schema definition → per-table verdict cards → Provision button when `plan.ok`)
- `app/page.tsx` — home page with hero + 4 quick-start tiles (Portals / Import / Jobs / Docs) + footer. Sidebar handles cross-page nav so the tiles are for onboarding, not primary navigation
- `app/docs/page.tsx` — end-user guide at `/docs`. Six sections (overview / example dataset / prerequisites / 8-step walkthrough / reference / troubleshooting) rendered from a shared `SECTIONS` const. Two-column grid on `lg`: content + sticky scroll-spy TOC. Downloadable example dataset lives at `public/examples/{brands,categories,products}.csv` + `schema.json` (v1 schema, exercises TEXT / URL / NUMBER / RICHTEXT / FOREIGN_ID). `app/docs/docs-toc.tsx` (client) renders both variants (sticky sidebar on `lg`, inline card below) driven by one `IntersectionObserver` with `rootMargin: "-20% 0px -70% 0px"` so the topmost intersecting section wins. `app/docs/sections.ts` is the single source of truth for section id + title — add a section here, add one `<Section id="...">` in the page, and both TOC variants pick it up
- `components/ui/page-header.tsx` — shared `PageHeader` (icon + h1 + description + optional trailing `children` slot). `PAGE_ACCENTS` const maps each top-level section → `{icon, color}` where color is a `var(--color-brand-*)` string. Renders the icon at 40px via CSS mask + inline `backgroundColor` (distinct from nav's `bg-current` version — page-header doesn't have a natural text-color context so the mask fill needs the color explicitly). H1 text color is the accent too. Every top-level page (Home, Portals, Portal-schema (inherits Portals purple), Import, Jobs, Docs) uses this. Swap `PAGE_ACCENTS.<section>.color` and both the nav pill and page header update together
- `app/nav.tsx` — `Sidebar` (fixed left, 224px, `md:` and up) + `MobileNav` (horizontal top bar under `md`). Uses `usePathname()` for active-route highlight (exact match for Home, prefix match for the rest so `/portals/[id]/schema` still highlights "Portals"). `aria-current="page"` on the active item. Sidebar header renders the Saltedstone wordmark (`public/saltedstone-logo.svg`, forest-fill, `dark:invert`) + "S2 HubDB Importer" title. Icons pulled from Saltedstone's S2 set (`public/icons/*.svg`) and rendered via CSS `mask-image` + `bg-current` so the flat-forest glyphs inherit the current text color — flips forest ↔ offwhite between active/inactive + light/dark without any per-state CSS. Each `NavItem` carries an `activeBg` field with a `var(--color-brand-*)` string; the active state background is injected inline (Home=ochre, Portals=purple, Import=grass, Jobs=burgundy, Docs=navy). Bail early (return null) on `/login` + `/register` via the `AUTH_PATHS` set so auth cards get the full viewport. Sidebar bottom shows signed-in user email + `LogoutButton` when the `userEmail` prop is set
- `proxy.ts` — Supabase Auth gate on Edge (renamed from `middleware.ts` for Next 16 per the framework's naming migration). Reads the session via `@supabase/ssr` `createServerClient` + `req.cookies`; redirects to `/login?next=<url>` if unauthenticated. Public paths (`/login`, `/register`, `/api/auth/*`, `/favicon*`, `/icon*`, `/apple-icon*`) always pass through via `PUBLIC_PREFIXES`. **Matcher regex skips static file extensions** (`.svg/.png/.jpg/.jpeg/.gif/.webp/.ico/.avif`) so `public/*` assets (like `saltedstone-logo.svg` on `/login`) don't hit the middleware and 307-redirect to `/login` — that was the "logo not displaying" bug. Dev-mode fallback: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` unset → no auth (local `pnpm dev` on a bare `.env.local` still works). **Uses `NextResponse.next({ request: req })` + cookie writeback pattern** — Supabase rotates access tokens on read within a refresh window, and the refreshed cookie needs to land on the response or the next request uses the stale token. Basic Auth was removed on 2026-09-27 in favor of per-user Supabase Auth (was a legacy fallback)
- `app/login/page.tsx` + `login-form.tsx` — Sign-in page. Server component + `"use client"` form. Uses browser client's `signInWithPassword`; on success `router.push(next); router.refresh()` so server components re-render with the session cookie visible. Preserves `?next=` param through the register link
- `app/register/page.tsx` + `register-form.tsx` — Registration page. Client-side domain validation via `isAllowedEmail` (UX only), POST to `/api/auth/register` (server re-validates — never trust client). Password ≥ 8 chars, confirm-password match
- `app/api/auth/register/route.ts` — server-side signup. Re-validates the @saltedstone.com domain via `normalizeAndCheckEmail`, calls `supabase.auth.signUp`. 409 on "already registered", 202 with `pendingConfirmation: true` if Supabase "Confirm email" is enabled (surfaces the misconfig instead of silent-fail), 400 otherwise
- `app/api/auth/logout/route.ts` — POST-only (dodges pre-fetch / GET-request logouts). Calls `supabase.auth.signOut()` which clears the session cookie
- `app/logout-button.tsx` — client button that double-clears (browser `signOut()` + POST to `/api/auth/logout`). Cheap belt-and-suspenders on the security-adjacent action. Rendered in `Sidebar` when `userEmail` prop is set
- `app/layout.tsx` + `app/globals.css` — Hanken Grotesk wired via `next/font/google` as `--font-hanken-sans` (Geist Mono kept for `<code>` via `--font-geist-mono`); body is `flex` with `<Sidebar />` + `<MobileNav /> + {children}`; existing pages keep their own `<main>` inside the remaining viewport. `globals.css` exposes the full Saltedstone brand palette as `--color-brand-*` CSS variables at `:root` (ochre / forest / coffee / purple / olive / burgundy / navy / chestnut / lilac / yellow / grass / red / blue / thistle / butter / mint / salmon / sky / sand / cream / offwhite / slate); every shadcn token (`--primary`, `--background`, `--foreground`, `--muted`, `--accent`, `--destructive`, `--border`, `--ring`, `--sidebar-*`, `--chart-1..5`) remaps onto them. Reach for a specific shade via `bg-[var(--color-brand-lilac)]` etc. **Watch out**: `--font-sans` in `@theme` must point at `--font-hanken-sans` (the variable `layout.tsx` exports), not at itself, or the body font silently falls back to Times
- `supabase/migrations/20260915000000_init.sql` — DDL for all 6 phase-1 tables + `set_updated_at()` trigger. Applied against the cloud project; verify via `pnpm spike scripts/spike/12-supabase-ping.ts`

## Stack

- **Next.js 16** App Router (PRD says 15; `create-next-app` shipped 16 — App Router surface is compatible)
- React 19, TypeScript 5, Tailwind CSS v4 (`@tailwindcss/postcss`)
- **shadcn/ui on Base UI** (`base-nova` preset) — components land in `components/ui/` (currently `button`, `select`, `tutorial-panel`, `checkbox`, `page-header`), `cn` helper in `lib/utils.ts`. Add more via `pnpm dlx shadcn@latest add <name>` — the auto-picked variant matches the preset. **Canonical form-control height: `h-9` (36px).** Both `button.tsx` (`default` + `sm` variants) and `select.tsx` (same) are set to `h-9 px-3`; text inputs match via explicit `h-9 px-3` on the class. `xs` for tiny inline actions (h-6); `lg` for prominent CTAs (h-10). `globals.css` also strips the WebKit spinner on `<input type="number">` so numeric inputs sit at the same 36px as text inputs. **Base UI Select gotchas** (learned the hard way): (1) `onValueChange` fires with `string | null` (not just `string`), (2) empty-string values are reserved for the "no selection" state — items that need to represent "unset / none / auto" use a sentinel constant that maps back to `""` at the boundary (see `AUTO_SENTINEL` in `source-uploader.tsx`, `NONE_SENTINEL` + `UNMAPPED_SENTINEL` in `mapping-editor.tsx`), (3) **trigger display comes from `Select.Root`'s `items` prop, not from `<SelectItem>` children.** `Select.Item.label` is only for keyboard text-navigation matching. `Select.Value` stringifies the raw value unless you pre-declare a value→label map via `items={[{value, label}, ...]}` on `<Select>`. Every dropdown whose display label differs from its value (portal picker, target picker, FK target, delimiter labels, onMissing labels, publish-mode labels, etc.) passes both `items` (for the trigger) and JSX `<SelectItem>` children (for the popup rich rendering). Portal-mount-lazy trap: any "auto-wire from SelectItem children" solution via Context/Refs fails because Base UI renders SelectItems inside a lazy Portal that doesn't exist until the popover opens, (4) **controlled/uncontrolled trap**: `value={x ?? undefined}` makes Base UI treat the Select as *uncontrolled* on first render — subsequent user clicks fire `onValueChange` and update the trigger label via Base UI's internal state, but the parent `useState` **never gets committed** (Base UI ignores value-prop changes once uncontrolled). Silent breakage: UI looks configured but state is `null`. Use `value={x ?? ""}` (always a string, always controlled) + always pass `items` prop. Empty string is the "no selection" sentinel; parent's `onChange` handler should coerce it back to `null` if needed. Symptom: no `Resolvability preview` on a FK panel that displays selected values (fixed in `ForeignKeyPanel` — smoke test surfaced this)
- pnpm (pinned via `packageManager` in `package.json`)
- ESLint 9 flat config (`eslint.config.mjs`)
- **No `src/` dir** — `app/`, `components/`, `lib/`, `workers/` sit at the repo root (matches PRD §9 layout)
- **Vitest 5** as the test runner, colocated `*.test.ts` next to source (not a `tests/` dir). Note: no `vitest.config.ts` yet — import from `lib/` with relative paths, not the `@/` alias
- Deps: `@supabase/supabase-js`, `zod`, `papaparse`, `xlsx` (SheetJS 0.18.5, Apache 2.0), `lucide-react` (icons)

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
pnpm spike scripts/spike/14-composite-multi-onmissing.ts   # composite NK + multi-value FK + onMissing null/fail/create-stub (~7s)
pnpm spike scripts/spike/15-rate-limit.ts                  # progressive parallel-read bursts + 429 measurement (~50s incl. cooldowns)
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
