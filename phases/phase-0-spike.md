# Phase 0 — Spike (1–2 days)

**Goal:** Prove the full HubDB relational chain works end-to-end via the API before committing to the MVP build.

**Status:** Chain proven end-to-end (provision → insert foreign → insert linked → publish). Live `products` rows render brand + category display values in the HubSpot UI. HubL page render deferred to manual check.

## Setup
- [x] Sandbox portal — using the user's dev portal (`HUBSPOT_PORTAL_ID` in `.env.local`)
- [x] Private app token with `hubdb` scopes — configured as `HUBSPOT_TOKEN`
- [x] API path confirmed — `v3` and dated `2026-03` are **functionally equivalent** at `/tables`; defaulting to `v3` (shorter, evergreen)
- [ ] Rate-limit / 429 backoff — **not formally measured.** No 429s during Phase 0 (single-threaded, ~800–1700ms per batched call, ~10 total mutating calls). Needs a stress test in Phase 1 with concurrent batches to validate the wrapper's backoff + `Retry-After` handling

## API chain proof
- [x] Provision `brands` + `categories` foreign tables via API as draft — `brands` id `412407343`, `categories` id `412407344`
- [x] Provision `products` main table with two `FOREIGN_ID` columns — id `412407345`
- [x] Reproduce the FK-missing error — actual message: *"Foreign table id **or foreign table name** must be defined"* (see finding below — this is more permissive than the PRD assumed)
- [x] Batch-insert 200 rows into each of `brands` + `categories`, capture assigned row ids into a `slug → id` map
- [x] Batch-insert 200 linked rows into `products` using the FK wire format `[{ "id": "…", "type": "foreignid" }]`
- [x] `push-live` all three tables in dependency order — `brands` → `categories` → `products`, all now published with 200 live rows
- [ ] Render joined data on a HubSpot page with a nested HubL loop — **deferred** to manual test in the HubSpot page editor. The API chain is proven; HubL rendering is an editor-side verification, not code work

## Findings

### F0-1: API base — `v3` and dated `2026-03` are interchangeable
Both `/cms/v3/hubdb/tables` and `/cms/hubdb/2026-03/tables` returned identical results with similar latency (~730–760ms). Defaulting to `v3` in `scripts/spike/client.ts`. The dated base is kept as an option in `BASE_PATHS` for version isolation if we ever need to pin behavior.

### F0-2: Name-based FK references replace the id-lookup step (**PRD §6/§8 revision**)
The PRD's original architectural claim was that the provisioner must translate schema-local ids (`"foreignTable": "brands"`) into HubSpot `foreignTableId` integers at write time so schema files stay portable across portals.

**HubSpot's API accepts `foreignTableName` + `foreignColumnName` on `FOREIGN_ID` column definitions and resolves them server-side, in the current portal, at write time.** Response echoes back the resolved numeric `foreignTableId` / `foreignColumnId`; `foreignTableName`/`foreignColumnName` are write-time conveniences, not stored state.

**Impact:**
- Schema files can be authored with foreign-table *names* and passed through to the API unchanged — no client-side id-lookup step required for the happy path
- Cross-portal portability is automatic (HubSpot resolves in-portal)
- The id-translation code path is still needed in `lib/hubdb/` as a fallback for edge cases (topology inspection, cycle-breaking PATCHes, name collisions if any)

### F0-3: FK cell shape round-trips verbatim
Sent to the API:
```json
{ "brand": [ { "id": "221835620680", "type": "foreignid" } ] }
```
Read back from the API: identical. No server-side normalization, no `foreignTableId` bleed onto the cell, no join expansion. Write and read shapes are symmetric — resolver code just passes the array through.

The FK cell holds *only* the row id. The target table is pinned by the *column definition* (`foreignTableId` / `foreignColumnId`), not the cell. That's why `foreignid` is enough as a type discriminator on the cell.

