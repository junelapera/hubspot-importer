# PRD — HubDB Importer (Next.js)

**Working name:** HubDB Importer
**Owner:** June (Salted Stone)
**Status:** Draft v0.1
**Last updated:** 11 Sep 2026

---

## 1. Problem

Importing structured data into HubDB is manual and error-prone. HubSpot's built-in CSV import handles one flat table at a time and cannot populate **Foreign ID** columns — those have to be clicked in by hand, row by row, in the HubDB UI. Any dataset that is actually relational (products → brands + categories, locations → regions + services, team → departments + offices) becomes hours of manual linking per client, repeated on every content refresh.

## 2. Goal

A self-hosted Next.js app that takes one or more source files, maps them to a **main HubDB table plus N foreign tables**, resolves foreign relationships automatically from human-readable keys (SKU, slug, name), writes everything in the correct dependency order, and publishes when clean.

### Success criteria

| Metric | Target |
|---|---|
| Time to import a 3-table, 1,500-row dataset | < 5 min, no manual linking |
| Foreign-key resolution accuracy | 100% on matched keys, 0 silent failures |
| Re-import of unchanged data | Idempotent — no duplicate rows |
| Failed import recovery | Resume from last successful batch |
| Reusability | Mapping saved as JSON, re-runnable per portal |

## 3. Non-goals (v1)

- Two-way sync (HubDB → source). Import only.
- Reading from HubSpot CRM objects as a source.
- Scheduled/cron imports. Manual trigger only.
- Multi-tenant SaaS with billing. Internal agency tool first.
- Building the HubDB tables' *page templates*. Data layer only.
- XLSX and Google Sheets sources.
- Destructive schema changes (dropping or retyping existing columns).

## 4. Users

| User | Need |
|---|---|
| CMS developer (primary) | Bulk-load relational seed data during theme builds and migrations |
| Migration engineer | Move WordPress/Drupal taxonomies + posts into HubDB with relationships intact |
| Client content ops (secondary, phase 2) | Re-upload an updated spreadsheet without dev help |

## 5. Assumptions to confirm

1. **Auth model:** v1 uses a **private app token per portal**, entered by the user and stored encrypted. OAuth multi-portal install is phase 2.
2. **Sources:** CSV upload and raw JSON in v1. XLSX and Google Sheets in phase 2.
3. **Table creation:** v1 **creates HubDB tables and columns from a schema definition**, including Foreign ID columns, as well as mapping to tables that already exist.
4. **Deployment:** self-hosted on Vercel, Supabase for job state, single-team access.

---

## 6. Core concepts

