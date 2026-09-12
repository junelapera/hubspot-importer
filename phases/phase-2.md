# Phase 2 — Reusability & robustness

**Goal:** Make imports repeatable, resumable, and friendlier for wider source formats.

## F11 — Mapping profiles
- [ ] Save named mapping profiles (create, list, rename)
- [ ] Duplicate profile action
- [ ] Export profile as JSON
- [ ] Import profile from JSON
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
- [ ] Infer starting schema from CSV headers
- [ ] Type inference: TEXT / NUMBER / DATE / CURRENCY / URL / IMAGE from cell samples
- [ ] UI to correct inferred types before provisioning
- [ ] Export inferred schema as schema definition JSON

## XLSX source
- [ ] Upload endpoint for `.xlsx`
- [ ] Sheet-per-table detection
- [ ] Preview + validation parity with CSV path

## Google Sheets source
- [ ] OAuth flow for Google Sheets read access
- [ ] Sheet picker UI
- [ ] Refresh-from-sheet action for saved mappings
