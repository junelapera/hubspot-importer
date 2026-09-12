# Phase 0 — Spike (1–2 days)

**Goal:** Prove the full HubDB relational chain works end-to-end via the API before committing to the MVP build.

## Setup
- [ ] Create a sandbox HubSpot portal for testing
- [ ] Generate a private app token with `hubdb` (read + write) scopes
- [ ] Confirm which API path to target: dated (`/cms/hubdb/2026-03/...`) vs stable (`/cms/v3/hubdb/...`)
- [ ] Confirm current request-per-10-seconds ceiling for the private app tier

## API chain proof
- [ ] Create a foreign table (`brands`) via API as draft
- [ ] Create a main table (`products`) with two `FOREIGN_ID` columns pointing at `brands` and a second foreign table
- [ ] Verify `foreignTableId` + `foreignColumnId` are both required (reproduce `Foreign table id must be defined` error)
- [ ] Batch-insert 200 rows into the foreign tables and capture returned row IDs
- [ ] Batch-insert 200 linked rows into `products` using the Foreign ID wire format (`[{ "id": "...", "type": "foreignid" }]`)
- [ ] `push-live` both tables in dependency order
- [ ] Render the joined data on a HubSpot page with a nested HubL loop

## Findings to document
- [ ] Confirmed API base path + version
- [ ] Confirmed rate limit and backoff behavior on `429`
- [ ] Confirmed batch size ceiling (100 rows/call)
- [ ] Notes on any undocumented quirks in Foreign ID cell format
- [ ] Decision: serverless-slice runner vs background queue for long jobs