### F0-4: HubDB row and column id semantics
- **Column ids are per-table sequential integers** (both `brands.name` and `categories.name` are id `1`). Never compare column ids across tables — that's a bug
- **Row ids are 12-digit global HubSpot ids** across all tables (`221835620680` brand, `221835620868` product, adjacent). Single global namespace. Wrapper must not assume table-scoping on row ids
- **Type inconsistency in responses** — table `id` returns as a **string** (`"377110628"`), but FK column echoes `foreignTableId` / `foreignColumnId` as **numbers** (`412407343`, `1`). `lib/hubdb/` should normalize all ids to strings on ingest before storing or comparing

### F0-5: Batch endpoint is under the draft namespace
- **Wrong:** `POST /tables/{name}/rows/batch/create` → 404 with an HTML body (edge/gateway 404, not a JSON API error)
- **Right:** `POST /tables/{name}/rows/draft/batch/create`

Hardcode the `draft` segment on batch mutation paths in the wrapper. Same pattern likely applies to `batch/update` and `batch/purge` — verify when we build them.

### F0-6: Batch size cap and observed throughput
- **Cap: 100 rows per call** (per PRD §10, not stress-tested against 101 to avoid polluting the spike tables with junk rows)
- **Observed throughput:** ~800–1024ms per 100-row batch, single-threaded → ~100–125 rows/sec
- 200 foreign-table rows in 2 batches × 2 tables + 200 product rows in 2 batches = ~7s total wall-clock for the full row-write phase
- Concurrency and rate-limit ceiling not yet measured (see F0-1)

### F0-7: Publish semantics
- Endpoint: `POST /tables/{name}/draft/push-live`
- Returns the table object with `published: true` and a fresh `publishedAt` timestamp
- **Row ids are stable across draft → live** — publish promotes state, it does not duplicate. `brand-001` is `221835620680` in both draft and live
- Sequential publish timings for the three-table chain: `brands` 959ms, `categories` 1736ms, `products` 923ms (~3.6s wall-clock). The `categories` outlier is unexplained — could be variance or an FK-constraint recheck; watch it in longer runs

### F0-8: Topological order matters for UI display, not API validation
Publishing `products` before its foreign tables would still succeed at the API level. But:
- The HubSpot HubDB editor renders FK columns by looking up the target row's display column (`foreignColumnId`) **in the live view of the foreign table**
- If the foreign table is unpublished, the display value resolves to nothing → FK cells appear blank in the UI even though the id is stored correctly
- HubL joins would return nothing until foreign tables are live

The topological publish order stands, but the rationale is **user-visible correctness** (UI + HubL), not API validation. Encoding this in `lib/graph.ts` as a hard requirement is still correct, just for the right reason.

### F0-9: Null-sentinel for `publishedAt`
Unpublished tables (and rows) return `publishedAt: "1970-01-01T00:00:00Z"` — the epoch, not `null`. Wrapper should treat epoch-zero as "not published" when computing display state.

## Open questions still open after Phase 0
- Rate-limit ceiling and 429 backoff — needs Phase 1 stress test
- Long-job runner strategy (serverless slice vs background queue) — not resolved by Phase 0; is a Phase 1 architectural decision. The spike ran as a one-shot CLI so it side-stepped the runner question
- HubL render — deferred to manual test in the HubSpot page editor once someone builds a page against `products`

## Locked in by Phase 0
- **API base:** `v3` (`/cms/v3/hubdb`)
- **FK authoring model:** schema files reference foreign tables by *name*, not id — PRD §6/§8 to be updated
- **FK cell shape:** `[{ "id": "…", "type": "foreignid" }]` — symmetric write and read
- **Batch endpoint path:** always `/rows/draft/batch/{create,update,purge}` — never omit the `draft` segment
- **Row-id space:** global integer namespace, strings in wrapper types, no per-table scoping
- **Publish order:** topological, foreign tables first, enforced by `lib/graph.ts`
