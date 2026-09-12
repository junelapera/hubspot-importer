# Project status

Running log of where the HubDB Importer project is, what's in flight, and what's next. Update as we go.

## Current state — 2026-09-12

**Phase:** 0 — Spike (in progress)

**Blocked on:** user to create `.env.local` at repo root with `HUBSPOT_TOKEN` (+ `HUBSPOT_PORTAL_ID`). Template at `.env.example`.

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
| 2 | Confirm API path (`v3` vs dated `2026-03`) | blocked on token |
| 3 | Provision `brands` + `categories` foreign tables | pending |
| 4 | Reproduce `Foreign table id must be defined` error | pending |
| 5 | Provision `products` main table w/ two FK cols | pending |
| 6 | Batch-insert 200 rows into foreign tables, capture IDs | pending |
| 7 | Batch-insert 200 linked rows into `products` | pending |
| 8 | Push-live all three tables in dependency order | pending |
| 9 | Document findings in `phases/phase-0-spike.md` | pending |

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

### 2026-09-12
- Wrote PRD `hubdb-importer-prd.md`
- Broke PRD §12 into per-phase task checklists under `phases/`
- Wrote `CLAUDE.md` guidance for future Claude Code sessions
- Scaffolded Next.js 16 app via `create-next-app`, added shadcn/ui, pushed to GitHub
- Started Phase 0: added `tsx` + `zod` deps, wrote `scripts/spike/client.ts` (typed HubSpot fetch wrapper with `HubdbError` surfacing rate-limit headers) and `00-ping.ts` (list tables). Added `pnpm spike` script
- **Next step:** user creates `.env.local` → run `pnpm spike scripts/spike/00-ping.ts` on both v3 and dated API paths (task #2)
