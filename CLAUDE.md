# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

Phase 0 spike complete. No feature code (`lib/hubdb/`, `lib/graph.ts`, `app/api/`, `app/import/`, `workers/`) yet — only planning docs and a set of one-shot spike scripts that proved the API chain end-to-end.

- `hubdb-importer-prd.md` — the source-of-truth PRD (v0.1). Sections are stable references throughout the phase docs (e.g. F1–F11, §8, §10). **PRD §6 and §8 need revision** — see F0-2 in `phases/phase-0-spike.md`
- `phases/phase-0-spike.md` — completed spike with 9 numbered findings and 6 locked-in decisions. Read this before touching `lib/hubdb/` or `lib/graph.ts`
- `phases/phase-1.md` … `phase-3.md` — remaining phase task lists
- `STATUS.md` — running project log: what's done, what's in flight, what's next. **Read this first** at the start of a session to catch up
- `scripts/spike/` — Phase-0 spike CLIs (`client.ts`, `00-ping.ts` … `05-publish.ts`, plus `99-inspect.ts`). Kept in-tree as reference / regression checks; not part of the app

## Stack

- **Next.js 16** App Router (PRD says 15; `create-next-app` shipped 16 — App Router surface is compatible)
- React 19, TypeScript 5, Tailwind CSS v4 (`@tailwindcss/postcss`)
- **shadcn/ui on Base UI** (`base-nova` preset) — components land in `components/ui/`, `cn` helper in `lib/utils.ts`
- pnpm (pinned via `packageManager` in `package.json`)
- ESLint 9 flat config (`eslint.config.mjs`)
- **No `src/` dir** — `app/`, `components/`, `lib/`, `workers/` sit at the repo root (matches PRD §9 layout)
- **No test runner installed yet.** Pick one before writing tests — Vitest is the low-friction default with Next.js.

## Commands

```
pnpm dev                                  # next dev
pnpm build                                # next build
pnpm start                                # next start (prod, after build)
pnpm lint                                 # eslint
pnpm exec tsc --noEmit                    # typecheck without emit
pnpm dlx shadcn@latest add <component>    # add a shadcn/ui component

# Phase-0 spike scripts — reads .env.local (HUBSPOT_TOKEN required)
pnpm spike scripts/spike/00-ping.ts                # list tables via v3 + dated API
pnpm spike scripts/spike/01-provision-foreign.ts   # create brands + categories (idempotent)
pnpm spike scripts/spike/02-provision-main.ts      # create products with FK columns
pnpm spike scripts/spike/03-insert-foreign.ts      # batch-insert 200 rows into each foreign
pnpm spike scripts/spike/04-insert-main.ts         # batch-insert 200 linked products
pnpm spike scripts/spike/05-publish.ts             # push-live in dependency order
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
