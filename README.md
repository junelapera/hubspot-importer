# HubDB Importer

Self-hosted Next.js tool that imports relational data into HubSpot HubDB — resolving `FOREIGN_ID` columns automatically from human-readable natural keys (SKU, slug, name) so a `products → brands + categories` dataset lands in one pass instead of hours of manual clicking in the HubDB UI.

**Status:** Phase 1 MVP — usable end-to-end. Phase 2 kicked off: mapping profile duplicate / export JSON / import JSON. 203 vitest cases / 15 suites. Full source → mapping → execute → publish loop runs at `/import`: portal connection, CSV/JSON source ingestion, portal introspection + provisioning, column mapping, foreign-relationship config with all four `onMissing` policies (skip-row / null / fail / create-stub), composite natural keys, multi-value FKs, dependency-ordered execution, per-table results with CSV+JSON download, mapping-profile save/load (with cached target-table id), job history at `/jobs`. Server-side hardening: dry-run signature gate on execute, cell-length caps (10k TEXT / 65k RICHTEXT), hs_path lowercase check, stale-FK retry (re-lists foreign tables + retries once on a foreign-shaped 4xx), cancel-at-batch-boundary. Persistent sidebar nav across all pages. HTTP Basic Auth gate (`proxy.ts`, renamed from `middleware.ts` for Next 16) for Vercel Hobby-tier deploys. A few polish items (SSE progress, per-batch cursor persistence, worker-runner separation, provision-writes-back-tableId) are still open — see [`STATUS.md`](./STATUS.md) and [`phases/phase-1-mvp.md`](./phases/phase-1-mvp.md).

## Docs

- [`hubdb-importer-prd.md`](./hubdb-importer-prd.md) — source-of-truth PRD (v0.1)
- [`phases/`](./phases) — per-phase task checklists (0 spike → 3 client-facing)
- [`STATUS.md`](./STATUS.md) — running project log — start here
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — first-time Vercel + Supabase setup + env-var checklist
- [`docs/long-job-runner.md`](./docs/long-job-runner.md) — Phase-2 runner rework plan (Inngest recommended)
- [`CLAUDE.md`](./CLAUDE.md) — orientation for Claude Code sessions

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui on Base UI · pnpm. Supabase for portals + mapping profiles + job history. **Requires Node 22+** (native `WebSocket` global for supabase-js Realtime). Deploys to Vercel (see `DEPLOYMENT.md`).

## Local setup

```bash
pnpm install
cp .env.example .env.local
```

Then fill in `.env.local` step-by-step:

### 1. HubSpot private-app token (for spike scripts only)

Create a private app under **HubSpot → Settings → Integrations → Private Apps** with the `hubdb` (read + write) scopes. Paste the token as `HUBSPOT_TOKEN`. Copy the Hub ID from the top-right of the HubSpot UI into `HUBSPOT_PORTAL_ID`.

This is used by the `scripts/spike/*.ts` scripts only. App-side portals live in Supabase (encrypted); connect them via `/portals` in the running app.

### 2. Supabase cloud project

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the Phase-1 migrations in filename order (each one is a paste-into-SQL-Editor step; **toggle "Read only" OFF** at the top of the editor before running DDL):
   - [`20260915000000_init.sql`](./supabase/migrations/20260915000000_init.sql) — 6 tables (`portals`, `mappings`, `jobs`, `job_batches`, `job_errors`, `key_maps`) + `set_updated_at()` trigger
   - [`20260918000000_mapping_profiles.sql`](./supabase/migrations/20260918000000_mapping_profiles.sql) — adds `mappings.state_json` (wizard state) and `job_errors.column_name`
   - [`20260918010000_jobs_mapping_id_set_null.sql`](./supabase/migrations/20260918010000_jobs_mapping_id_set_null.sql) — `jobs.mapping_id ON DELETE SET NULL` so deleting a profile preserves job history
3. Copy from **Project Settings → API** into `.env.local`:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (server-only; do not expose to the browser)

### 3. Portal-token encryption key

Generate a 32-byte base64 key and paste it as `PORTAL_TOKEN_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Treat this key as long-lived — rotating it invalidates every stored HubSpot token in `portals.token_ciphertext`. Back it up.

### 4. Run it

Node 22+ required (supabase-js's Realtime constructor needs the native `WebSocket` global — retired the `ws` polyfill on 2026-09-18). If you use nvm: `nvm install 22 && nvm use` picks up the `.nvmrc`.

```bash
pnpm dev                                                  # http://localhost:3000
pnpm test:run                                             # vitest, 203 cases across 15 suites
pnpm spike scripts/spike/00-ping.ts                       # verify HUBSPOT_TOKEN
pnpm spike scripts/spike/12-supabase-ping.ts              # verify Supabase migration
pnpm spike scripts/spike/14-composite-multi-onmissing.ts  # exercise the full FK matrix against the sandbox
```

## Commands

| | |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | production build |
| `pnpm start` | serve production build |
| `pnpm lint` | ESLint |
| `pnpm test` / `pnpm test:run` | Vitest (watch / one-shot) |
| `pnpm exec tsc --noEmit` | typecheck |
| `pnpm spike <path>` | run a spike script with `.env.local` loaded |
| `pnpm dlx shadcn@latest add <component>` | add a shadcn/ui component |
