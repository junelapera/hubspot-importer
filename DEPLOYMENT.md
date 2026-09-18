# Deployment

Target: Vercel for the Next.js app, Supabase cloud for Postgres. HubSpot API is called server-side only.

## First-time setup

### 1. Supabase project

1. Create a project at https://supabase.com. Copy from **Settings → API**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-side only — bypasses RLS)
2. Apply migrations in the SQL Editor, **in filename order** (toggle "Read only" OFF at the top of the editor before running DDL):
   - `supabase/migrations/20260915000000_init.sql` — six tables + `set_updated_at()` trigger
   - `supabase/migrations/20260918000000_mapping_profiles.sql` — `mappings.state_json` + `job_errors.column_name`
   - `supabase/migrations/20260918010000_jobs_mapping_id_set_null.sql` — `jobs.mapping_id ON DELETE SET NULL` so profile deletes preserve job history

### 2. Portal-token encryption key

Generate a 32-byte key (once, never rotate — rotating loses access to every stored HubSpot token):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Save as `PORTAL_TOKEN_ENCRYPTION_KEY`.

### 3. Vercel project

1. Import the repo. Vercel auto-detects Next.js.
2. **Project → Settings → Node.js Version → 22.x** (this repo's `.nvmrc` and `package.json` `engines` both say `>=22`, but Vercel's dashboard is the actual runtime pin).
3. **Project → Settings → Environment Variables**, set all three for Production and Preview:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PORTAL_TOKEN_ENCRYPTION_KEY`
4. Deploy.

`vercel.json` at the repo root already sets `maxDuration: 300` (5 minutes) on the execute route. Requires a Pro plan; Hobby caps at 10s for Node functions and imports will time out. See `docs/long-job-runner.md` for the plan to lift that ceiling.

## Every-deploy checklist

- [ ] All new `supabase/migrations/*.sql` files applied against the production project (Supabase does not auto-apply).
- [ ] `.env.example` scanned — any newly-added var also set in Vercel dashboard.
- [ ] Preview deploy tested end-to-end:
  - `GET /api/portals` returns `{portals: [...]}` (or `{portals: []}` if fresh)
  - Adding a real HubSpot private-app token via `/portals` creates a row
  - Running an import against a sandbox portal writes to `jobs` + `job_errors`
- [ ] `pnpm test:run` green (auto-run by Vercel via GitHub check if wired; otherwise run locally before pushing to `main`).

## Environment variables

| Var | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | Supabase → Settings → API | Public URL, safe to expose but we keep it server-side. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **Server-side only.** Bypasses RLS. Never send to browser. |
| `PORTAL_TOKEN_ENCRYPTION_KEY` | Generated once (see above) | 32 bytes base64. Rotating this loses every stored HubSpot token. Back it up. |
| `HUBSPOT_TOKEN` | `.env.local` only | Read by `scripts/spike/*.ts` for one-off checks. Not read by app code — production portals come from the `portals` table via `getPortalToken`. Don't set on Vercel. |
| `HUBSPOT_PORTAL_ID` | `.env.local` only | Same — spike-scripts only. |

## Known deployment caveats

- **Node 22+ required** for the native `WebSocket` global that supabase-js's Realtime constructor needs. The `ws` polyfill was retired in `lib/db/supabase.ts` on 2026-09-18. Deploying to a Vercel project pinned to Node 20 will crash on every Supabase call.
- **`maxDuration: 300` is a Pro-plan feature.** On Hobby, the execute route defaults to 10s and non-trivial imports will 504. Either upgrade or split imports across multiple runs (mapping profile + composite naturalKey upsert means re-running is idempotent).
- **Serverless cold starts** on the execute route are ~500ms — negligible for a multi-minute import, meaningful for a small dry-run. If dry-run latency becomes user-visible, mark that route as edge-friendly (currently `nodejs` for supabase-js).
