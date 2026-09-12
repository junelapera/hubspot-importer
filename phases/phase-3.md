# Phase 3 — Multi-tenant, scheduled, and client-facing

**Goal:** Move beyond internal agency tool: OAuth portals, scheduled runs, safer destructive changes, client-facing role.

## OAuth multi-portal
- [ ] Register HubSpot OAuth app
- [ ] OAuth install flow (authorize → callback → token exchange)
- [ ] Refresh token handling + rotation
- [ ] Migrate `portals` schema to support OAuth alongside private-app tokens
- [ ] Portal install/uninstall lifecycle UI
- [ ] Multi-portal permissions per user/team

## Destructive schema changes
- [ ] Extend schema diff to detect: column drops, type changes, table drops
- [ ] Explicit "destructive plan" UI panel, separate from additive plan
- [ ] Hard confirm dialog with typed portal name
- [ ] Backup/export snapshot of affected tables before applying
- [ ] Audit log entry for every destructive change

## Scheduled imports
- [ ] Cron schedule per mapping profile
- [ ] Source pointer (Google Sheet ID, remote URL) tied to schedule
- [ ] Scheduled runner: dequeue on tick, invoke job runner
- [ ] Failure notifications (email / Slack)
- [ ] Schedule history view

## Client-facing role
- [ ] Role model: developer vs content-ops
- [ ] Content-ops UI: hides schema/provisioning, exposes "re-upload" only
- [ ] Locked mapping — content-ops cannot edit relations/columns
- [ ] Per-portal user access control
- [ ] Read-only job history view for content-ops
