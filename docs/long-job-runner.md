# Long-job runner strategy

> **Status: shipped 2026-09-28.** Recommendation below (Option A — Inngest) is in production. `lib/inngest/*` implements the step function; `POST /api/portals/[id]/execute` is now enqueue-and-return; the client polls `GET /api/jobs/[id]` every 2s. See the STATUS.md entry for 2026-09-28 for the full change log. This doc kept for historical context — the "What already works" and "Design options" sections describe the state at Phase-1 close.


## The constraint

`POST /api/portals/[id]/execute` runs `importRows` synchronously in the request handler. Vercel serverless function timeouts:

| Plan | `maxDuration` cap |
|---|---|
| Hobby | 10s (Node) / 60s (Edge) |
| Pro | 300s |
| Enterprise | 900s |

MVP scale check (from Phase 0 measurements + the F11-2 sandbox verification):

- 100-row batch create ≈ 800–1000 ms
- List existing rows: 1 GET per 1000 rows
- Total per-table import cost ≈ `ceil(existing/1000) * 300ms + ceil(source/100) * 900ms`

At 10 000 rows / table (HubDB row cap) with 3 tables and cross-table FK resolution: **~4–6 minutes**. Comfortably over the Pro cap.

**Mitigation for MVP:** we already set `maxDuration: 300` in `vercel.json` for the execute route (see F42). Imports of a few thousand rows across a few tables fit. Anything larger needs the runner rework below.

## What already works

- `jobs` + `job_batches` + `job_errors` + `key_maps` tables (F11 chunk 2, migration `20260915000000_init.sql`) — schema is designed for resume.
- `POST /api/portals/[id]/execute` writes a `jobs` row before starting, populates `job_errors` on completion, marks status. The persistence itself is complete.

What's **not** yet wired:
- `job_batches` rows aren't written per batch — the executor batches internally without recording cursors.
- `key_maps.entries` isn't persisted — every run rebuilds by reading existing draft rows.
- No detection of interrupted jobs on server startup.
- No SSE progress stream from the executor to the browser.

## Design options for v2

Ranked by fit for our stack:

### Option A — Inngest / QStash (external orchestrator)

External durable-execution service triggers our API on a schedule or via webhook. Each "step" is a separate HTTP call to us, so no single call runs past `maxDuration`.

- **Pros**: purpose-built for exactly this problem; automatic retries; visible dashboards; both have generous free tiers.
- **Cons**: external dependency + billing; requires signing/HMAC round-tripping for security; deploy-time coupling.
- **Fit**: high. Both integrate with Next.js on Vercel out of the box.

### Option B — Supabase queues + pg_cron

Supabase has `pg_cron` and `pg_boss`-style patterns. A cron function polls `jobs` in `status='pending'` and processes them.

- **Pros**: no extra vendor; single source of truth (DB).
- **Cons**: worker runs in the DB layer, so the HubSpot HTTP client + our lib needs to run under Postgres extensions (unrealistic). More likely: a Supabase Edge Function that pg_cron triggers, which then calls our normal API. Effectively option A with more moving parts.
- **Fit**: medium. Complex to set up; not clearly better than A.

### Option C — Split into batch endpoints

Restructure the executor so each batch is one API call. The browser (or a client-side scheduler) drives the loop.

```
POST /api/jobs               → create job, return jobId + first batch cursor
POST /api/jobs/[id]/step     → run one batch, return next cursor
POST /api/jobs/[id]/publish  → push-live phase
```

- **Pros**: no external service; every step fits in `maxDuration`; browser can also drive an SSE stream.
- **Cons**: closing the tab kills the run (PRD says "closing the tab must not kill the import"). Would need a service-worker or a headless follower.
- **Fit**: medium. Keeps us Vercel-native but violates the closing-tab requirement.

### Option D — Long-lived worker on a separate host

Rent a $5 VM or use Fly.io Machines, run a Node process that polls `jobs` and processes them.

- **Pros**: no execution-time cap; simple mental model.
- **Cons**: separate deploy target; ops overhead; overkill for MVP.
- **Fit**: low for MVP; reasonable for Phase 3.

## Recommendation

**~~Ship MVP with the current synchronous handler + `maxDuration: 300`.~~** [Shipped Phase 1.]

**Phase 2 rework: adopt Inngest (Option A).** [**Shipped 2026-09-28.**] Cheapest path to a resumable, tab-close-safe runner without inventing our own state machine. The existing `jobs` / `job_batches` / `key_maps` schema fits Inngest's step-function model directly. As shipped:

```
step.run("preflight", ...)       → load jobs row, resolve portal, markJobRunning
step.run("import-rows", ...)     → whole importRows in one step; hooks write job_batches + key_maps;
                                   1s poller on jobs.cancel_requested aborts via AbortController
step.run("publish:<table>", ...) → one step per table in publish scope (retries per-table)
step.run("finalize", ...)        → setJobResponse + insertJobErrors + completeJob
```

The shipped design chose **whole-`importRows` in one step**, not per-batch step splitting. Trade-off: each attempt still has the 300s Vercel cap, but Inngest retries the step automatically on timeout/crash — and upserts are idempotent by natural key, so a retry safely re-runs. Per-batch step splitting (`step.run("upsert:<table>:<batch>", ...)`) is the follow-up if a real workload hits the ceiling repeatedly. It needs `importRows` refactored to a pausable/step-driven form; meaningful surgery for a small marginal win at MVP scale.

## Non-goals

- **Real-time cell-level progress bars**: we can emit table-level progress via SSE from a synchronous handler today (F14 in PRD gestures at this). Sub-batch progress inside a single 100-row call isn't observable — HubSpot returns the batch atomically.
- **Cross-job coordination / job queues**: MVP has one user, one portal at a time. Multi-tenant queue depth is Phase 3.

## When to revisit this doc

- First real user hits `maxDuration: 300` (visible as `504 Gateway Timeout` on the execute endpoint under a Pro plan).
- We ship the "resume from failure" checklist item in Phase 2.
- We decide to charge users — durability guarantees matter more.
