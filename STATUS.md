# Project status

Running log of where the HubDB Importer project is, what's in flight, and what's next. Update as we go.

## Current state — 2026-09-15

**Phase:** 1 — MVP (in progress; core lib layer complete)

**Blocked on:** nothing. Wrapper + graph + schema + provisioner are all shipped, typechecked, and tested (40 vitest cases, 3 suites). Spike scripts re-pass against the sandbox.

**Next up (unblocked):**
- **Validate the PATCH-as-full-replace assumption** the provisioner bakes in (add a spike script or a sandbox integration test). Cheapest thing to de-risk before Supabase/UI work.
- `lib/resolve.ts` (F8 — key-map builder + FK resolver for the importer).
- F1 portal-connection API + Supabase scaffolding (starts the app-layer work).

### What exists
- Next.js 16 App Router scaffold (TypeScript, Tailwind v4, ESLint 9, pnpm)
- shadcn/ui initialized (base-nova / Base UI) — `Button` under `components/ui/`
- PRD (`hubdb-importer-prd.md`) and phase plans (`phases/phase-0…phase-3.md`)
- Phase-0 spike harness — `scripts/spike/*.ts`, runs via `pnpm spike <path>` with `.env.local` loading; all migrated onto `lib/hubdb/`
- Phase-1 foundations:
  - `lib/hubdb/` — typed HubDB wrapper: `createHubdbClient()` factory with 429/5xx retry + `Retry-After` handling; id normalization (all ids returned as strings); typed operations for tables (`list/get/create/patch/pushLive`) and rows (`listAll{Draft,Live}Rows`, `batch{Create,Update,Purge}DraftRows`); `/rows/draft/batch/*` path shape hard-enforced (F0-5), 100-row cap asserted (F0-6)
  - `lib/graph.ts` — directed dependency graph shared by provisioner/importer/publisher: `toposort()`, `toposortOrThrow()` (F6 "reject with clear message"), `breakCycles()` (F6 "offer two-phase write") with deferred-edge output for column-less create + PATCH-in strategy; converters from `HubdbTableInput` and `HubdbTable`; iterative Tarjan's SCC for cycle detection
  - `lib/schema.ts` — schema-file parser (zod) + cross-ref validator (surfaces all issues at once, not fail-first) + `resolveDefaults` (FK `foreignColumn` defaults to target's single-column `naturalKey`) + `diffSchema` returning per-table `create | match | update | conflict` (never emits drop or retype — F3)
  - `lib/hubdb/provision.ts` — topological two-phase provisioner. Takes an injectable `ProvisionOps` adapter (not the raw client) for testability; `opsFromClient(client)` builds the real one. Self-references included in the graph so `breakCycles` catches them. Phase 2 groups deferred edges by source and PATCHes the missing FK columns in per table. **Conservative PATCH assumption**: sends `portal.columns + new columns` (existing ids preserved) — safe if HubDB PATCH is full-replace *or* merge, but not yet validated against the sandbox
  - `vitest` — 5.0.1 installed; suites colocated with source (`lib/graph.test.ts`, `lib/schema.test.ts`, `lib/hubdb/provision.test.ts`); `pnpm test` / `pnpm test:run`. 40 cases across 3 suites, all green
- Git: `main` tracking `origin/main` at https://github.com/junelapera/hubspot-importer

### In flight — Phase 1 foundations
| # | Task | Status |
|---|---|---|
| 1 | `lib/hubdb/client.ts` — factory, retry/backoff, `HubdbError` with rate-limit surface | done |
| 2 | `lib/hubdb/types.ts` — normalized shapes (string ids), `isPublished()` treating epoch as unpublished (F0-9) | done |
| 3 | `lib/hubdb/tables.ts` — list/get/create/patch/pushLive | done |
| 4 | `lib/hubdb/rows.ts` — draft/live pagination + `batch/{create,update,purge}` under `/rows/draft/` (F0-5), 100-row cap asserted | done |
| 5 | Migrate spike scripts onto `lib/hubdb/` (regression check) | done — 00-ping re-passes against sandbox |
| 6 | `lib/graph.ts` — toposort + cycle detection + two-phase decomposition | done — 25 hand-verified assertions |
| 7 | Test runner — Vitest installed; suites colocated with source | done — `pnpm test:run`, 40 cases green |
| 8 | `lib/schema.ts` — parse + validate schema file, diff vs portal | done — 21 cases (parse failure modes + every diff verdict incl. FK conflicts) |
| 9 | `lib/hubdb/provision.ts` — compose wrapper + graph into topological provisioner (name-based FK happy path from F0-2) | done — self-loop + 2-cycle break paths tested via fake ops |
| 10 | **Validate PATCH-as-full-replace assumption** in `provision.ts` against the sandbox | pending — de-risk before broader wiring |
| 11 | `lib/resolve.ts` — key map builder + FK resolver (F8) | pending |
| 12 | Supabase project + `portals` / `mappings` / `jobs` / `job_batches` / `job_errors` / `key_maps` tables | pending |
| 13 | F1 portal-connection API + encrypted token storage | pending |
| 14 | Rate-limit stress test (still-open Phase-0 question) | pending |
| 15 | Long-job runner strategy (still-open Phase-0 question) | pending |

### Archived — Phase 0 tasks
| # | Task | Status |
|---|---|---|
| 1 | Scaffold spike harness (env, tsx, client) | done |
| 2 | Confirm API path (`v3` vs dated `2026-03`) | done — both functionally equivalent at `/tables`; defaulting to `v3` |
| 3 | Provision `brands` + `categories` foreign tables | done — `brands` id `412407343`, `categories` id `412407344` (both draft) |
| 4 | Reproduce `Foreign table id must be defined` error | done — actual message: *"Foreign table id **or foreign table name** must be defined"* |
| 5 | Provision `products` main table w/ two FK cols | done — id `412407345` (draft); name-based FK accepted, server-resolved to ids |
| 6 | Batch-insert 200 rows into foreign tables, capture IDs | done — 200 rows in each of `brands` + `categories`, two 100-row batches per table, slug→id maps built |
| 7 | Batch-insert 200 linked rows into `products` | done — 200 rows, FK cells stored verbatim; UI displays blank until foreign tables published |
| 8 | Push-live all three tables in dependency order | done — all three live, 200 rows each, row ids stable draft→live |
| 9 | Document findings in `phases/phase-0-spike.md` | done — 9 findings + 6 locked-in decisions + open questions rolled into Phase 1 |

HubL render (last item in phase-0 checklist) deferred — do manually in HubSpot page editor after API chain is proven.

### Open questions still un-answered (PRD §13)
1. Single main table per mapping, or multiple?
2. Rows in HubDB but absent from source — leave / flag / delete?
3. Prod-write gating (second confirmation or approval)?
4. Verification read-back (auto-generated HubL join snippet)?
5. Schema file authoring: hand-committed vs UI-built?
6. Schema file + import mapping — one file or two?

### Decisions locked in during scaffold
- **Package manager:** pnpm (pinned in `package.json`)
- **Framework version:** Next.js **16** (PRD said 15; `create-next-app` shipped 16 — App Router surface compatible)
- **UI kit:** shadcn/ui on Base UI (`base-nova` preset)
- **Repo layout:** no `src/` — `app/` `components/` `lib/` `workers/` at root, matches PRD §9
- **Spike code shape:** standalone `scripts/spike/` CLI (tsx), not API routes
- **Test runner:** Vitest 5, colocated `*.test.ts` next to source (not a `tests/` dir). Peer warning: vitest wants `@types/node ^22 || >=24` but Next.js pins `^20` — warning only, suite runs

---

## Log

### 2026-09-15
- Kicked off Phase 1. Started with the item STATUS+CLAUDE.md called out first: `lib/hubdb/` typed wrapper hardening
- Wrote `lib/hubdb/client.ts` — `createHubdbClient({ token, ... })` factory (per-portal, no global env read). Retries 429 + 5xx with `Retry-After` honored, else exponential backoff with jitter capped at 30s (default 5 attempts). `HubdbError` exposes status, parsed rate-limit headers, and attempt count
- Wrote `lib/hubdb/types.ts` — normalized shapes. Table `id`, row `id`, `foreignTableId`, `foreignColumnId` are all `string` (F0-4 wrapper contract). Added `isPublished()` that treats the `1970-01-01T00:00:00Z` epoch as "never published" (F0-9)
- Wrote `lib/hubdb/tables.ts` (`listTables/getTable/createTable/patchTable/pushLive`) and `lib/hubdb/rows.ts` (`listAllDraftRows/listAllLiveRows`, `batch{Create,Update,Purge}DraftRows`). Batch mutation paths are hard-coded to `/rows/draft/batch/{create,update,purge}` (F0-5). 100-row cap asserted before the call (F0-6)
- Migrated all 7 spike scripts onto the new wrapper. `scripts/spike/client.ts` shrank to ~30-line shim that builds one `HubdbClient` from `HUBSPOT_TOKEN` and re-exports `log`/`runSpike`/`HubdbError`. Spikes now act as regression checks of the wrapper — any break in id normalization, retry, or batch paths surfaces when re-running them
- Smoke-tested `pnpm spike scripts/spike/00-ping.ts` against the sandbox. Green: both `v3` and `dated` bases return 4 tables (~800ms each), all ids as strings
- Wrote `lib/graph.ts` — the topological sort shared by provisioner + importer + publisher. Kahn's for order, iterative Tarjan's for SCC / cycle detection. Three public entry points: `toposort()` (partial order + cycles report), `toposortOrThrow()` (F6 "reject with clear message"), `breakCycles()` (F6 "offer two-phase write"). Converters: `nodesFromTableInputs` (name-based FK, the F0-2 happy path) and `nodesFromHubdbTables` (id-based). Convention: `GraphNode.dependencies` = prereqs; `GraphEdge {from, to}` mirrors that ("from depends on to")
- Wrote `scripts/graph-check.ts` — 25 hand-verified assertions across linear DAG, spike scenario, self-loop, 2/3-node cycles with dangling dependents, `toposortOrThrow` cycle payload, `breakCycles` deferred-edge output, disjoint tie-break stability, both converters, and duplicate-name rejection. Two bugs shaken out during the check: (a) edge direction inverted (adj stored `n→dep` but Kahn's needed `prereq→dependent`); (b) `toposort` emitted cycle nodes when they had no non-cycle prereqs — semantic decision to filter them out and force callers to `breakCycles` if they want an order that covers cycle nodes
- **Caveat — not a test runner.** `scripts/graph-check.ts` is a one-shot assertion runner, not Vitest. No CI, no watch mode, no `describe/it`. Fine for shaking bugs out at write-time; needs to be replaced by a proper test runner before the module has real callers. Phase 1 task #7 tracks this
- **Wrote-time artifact worth watching.** First Write of `lib/graph.ts` landed with `U+0000` (null bytes) in two template literals where the source had spaces (`` `${e.from} ${e.to}` `` → `` `${e.from}\0${e.to}` ``). Detected via `cat -A` when an Edit failed to match. Recovered by rewriting the file. Unclear whether the corruption was in the Write tool, the terminal bridge, or my own emission. Did not recur in `lib/schema.ts` or `lib/hubdb/provision.ts` — one-off so far
- Installed **Vitest 5** and ported `scripts/graph-check.ts` to `lib/graph.test.ts` (12 `describe/it` blocks). Deleted the smoke script. `pnpm install` had to run first — pnpm store path drifted from snap `code/261` → `code/263` (VS Code snap version bump) and node_modules was linked to the old store. One-time relink, harmless. Peer warning: vitest wants `@types/node ^22 || >=24` but Next 16 pins `^20`; warning only, suite runs
- Wrote `lib/schema.ts` — zod schema for structural parse, then a manual cross-ref pass that surfaces *all* issues at once (duplicate table/column names, dangling FK targets, FK missing `foreignTable`, `foreignColumn` not on target, `naturalKey` referencing an undefined column). `resolveDefaults` fills FK `foreignColumn` from the target's single-column `naturalKey` when omitted; composite `naturalKey` leaves the caller to be explicit. `diffSchema(schema, portal)` returns per-table `create | match | update | conflict` with three conflict shapes (`column-type-mismatch`, `fk-target-mismatch`, `fk-column-mismatch`); never emits drop/retype (F3). Extra portal columns not in the schema are ignored — schema is additive, not authoritative-over-portal. 21 vitest cases covering parse failure modes + every diff verdict
- Wrote `lib/hubdb/provision.ts` — takes an injectable `ProvisionOps` adapter (not the raw client) so tests can plug in a fake with internal state instead of MSW. `opsFromClient(client)` builds the real adapter. Dep graph nodes are built only from `create` + `update` actions; a table depends on another *only if the target is also being created* (updates/matches already exist in the portal). Self-references are included so `breakCycles` catches them. Phase 2 groups deferred edges by source and PATCHes the missing FK columns per table
- **PATCH semantics conservatism.** The provisioner sends `portal.columns + new columns` on every PATCH (existing ids preserved). Safe assumption if HubDB PATCH is either full-replace *or* merge — but not yet validated against the sandbox. Added a Phase-1 task to spike this before broader wiring
- **Bug shaken out in provisioner:** initial version filtered `col.foreignTable !== name` when building deps, so self-loops were invisible to the graph and got sent to `createTable` with the self-referencing FK column intact. Caught by the self-loop test on first run; fix was one line
- **Next step:** validate PATCH semantics against the sandbox, then either `lib/resolve.ts` (F8) or start the F1 portal-connection API + Supabase scaffolding

### 2026-09-14
- `.env.local` provisioned with `HUBSPOT_TOKEN` — spike unblocked
- Extended `00-ping.ts` to hit both `/cms/v3/hubdb/tables` and `/cms/hubdb/2026-03/tables` in parallel with timing
- Both paths returned identical results (1 existing table `trst`, ~730–760ms). Task #2 resolved — defaulting to `v3`
- Wrote `01-provision-foreign.ts` — idempotent create of `brands` + `categories` (both with `name` + `slug` TEXT columns), plus a deliberate bad-FK POST to capture the error surface
- Ran it: `brands` (`412407343`) and `categories` (`412407344`) created as draft. Bad FK returned HTTP 400 with the message *"Foreign table id or foreign table name must be defined"*
- **Finding — revisit PRD §6/§8:** HubSpot accepts `foreignTableName` as an alternative to `foreignTableId` on `FOREIGN_ID` columns. Schema files could reference foreign tables by name directly, skipping the schema-local-id → HubSpot-id translation step at provision time. Still need to confirm the same holds for `foreignColumnName` vs `foreignColumnId`
- Wrote and ran `02-provision-main.ts` — created `products` (id `412407345`, draft) with two `FOREIGN_ID` columns. The name-based path **succeeded on the first attempt** — no fallback needed. HubSpot resolved `foreignTableName: "brands"` + `foreignColumnName: "name"` server-side and returned `foreignTableId: 412407343`, `foreignColumnId: 1`

**Architectural impact — PRD §6 and §8 need revision:**
> "The provisioner translates to `foreignTableId` / `foreignColumnId` integers at write time so schema files are portable across portals."

That translation step is now **optional**. Schema files can be authored with `foreignTable: "brands"` + `foreignColumn: "name"` (names) and passed through to the API unchanged; HubSpot resolves in-portal at write time. Cross-portal portability comes for free. The provisioner still needs the id-translation code path as a fallback (e.g. for topology inspection, cycle-breaking PATCHes, or if we ever hit a scenario name-resolution can't handle), but it's no longer the primary path.

**Additional API observations to bake into the wrapper:**
- HubDB column ids are **per-table sequential integers** (both `brands.name` and `categories.name` are id `1`) — not globally unique. Any code comparing column ids across tables is a bug
- Response type inconsistency: `FOREIGN_ID` column echoes `foreignTableId`/`foreignColumnId` as **numbers**, while `/tables` list returns table `id` as a **string**. `lib/hubdb/` wrapper should normalize to strings on ingest

- Wrote `03-insert-foreign.ts` — generates deterministic rows (`brand-001`…`brand-200`, `category-001`…`category-200`), reads existing draft rows for idempotency, batches at 100 rows/call, builds `slug → row-id` maps
- First run 404'd on `POST /tables/{name}/rows/batch/create` with an HTML body (edge/gateway 404). **Correct endpoint is `/rows/draft/batch/create`** — batching is scoped under the draft namespace, not the top-level rows path. Fixed and re-ran successfully
- 200 rows inserted into each of `brands` + `categories` via two 100-row batches. Throughput ~800–1020ms per 100-row batch (~100–125 rows/sec, single-threaded). No dropped rows. Row IDs are 12-digit global HubSpot ids (`"221835620680"`), reinforcing the wrapper's id-normalization TODO
- **API surface additions for `lib/hubdb/`:**
  - Only `/rows/draft/batch/{create,update,purge}` is valid — hardcode the `draft` segment
  - Read draft rows from `/rows/draft` (with `limit` + `after` cursor for pagination — PRD §10 says 1000 default)
- Wrote and ran `04-insert-main.ts` — read `brands` + `categories` draft rows in parallel, built slug→id maps, generated 200 products with 1:1 FK assignment (`product-001` → `brand-001` + `category-001`), inserted via two 100-row batches to `/rows/draft/batch/create`. Timings ~1024ms + ~797ms
- **Finding — FK cells round-trip verbatim.** Sent `{id, type: "foreignid"}` and got back the same. No server-side normalization, no `foreignTableId` bleed onto the cell, no join expansion. Write and read shapes are symmetric — the resolver stays simple. The target table is pinned by the *column definition*, not the cell
- Row IDs across all three tables share one global integer namespace (`221835620680` brand → `221835620868` product, adjacent). Not per-table. Wrapper should never assume table-scoping on row ids
- Wrote `99-inspect.ts` to spot-check state — confirmed 200 draft / 0 live rows in each of `brands`, `categories`, `products`. `publishedAt: "1970-01-01T00:00:00Z"` is HubSpot's null-sentinel for "never published"
- **Finding — UI display of FK columns requires the foreign table to be published.** In the HubSpot HubDB editor, `products.brand` cells show blank even though the id is stored, because the display value is resolved from the foreign table's `name` column (`foreignColumnId: 1`) and only reads the *live* version. Publishing `brands` + `categories` first should make products' FK cells render — this is exactly what task #8 tests
- Wrote and ran `05-publish.ts` — sequential `POST /tables/{name}/draft/push-live` for `brands` → `categories` → `products`. All three returned `published: true` with fresh `publishedAt`. Timings: `brands` 959ms, `categories` 1736ms, `products` 923ms (~3.6s wall-clock). Re-ran `99-inspect.ts` — live counts now 200 in each table, row ids stable across draft/live (publish promotes rather than duplicates)
- **Finding — topological order is a UI/HubL requirement, not an API requirement.** Publishing `products` before `brands` would still succeed at the API level, but products' FK display columns would be blank in the HubSpot UI and HubL joins would return nothing until foreign tables catch up. The dependency order stands, but the rationale is "user-visible correctness" not "API validation"
- Categories publish was ~2× the others (1736ms vs ~940ms). Could be variance or FK-constraint re-check on the second foreign table publish. Worth watching in longer runs
- Rewrote `phases/phase-0-spike.md` — checked off all completed items with the artifact ids inline (`brands` `412407343`, etc.), documented 9 findings (F0-1 through F0-9), locked in 6 decisions for Phase 1, and rolled the two un-answered items (rate-limit ceiling, long-job runner strategy) forward as Phase-1 open questions
- **Phase 0 closed.** Remaining Phase-0 checkbox (HubL page render) is a manual editor test that does not gate Phase 1 code work
- **Next step:** kick off Phase 1 — start `lib/hubdb/` (typed wrapper hardening: id normalization to strings, `/rows/draft/batch/*` path enforcement, 429 backoff with `Retry-After`), then `lib/graph.ts` (topological sort shared by provisioner + importer). See `phases/phase-1.md` for the full task list

### 2026-09-12
- Wrote PRD `hubdb-importer-prd.md`
- Broke PRD §12 into per-phase task checklists under `phases/`
- Wrote `CLAUDE.md` guidance for future Claude Code sessions
- Scaffolded Next.js 16 app via `create-next-app`, added shadcn/ui, pushed to GitHub
- Started Phase 0: added `tsx` + `zod` deps, wrote `scripts/spike/client.ts` (typed HubSpot fetch wrapper with `HubdbError` surfacing rate-limit headers) and `00-ping.ts` (list tables). Added `pnpm spike` script
