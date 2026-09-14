# Project status

Running log of where the HubDB Importer project is, what's in flight, and what's next. Update as we go.

## Current state — 2026-09-14

**Phase:** 0 — Spike (complete, pending manual HubL render check)

**Blocked on:** nothing. All Phase-0 code tasks done. HubL page render is a manual editor step per the Phase-0 plan and does not gate Phase 1.

**Ready for Phase 1** — wrap the proven API chain into `lib/hubdb/`, `lib/graph.ts`, and the schema/mapping layer. See `phases/phase-1.md`.

### What exists
- Next.js 16 App Router scaffold (TypeScript, Tailwind v4, ESLint 9, pnpm)
- shadcn/ui initialized (base-nova / Base UI) — `Button` under `components/ui/`
- PRD (`hubdb-importer-prd.md`) and phase plans (`phases/phase-0…phase-3.md`)
- Phase-0 spike harness — `scripts/spike/client.ts` + `00-ping.ts`, runs via `pnpm spike <path>` with `.env.local` loading
- Git: `main` tracking `origin/main` at https://github.com/junelapera/hubspot-importer

### In flight — Phase 0 tasks
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
- **Test runner:** not yet installed — Vitest is the leaning default

---

## Log

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
