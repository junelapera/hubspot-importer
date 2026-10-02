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

## Mapping canvas (visual relationship editor + inline cleanup)
See `docs/mapping-canvas.md` for the full design. Scoped as a phased build; items here match that doc's phase breakdown.

### Phase A — Relationship canvas (visualization only, ~1 week)
- [ ] Add `@xyflow/react` dep (code-split so form-view users don't pay the ~45kb)
- [ ] `MappingCanvas` component: nodes per source + target table, columns as ports, drag-to-connect FK edges
- [ ] Edge-side-panel reuses existing FK config fields (`multi`, `delimiter`, `onMissing`, `matchKey`)
- [ ] `[form | canvas]` toggle on `/import` (persist choice per portal in sessionStorage)
- [ ] `MappingState.canvasLayout` field for node positions (optional; round-trips through profile `state_json`)
- [ ] Validate button runs client-side checks before dry run

### Phase B — Inline column transforms (~2-3 weeks)
Scope expanded 2026-10-02 after a real client import (Prime Capital locations) surfaced 4 synthesis transforms we hadn't accounted for. See `docs/mapping-canvas.md` worked example.
- [ ] `lib/transforms.ts` with pure `applyTransforms(rows, transforms[])` + deterministic order (rename → trim/casefold → drop → synthesis → split → join)
- [ ] `MappingState.transforms` tagged union
- [ ] Edit-in-place: **rename / trim / casefold / drop**
- [ ] Synthesis: **template** (`"{City}, {State}"` with `{col|modifier}` modifiers — lower/upper/trim/slugify only)
- [ ] Synthesis: **slugify** (URL-safe lowercase hyphenated from one or more cols)
- [ ] Synthesis: **lookup** (dictionary expand, e.g. `AL → Alabama`; `onMissing: pass-through | null | fail`)
- [ ] Synthesis: **constant** (same value every row; for boilerplate + static FK lists)
- [ ] Expand: **split** by delimiter → N named columns
- [ ] Enrich: **join** against another source — one hop only, `onMissing: null | fail | skip-row`
- [ ] Right-click column port on canvas for transform actions
- [ ] Live sample preview as transforms are added
- [ ] Collision validation on save (no transform may produce an existing column name except via rename)

### Phase C — Export normalized files (~3 days)
- [ ] `POST /api/portals/[id]/export` runs resolver without HubSpot write, returns ZIP of CSVs
- [ ] Toolbar button: "Download prepared files (.zip)"
- [ ] ZIP includes `README.txt` with applied transforms + mapping snapshot
