# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

Scaffolded, no feature code yet. Planning docs live alongside the source:

- `hubdb-importer-prd.md` — the source-of-truth PRD (v0.1). Sections are stable references throughout the phase docs (e.g. F1–F11, §8, §10).
- `phases/phase-0-spike.md` … `phase-3.md` — task-checklist breakdown of PRD §12.
- `STATUS.md` — running project log: what's done, what's in flight, what's next. **Read this first** at the start of a session to catch up.

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
pnpm spike scripts/spike/00-ping.ts
```

## What this app does

HubDB Importer resolves relational data into HubSpot HubDB. HubSpot's native CSV import cannot populate `FOREIGN_ID` columns, so foreign relationships must be linked by hand in the UI. This app takes source files (CSV / JSON), resolves foreign keys from human-readable natural keys (SKU, slug, name), and writes rows in topological order so `FOREIGN_ID` cells contain real HubDB row IDs.

Two ideas do most of the work — read PRD §6 and §8 before touching resolver / provisioner code:

- **Two-pass import.** Foreign tables written first to obtain HubDB row IDs → key map built → main table written with substituted IDs.
- **Schema-local IDs.** Schema definitions reference other tables by their *schema id* (e.g. `"foreignTable": "brands"`), not HubSpot table IDs. The provisioner translates to `foreignTableId` / `foreignColumnId` integers at write time so schema files are portable across portals.

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

## HubDB constraints to enforce in code (PRD §10)

- Batch row create/update: **100 rows per call** (hard API cap)
- Rows per table: 10,000 — block before writing
- Text: 10,000 chars • Rich text: 65,000 chars
- Reads paginate at 1,000 rows default
- Dynamic page paths must be lowercase
- Retry 429/5xx with exponential backoff, honor `Retry-After`, throttle under the portal's requests-per-10s ceiling

## Foreign ID wire format

Cells are arrays of objects, not bare IDs:

```json
{ "brand": [ { "id": "63100937357", "type": "foreignid" } ] }
```

Creating a `FOREIGN_ID` column requires **both** `foreignTableId` and `foreignColumnId` — omitting either returns `Foreign table id must be defined`.

## Two related JSON formats — don't confuse them

- **Schema definition** (PRD §F3): declares the HubDB tables to exist. Referenced by schema-local `id`. Portable across portals.
- **Import mapping** (PRD §9): source columns → HubDB columns + foreign relationship rules (`matchOn`, `multi`, `delimiter`, `onMissing`, `normalize`). References HubDB tables by *name*.

Open question §13.6: whether these become one file or two. Not decided.

## Working with the PRD

- PRD Section 13 has six open questions that gate design choices — check there before making assumptions about scope (single vs multiple main tables, absent-row policy, prod-write gating, schema file authoring model, one-file-or-two).
- Phase 0 is a spike that must confirm API path (`/cms/hubdb/2026-03/...` vs `/cms/v3/hubdb/...`), rate-limit ceiling, and long-job runner strategy (serverless slice vs queue). Do not lock those choices in code before the spike answers them.
