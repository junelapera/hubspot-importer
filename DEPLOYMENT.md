# Deployment

Target: Vercel for the Next.js app, Supabase cloud for Postgres. HubSpot API is called server-side only.

## First-time setup

### 1. Supabase project

1. Create a project at https://supabase.com. Copy from **Settings → API**:
   - `SUPABASE_URL` (Project URL)
   - `SUPABASE_SERVICE_ROLE_KEY` (`service_role` secret — server-side only, bypasses RLS)
   - `NEXT_PUBLIC_SUPABASE_URL` (same as `SUPABASE_URL`)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`anon public` key — safe to expose, powers browser Auth)
2. **Authentication → Providers → Email** — enabled by default; make sure it's on.
3. **Authentication → Providers → Email → Confirm email** — toggle **OFF**. Users log in immediately after registering; the @saltedstone.com domain allowlist is our trust boundary (no per-mailbox verification needed for an internal tool). If you want verification later, flip it back on + configure SMTP in **Project Settings → Auth → SMTP Settings**.
4. Apply migrations in the SQL Editor, **in filename order** (toggle "Read only" OFF at the top of the editor before running DDL):
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
3. **Project → Settings → Environment Variables**, set for Production and Preview:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL` (same value as `SUPABASE_URL`)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `PORTAL_TOKEN_ENCRYPTION_KEY`
   - `INNGEST_EVENT_KEY` (Inngest Cloud → App settings)
   - `INNGEST_SIGNING_KEY` (Inngest Cloud → App settings)
4. Deploy.
5. Navigate to `/register` on your deployed URL to create the first user account. Everyone with an @saltedstone.com email can self-register from there.

`vercel.json` at the repo root already sets `maxDuration: 300` (5 minutes) on the execute route. Since the runner rework (2026-09-28) the execute route only enqueues an Inngest event — the actual work lives on the `/api/inngest` webhook, which also caps at 300s per step. Anything that takes longer per step retries automatically. Requires a Pro plan for the 300s ceiling; Hobby caps at 10s and non-trivial imports won't fit in a single Inngest step.

**Inngest Cloud setup** (production):
1. Create an app at https://app.inngest.com.
2. In the app settings, copy the **Event Key** and **Signing Key** into `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` on Vercel.
3. Point the app at your deployed `/api/inngest` URL — Inngest Cloud auto-discovers the registered functions on first webhook fire.
4. First execute triggers the discovery; subsequent runs stream in the Inngest dashboard.

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
| `SUPABASE_URL` | Supabase → Settings → API | Public URL. Kept server-side. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **Server-side only.** Bypasses RLS. Never send to browser. |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as `SUPABASE_URL` | Duplicated with `NEXT_PUBLIC_` prefix because Next.js only exposes env vars with that prefix to the browser bundle. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Public `anon` key. Safe to expose. Powers browser Supabase Auth (signIn/signUp/session cookies). |
| `PORTAL_TOKEN_ENCRYPTION_KEY` | Generated once (see above) | 32 bytes base64. Rotating this loses every stored HubSpot token. Back it up. |
| `HUBSPOT_TOKEN` | `.env.local` only | Read by `scripts/spike/*.ts` for one-off checks. Not read by app code — production portals come from the `portals` table via `getPortalToken`. Don't set on Vercel. |
| `HUBSPOT_PORTAL_ID` | `.env.local` only | Same — spike-scripts only. |
| `INNGEST_EVENT_KEY` | Inngest Cloud → App settings | Signs events sent from the Vercel Node runtime to Inngest. Missing in dev is fine — the Inngest CLI dev server accepts unsigned events. |
| `INNGEST_SIGNING_KEY` | Inngest Cloud → App settings | Verifies HMAC on webhooks from Inngest Cloud back into `/api/inngest`. Same dev caveat. |

## Auth gate

`proxy.ts` at the repo root runs on Vercel's Edge Runtime and gates the entire app behind Supabase Auth.

- Users register at `/register` (only @saltedstone.com emails accepted); log in at `/login`. Session cookie is set by Supabase Auth automatically.
- Unauthenticated requests to any protected route redirect to `/login?next=<original-url>`.
- Public paths (`/login`, `/register`, `/api/auth/*`, static assets) always pass through.
- Dev-mode fallback: if `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` aren't set, auth is skipped entirely — local `pnpm dev` on a bare `.env.local` still works.
- To rotate a user's access, delete them from **Authentication → Users** in the Supabase dashboard. Session cookies invalidate on the next request.

## Known deployment caveats

- **Node 22+ required** for the native `WebSocket` global that supabase-js's Realtime constructor needs. The `ws` polyfill was retired in `lib/db/supabase.ts` on 2026-09-18. Deploying to a Vercel project pinned to Node 20 will crash on every Supabase call.
- **`maxDuration: 300` is a Pro-plan feature.** On Hobby, the execute route defaults to 10s and non-trivial imports will 504. Either upgrade or split imports across multiple runs (mapping profile + composite naturalKey upsert means re-running is idempotent).
- **Serverless cold starts** on the execute route are ~500ms — negligible for a multi-minute import, meaningful for a small dry-run. If dry-run latency becomes user-visible, mark that route as edge-friendly (currently `nodejs` for supabase-js).