**Schema definition** — a JSON file describing the tables to exist: name, label, settings, and columns with types. Foreign ID columns are declared by *table id* (the schema's own identifier), not by HubSpot table ID, so one schema file is portable across portals. The app resolves ids to real HubSpot IDs at provision time.

**Import mapping** — a saved JSON config: source columns → HubDB columns, plus foreign relationship rules. Portable across portals since it references tables by *name*, not ID.

**Table role** — each table in a mapping is `main` or `foreign`. A `foreign` table may itself reference another foreign table (nested depth allowed).

**Natural key** — one or more source columns that uniquely identify a row (e.g. `sku`, `slug`). Used for two things: upsert matching, and foreign-key lookup.

**Two-pass import** — foreign tables are imported first to obtain HubSpot row IDs, then the main table is written with those IDs substituted into its Foreign ID columns.

**Key map** — in-memory + persisted `{ tableName → { naturalKeyValue → hubdbRowId } }` built during pass 1 and consumed in pass 2.

---

## 7. Functional requirements

### F1 — Portal connection
- Enter private app token; validate with a test call before saving.
- Token stored encrypted server-side; never sent to the browser after save.
- Support multiple saved portals (sandbox / production) with a visible environment badge.
- Required scopes surfaced in UI: `hubdb` (read + write). Block import if the token lacks them.

### F2 — Source ingestion
- Upload one CSV per table, or paste/upload a single JSON document containing a keyed set of tables.
- JSON shape accepted: `{ "tableId": [ { "col": "value" }, ... ] }`, or an array of `{ "table": "...", "rows": [...] }`. Nested objects are rejected with a pointer to the offending path — cells are scalars or delimited strings.
- CSV: detect delimiter, encoding, and header row; allow manual override.
- Preview first 20 rows per table.
- Warn on: duplicate natural keys, empty required columns, row count > 10,000, cell length > 10,000 (text) / 65,000 (rich text).

### F3 — Table introspection and provisioning

**Introspection**
- Fetch **draft** table schemas from the connected portal, including `columns[].type`, and for `FOREIGN_ID` columns the `foreignTableId` and `foreignColumnId`.
- Cache schemas per session; manual refresh button.
- Display each table's published/draft state and current row count.

**Provisioning from schema**
- Accept a schema definition file (or generate a starting one from CSV headers with inferred types, which the user then corrects).
- Diff schema against the portal and show a plan before touching anything: tables to create, columns to add, columns already matching, mismatches that need a manual decision.
- Create only what is missing. Never drop or retype an existing column in v1 — report the conflict and stop.
- **Ordering matters:** a `FOREIGN_ID` column needs a real `foreignTableId`, so provisioning runs in the same topological order as the import. Tables with no outbound references first, then referencing tables.
- `foreignColumnId` must point at a column that already exists in the target table, so it is resolved after that table's columns are created. If the schema doesn't name a display column, default to the target's natural key column.
- Cycles are handled in two passes: create both tables without their `FOREIGN_ID` columns, then PATCH the columns in.
- Tables are created as **draft** and are unusable via HubL or the API until published, so provisioning and row import share one publish step (F9).
- Provisioned table IDs are written back into the mapping profile so later runs skip creation.

**Schema file format**

```json
{
  "version": 1,
  "tables": [
    {
      "id": "brands",
      "name": "brands",
      "label": "Brands",
      "useForPages": false,
      "allowPublicApiAccess": false,
      "columns": [
        { "name": "slug", "label": "Slug", "type": "TEXT" },
        { "name": "name", "label": "Brand Name", "type": "TEXT" },
        { "name": "logo", "label": "Logo", "type": "IMAGE" }
      ]
    },
    {
      "id": "categories",
      "name": "categories",
      "label": "Categories",
      "columns": [
        { "name": "name", "label": "Name", "type": "TEXT" }
      ]
    },
    {
      "id": "products",
      "name": "products",
      "label": "Products",
      "useForPages": true,
      "columns": [
        { "name": "sku", "label": "SKU", "type": "TEXT" },
        { "name": "price", "label": "Price", "type": "CURRENCY" },
        { "name": "brand", "label": "Brand", "type": "FOREIGN_ID",
          "foreignTable": "brands", "foreignDisplayColumn": "name" },
        { "name": "categories", "label": "Categories", "type": "FOREIGN_ID",
          "foreignTable": "categories", "foreignDisplayColumn": "name" }
      ]
    }
  ]
}
```

`foreignTable` and `foreignDisplayColumn` are schema-local names. The app translates them into the `foreignTableId` / `foreignColumnId` integers the API requires — omitting either returns `Foreign table id must be defined`.

### F4 — Column mapping UI
- Per table: source column → target HubDB column, with auto-match on normalized name.
- Show HubDB column type; flag type mismatches (text into NUMBER, unparseable dates).
- Mark unmapped source columns as ignored (explicitly, not silently).
- Set natural key column(s) per table.
- Map `hs_name` and `hs_path` for tables with dynamic pages; validate that paths are lowercase and unique.

### F5 — Foreign relationship configuration (the core feature)
For every `FOREIGN_ID` column in the main table:
- Pick which **source table in this mapping** supplies it (the foreign table), pre-filled from `foreignTableId`.
- Pick the **match key** — the foreign table column whose values appear in the main file. This is independent of HubSpot's `foreignColumnId`, which only controls the UI display label.
- **Multi-value:** toggle on, with a delimiter (`,` `|` `;` newline). Foreign ID cells are multi-select, so many IDs per cell is native.
- **On missing reference:** `fail` (abort with report) | `skip row` | `null the cell` | `create stub row` in the foreign table.
- **Matching:** case-insensitive and trim-whitespace by default; strict mode available.
- Multiple Foreign ID columns per table, each pointing at a different foreign table, all resolved independently.

### F6 — Dependency ordering
- Build a directed graph from the foreign relationships and **topologically sort** it.
- Detect cycles (A → B → A) and either reject with a clear message or offer a two-phase write: insert main rows without foreign cells, then patch the cells after both tables have IDs.
- Show the resolved import order in the UI before running.

### F7 — Dry run
- Mandatory before first execution of any mapping.
- Reports, without writing anything: rows to create, rows to update, foreign references resolved, references unresolved (with row number + offending value), type coercion warnings, projected API call count.
- Downloadable CSV of unresolved references so the source file can be fixed.

### F8 — Execution
- Write to the **draft** table, batched at **100 rows per call** (API maximum).
- Upsert semantics: look up existing rows by natural key, PATCH matches, POST the rest.
- Persist job + batch cursor so a failed run resumes rather than restarts.
- Retry on `429` and `5xx` with exponential backoff, honouring `Retry-After`; throttle to stay under the portal's request-per-10-seconds ceiling.
- Cancel button that stops cleanly at a batch boundary.

### F9 — Publish
- After a clean run, `push-live` each touched table, in dependency order.
- Options: publish all / publish none / publish foreign tables only.
- Reminder in UI: draft rows render in the page editor and previews but **not** on live pages until published.

### F10 — Results & logging
- Per-table summary: created / updated / skipped / failed.
- Row-level error log with source row number, column, HubSpot error message.
- Download full log as CSV/JSON.
- Job history list with mapping name, portal, timestamp, outcome.

### F11 — Mapping profiles
- Save, name, duplicate, export, and import mapping JSON.
- Re-run a saved mapping against a new file or a different portal (table lookup by name makes this work).

---

## 8. Foreign key resolution — spec

### Pass 1: foreign tables
For each foreign table in topological order:
1. Upsert its rows.
2. Record `keyMap[tableName][normalize(naturalKeyValue)] = rowId`.
3. If the table already has rows not present in the source, fetch them too so existing IDs are matchable (paginated read, all rows).

### Pass 2: main table
For each source row:
1. Map non-foreign columns as normal.
2. For each foreign column, split the cell on the delimiter (if multi), normalize each token, look up `keyMap[foreignTable][token]`.
3. Apply the `onMissing` strategy for unmatched tokens.
4. Emit the cell as an array of foreign row references.
5. Batch and write.

### Wire format

Foreign ID cell values are arrays of objects — a special multi-select, not a bare ID:

```json
{
  "values": {
    "sku": "AX-1120",
    "name": "Axis Pro Mount",
    "brand": [
      { "id": "63100937357", "type": "foreignid" }
    ],
    "categories": [
      { "id": "63100951149", "type": "foreignid" },
      { "id": "63100937361", "type": "foreignid" }
    ]
  }
}
```

Adding a Foreign ID column (if the app is allowed to create one) requires both table and column pointers, or the API returns `Foreign table id must be defined`:

```json
{
  "name": "brand",
  "label": "Brand",
  "type": "FOREIGN_ID",
  "foreignTableId": 5316197,
  "foreignColumnId": 1
}
```

### Normalization function
`trim → collapse internal whitespace → casefold → strip diacritics (optional) → optional slugify`. Configurable per relationship; the exact function used is recorded in the job log so results are reproducible.

### Edge cases
| Case | Behaviour |
|---|---|
| Duplicate natural keys in foreign source | Abort at validation; keys must be unique |
| Same foreign value repeated in one main cell | Deduplicate before writing |
| Empty foreign cell | Write empty array (cell cleared), not null-vs-empty ambiguity |
| Foreign row deleted in HubSpot after mapping saved | Stale ID detected on write error → re-resolve once, then report |
| Self-referencing table (parent/child) | Treat as a cycle: insert rows, then patch the reference column |
| Foreign table at 10,000 rows | Block with explicit limit error before writing |

---

## 9. Architecture

```
Next.js 15 (App Router, TypeScript)
├─ app/
│  ├─ (dashboard)/           # portals, mappings, job history
│  ├─ import/[mappingId]/    # wizard: source → map → relations → dry run → run
│  └─ api/
│     ├─ portals/            # token CRUD + validation
│     ├─ hubdb/tables/       # schema introspection (server-side only)
│     ├─ mappings/           # profile CRUD
│     ├─ jobs/               # create, resume, cancel
│     └─ jobs/[id]/stream    # SSE progress
├─ lib/
│  ├─ hubdb/client.ts        # typed HubDB wrapper, batching, backoff
│  ├─ hubdb/provision.ts     # schema diff, table + column creation, ID resolution
│  ├─ schema.ts              # schema file parse/validate, infer from CSV headers
│  ├─ parse/                 # CSV + JSON → normalized row sets
│  ├─ graph.ts               # dependency graph + topological sort (shared by provision and import)
│  ├─ resolve.ts             # key map + foreign resolution
│  └─ validate.ts            # type + limit + uniqueness checks
└─ workers/                  # long-running job runner (route handler or queue)
```

**Rules**
- All HubSpot calls happen server-side. The token never reaches the client, and no HubSpot fetch is made from a React component.
- Supabase for `portals`, `mappings`, `jobs`, `job_batches`, `job_errors`, `key_maps`.
- Progress via SSE from the job runner; UI is a subscriber, not the executor — closing the tab must not kill the import.
- Long imports exceed serverless timeouts: the runner processes a bounded slice per invocation and re-enqueues, or runs on a queue/background worker. Decide before build.

### Data model sketch

| Table | Key fields |
|---|---|
| `portals` | id, label, env (sandbox/prod), token_encrypted, hub_id |
| `mappings` | id, name, config (jsonb), version, created_by |
| `jobs` | id, mapping_id, portal_id, status, mode (dry_run/execute), counts, started_at, finished_at |
| `job_batches` | id, job_id, table_name, pass, batch_index, status, cursor |
| `job_errors` | id, job_id, table_name, source_row, column, message |
| `key_maps` | job_id, table_name, natural_key, hubdb_row_id |

### Mapping config format

```json
{
  "version": 1,
  "name": "Products + brands + categories",
  "source": { "type": "xlsx", "sheetPerTable": true },
  "tables": [
    {
      "id": "brands",
      "role": "foreign",
      "hubdbTable": "brands",
      "naturalKey": ["slug"],
      "writeMode": "upsert",
      "columns": [
        { "source": "Slug", "target": "slug", "type": "TEXT", "required": true },
        { "source": "Brand Name", "target": "name", "type": "TEXT" }
      ]
    },
    {
      "id": "categories",
      "role": "foreign",
      "hubdbTable": "categories",
      "naturalKey": ["name"],
      "writeMode": "upsert",
      "columns": [
        { "source": "Category", "target": "name", "type": "TEXT", "required": true }
      ]
    },
    {
      "id": "products",
      "role": "main",
      "hubdbTable": "products",
      "naturalKey": ["sku"],
      "writeMode": "upsert",
      "columns": [
        { "source": "SKU", "target": "sku", "type": "TEXT", "required": true },
        { "source": "Title", "target": "hs_name", "type": "TEXT" },
        { "source": "Slug", "target": "hs_path", "type": "TEXT", "transform": "lowercase" },
        { "source": "Price", "target": "price", "type": "CURRENCY" },
        {
          "source": "Brand",
          "target": "brand",
          "type": "FOREIGN_ID",
          "foreign": {
            "table": "brands",
            "matchOn": "slug",
            "multi": false,
            "onMissing": "create_stub",
            "normalize": ["trim", "casefold"]
          }
        },
        {
          "source": "Categories",
          "target": "categories",
          "type": "FOREIGN_ID",
          "foreign": {
            "table": "categories",
            "matchOn": "name",
            "multi": true,
            "delimiter": "|",
            "onMissing": "fail",
            "normalize": ["trim", "casefold"]
          }
        }
      ]
    }
  ],
  "publish": { "mode": "push_live_on_success", "tables": "all" }
}
```

---

## 10. HubDB constraints the app must enforce

| Constraint | Value |
|---|---|
| Rows per table | 10,000 |
| Rows per account | 1,000,000 |
| Tables per account | 1,000 |
| Columns per table | 250 |
| Text column | 10,000 chars |
| Rich text column | 65,000 chars |
| Batch row create/update | 100 rows per call |
| New tables | created as draft; unusable via HubL/API until published |
| Dynamic page paths | must be lowercase |
| `hubdb_table_rows` default page size | 1,000 rows — pagination required when reading existing rows |

Column types available: Text, Rich text, URL, Image, Select, Multi-select, Date, Date and time, Number, Currency, Checkbox, Location, Foreign ID, Video.

**To verify during spike:** current request-per-10-seconds ceiling for the private app tier in use, and whether to target the dated API version path (`/cms/hubdb/2026-03/...`) or the stable `/cms/v3/hubdb/...` path.

---

## 11. UX flow

1. **Select portal** — environment badge, red for production.
2. **Upload source** — file(s), preview, validation warnings.
3. **Map tables** — assign each sheet/file to a HubDB table, set role and natural key.
4. **Map columns** — auto-matched, with type flags.
5. **Configure relations** — one panel per Foreign ID column; resolved import order shown.
6. **Dry run** — summary + unresolved-reference download; cannot skip on first run.
7. **Execute** — live progress per table and batch, cancellable.
8. **Publish** — review, then push live.
9. **Results** — counts, error log, "save as profile".

---

## 12. Phasing

| Phase | Scope |
|---|---|
| **0 — Spike (1–2 days)** | Prove the full chain via API: create a foreign table, create a main table with two Foreign ID columns pointing at it, batch-insert 200 linked rows, push live, render with a nested HubL loop |
| **1 — MVP** | Private app token, CSV + JSON sources, provisioning from schema, main + N foreign tables, dry run, upsert, publish, error log |
| **2** | Saved profiles, resume, stub creation, cycle handling, schema inference from headers, XLSX + Google Sheets |
| **3** | OAuth multi-portal, destructive schema changes with confirmation, scheduled imports, client-facing role |

## 13. Open questions

1. Single mapping = single main table, or multiple main tables in one job?
2. What happens to HubDB rows that exist but are absent from the source — leave, flag, or delete (with a hard confirm)?
3. Is production write access gated behind a second confirmation, or an approval step?
4. Does anything need to read the imported data back for verification (e.g. a generated HubL snippet proving the join renders)?
5. Is the schema file hand-authored (committed to the theme repo alongside the templates) or built in the UI and exported? The first is more useful for migrations; the second is friendlier.
6. Should the schema file and the import mapping be one file or two? One is simpler; two lets the same schema be reused with different source files.
