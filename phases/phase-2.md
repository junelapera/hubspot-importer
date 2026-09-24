# Phase 2 — Reusability & robustness

**Goal:** Make imports repeatable, resumable, and friendlier for wider source formats.

## F11 — Mapping profiles
- [x] Save named mapping profiles (create, list, rename) (Phase 1 — `lib/db/mappings.ts` + `ProfilePanel`)
- [x] Duplicate profile action (`POST /api/mappings/[id]/duplicate` → server-side `duplicateMapping` picks a non-colliding `Copy of X` name via `nextCopyName`)
- [x] Export profile as JSON (`serializeProfileExport` wraps in a versioned envelope; client-side blob download from `ProfilePanel`)
- [x] Import profile from JSON (`parseProfileExport` zod-validates the envelope; auto-renames via `nextCopyName` when the incoming name collides on the target portal)
- [ ] Re-run saved mapping against a new file
- [ ] Re-run saved mapping against a different portal (lookup by name)

## Resume from failure
- [ ] Detect interrupted jobs on runner restart
- [ ] Resume from last completed batch cursor
- [ ] UI: "resume" action on failed jobs in history
- [ ] Preserve key map across resume

## Stub creation (F5 extension)
- [ ] Implement `onMissing: create_stub` — insert placeholder row in foreign table
- [ ] Log stub creations distinctly in results
- [ ] Stub uses the unresolved token as its natural key value

## Cycle handling (full implementation)
- [ ] Two-phase write for cyclic FK graphs: insert rows without FK cells, PATCH cells after
- [ ] UI: explicit cycle-detected + two-phase-mode confirmation
- [ ] Self-referencing table (parent/child) supported end-to-end

## Schema inference
- [x] Infer starting schema from CSV headers (`lib/schema-infer.ts::inferSchema` — pure, 21 vitest cases)
- [x] Type inference: TEXT / RICHTEXT / NUMBER / CURRENCY / BOOLEAN / DATE / DATETIME / URL / IMAGE / FOREIGN_ID from cell samples (currency = numeric + name-hint; image = URL + image extension; FK = cross-table value membership)
- [x] UI to correct inferred types before provisioning (`SchemaInferPanel` on `/import` — per-column type dropdown, natural-key checkbox, FK target picker; live counts of inferred NKs + FKs in the header)
- [x] Export inferred schema as schema definition JSON (`toSchema` strips UI-only fields; client-side blob download named `schema.json`)

## XLSX source
- [ ] Upload endpoint for `.xlsx`
- [ ] Sheet-per-table detection
- [ ] Preview + validation parity with CSV path

## Google Sheets source
- [ ] OAuth flow for Google Sheets read access
- [ ] Sheet picker UI
- [ ] Refresh-from-sheet action for saved mappings
