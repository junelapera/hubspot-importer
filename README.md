# HubDB Importer

Self-hosted Next.js tool that imports relational data into HubSpot HubDB — resolving `FOREIGN_ID` columns automatically from human-readable natural keys (SKU, slug, name) so a `products → brands + categories` dataset lands in one pass instead of hours of manual clicking in the HubDB UI.

**Status:** Phase 1 (MVP) in progress — full lib layer (wrapper, graph, schema, provisioner, resolver, importer) is shipped and tested; app/UI layer is next. See [`STATUS.md`](./STATUS.md) for current state.

## Docs

- [`hubdb-importer-prd.md`](./hubdb-importer-prd.md) — source-of-truth PRD (v0.1)
- [`phases/`](./phases) — per-phase task checklists (0 spike → 3 client-facing)
- [`STATUS.md`](./STATUS.md) — running project log
- [`CLAUDE.md`](./CLAUDE.md) — orientation for Claude Code sessions

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui on Base UI · pnpm. Supabase for job state (planned). Deploys to Vercel.

## Local setup

```bash
pnpm install
cp .env.example .env.local
```

Then fill in `.env.local` step-by-step:

### 1. HubSpot private-app token (for spike scripts)

Create a private app under **HubSpot → Settings → Integrations → Private Apps** with the `hubdb` (read + write) scopes. Paste the token as `HUBSPOT_TOKEN`. Copy the Hub ID from the top-right of the HubSpot UI into `HUBSPOT_PORTAL_ID`.

This one is used by the `scripts/spike/*.ts` scripts only. Once F1 lands, app-side portals live in Supabase and this env var is optional.

### 2. Supabase cloud project

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the Phase-1 schema migration to your project:
   - Open **SQL Editor** in the Supabase dashboard.
   - **Set the role selector (dropdown near the "Run" button) to `postgres`** — the default role is often read-only and DDL fails with `25006: cannot execute … in a read-only transaction`.
   - Paste the contents of [`supabase/migrations/20260915000000_init.sql`](./supabase/migrations/20260915000000_init.sql) and run.
   - Fallback if the role selector isn't visible: use `psql` with the connection string from **Project Settings → Database → Connection string (URI)**:
     ```bash
     psql "postgresql://postgres.xxxx:PASSWORD@aws-0-xxx.pooler.supabase.com:5432/postgres" \
       -f supabase/migrations/20260915000000_init.sql
     ```
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

```bash
pnpm dev                             # http://localhost:3000
pnpm test:run                        # vitest, ~85 cases
pnpm spike scripts/spike/00-ping.ts  # verify HUBSPOT_TOKEN is good
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
