# HubDB Importer

Self-hosted Next.js tool that imports relational data into HubSpot HubDB — resolving `FOREIGN_ID` columns automatically from human-readable natural keys (SKU, slug, name) so a `products → brands + categories` dataset lands in one pass instead of hours of manual clicking in the HubDB UI.

**Status:** Phase 0 (spike). Not yet usable. See [`STATUS.md`](./STATUS.md) for current state.

## Docs

- [`hubdb-importer-prd.md`](./hubdb-importer-prd.md) — source-of-truth PRD (v0.1)
- [`phases/`](./phases) — per-phase task checklists (0 spike → 3 client-facing)
- [`STATUS.md`](./STATUS.md) — running project log
- [`CLAUDE.md`](./CLAUDE.md) — orientation for Claude Code sessions

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui on Base UI · pnpm. Supabase for job state (planned). Deploys to Vercel.

## Quickstart

```bash
pnpm install
cp .env.example .env.local     # fill in HUBSPOT_TOKEN (private-app, hubdb scopes)
pnpm dev                       # http://localhost:3000
```

Run a phase-0 spike script:

```bash
pnpm spike scripts/spike/00-ping.ts
```

## Commands

| | |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | production build |
| `pnpm start` | serve production build |
| `pnpm lint` | ESLint |
| `pnpm exec tsc --noEmit` | typecheck |
| `pnpm spike <path>` | run a spike script with `.env.local` loaded |
| `pnpm dlx shadcn@latest add <component>` | add a shadcn/ui component |
