# Mapping canvas — visual relationship editor + inline cleanup

> **Status: proposal, not scheduled.** Design doc only. Review before any implementation work starts. Discussed + validated against a real import on 2026-10-02 (June Lapera + Claude).

## Worked example: Prime Capital Financial locations

Real import handed to the Saltedstone team on 2026-10-02. Grounds the entire design — every transform type below exists because it was needed here.

**What the client sent** (`docs/example-data/Prime_Capital_Financial_Location_Page_Content (1).xlsx`): one sheet, 78 rows, 6 columns.

| State | City | Page URL | Header Image URL | Heading Copy | Body Copy |
|---|---|---|---|---|---|
| AL | Spanish Fort | https://primefinancial.com/locations/financial-advisor-in-spanish-fort-al/ | https://.../Spanish-Fort-Alabama.jpg | Financial Advisor Services in Spanish Fort, AL | The Burns Estate Planning & Wealth Advisors team… |

**What landed in HubDB** (`docs/example-data/locations-2026-10-02.csv` + `locations-faqs-2026-10-02.csv` + `team-members-2026-10-02.csv`): 3 tables, 19 columns on locations, with FK relationships between all three.

**The manual cleanup that happened between those two states** (done by hand in a spreadsheet, 2-4 hours of work for this one import):

| # | Operation | Example | Current app helps? |
|---|---|---|---|
| 1 | Expand 2-letter state code → full name | `AL` → `Alabama` | ❌ needs **lookup** |
| 2 | Build URL slug from City + State | `Spanish Fort` + `AL` → `spanish-fort-al` | ❌ needs **slugify** |
| 3 | Build display name from City + State | `Spanish Fort` + `AL` → `Spanish Fort, AL` | ❌ needs **template** |
| 4 | Reformat image URL to HubDB image cell | `https://.../img.jpg` → `https://cdn/.../img.jpg,1250,480,220713136421` | ❌ needs **template** |
| 5 | Add constant boilerplate columns | Every row gets `faq_section_title = "Frequently Asked Questions"` | ❌ needs **constant** |
| 6 | Add static FK list to every row | Every location gets the same 6 FAQ IDs | ❌ needs **constant** (as multi-value FK) |
| 7 | Comma-separated FK list of team members | `221997843088,221997843125` | ✅ handled — FK config `multi + delimiter` |
| 8 | Pull address from another dataset | `7817 Spanish Fort Blvd, Suite B...` | ⚠️ Phase B **join** (planned) |
| 9 | Editorial content (section titles, body boilerplate) | `section_2_content = "At Prime Capital Retirement..."` | ❌ out of scope — see non-goals |

**Score: 6 of 9 operations in this real import are not covered by the design doc as originally written.** This update adds the 4 transform types (template, slugify, lookup, constant) needed to cover 1-6. Operations 7-8 were already in scope; 9 stays out of scope as editorial work.

If we had shipped Phase B transforms before this import, the cleanup would collapse from 2-4 hours of spreadsheet work to 20 minutes of canvas config.

## The constraint

Today's mapping flow (`app/import/mapping-editor.tsx` + `app/import/source-uploader.tsx`) is form-based. For each uploaded source table, the user:

1. Picks a target HubDB table from a dropdown
2. Clicks through a 5-column mapping table to assign each source column to a target column
3. Checks natural-key boxes
4. Expands a `ForeignKeyPanel` per FK column to configure match key, multi-value delimiter, and `onMissing` policy

This works for 2-4 table schemas. It falls over for 5-10 table schemas because:

- **No visual overview** — you can't see the full graph of which-source-column-links-to-which-foreign-table-column without clicking through every panel individually
- **FK config is buried** — a panel per FK column, each with its own set of dropdowns, hidden behind an accordion-ish layout
- **Source files often need pre-processing** — if `products.csv` has `brand_id = "1234"` but `brands.csv` uses `slug` as the natural key, the user has to join externally (open a spreadsheet, VLOOKUP, re-export) before upload. The app doesn't help here.

## User-reported pain

Multi-select answers from the design conversation on 2026-10-02:

| Pain point | Confirmed |
|---|---|
| Add missing FK columns (data not in source, has to be joined externally) | ✓ |
| Rename / normalize values (inconsistent casing/spelling across tables) | ✓ |
| Split multi-value cells into normalized FK references | ✓ |
| Figure out which columns relate to what (no visual overview) | ✓ |

Target scale: **5-10 tables** per import.
Desired output: **both direct import AND exported normalized files**.

## What already works (don't rebuild)

Before scoping, be honest about what the existing resolver stack covers so we don't ship a prettier wrapper around the same pipes:

| Pain | Already handled? | Where |
|---|---|---|
| Resolve FKs by natural key (not raw ID) | ✓ fully | `lib/resolve.ts` `resolveForeignValue` |
| Normalize for match (trim + case + whitespace) | ✓ fully | `lib/resolve.ts` `normalizeKey` |
| Split multi-value cells on delimiter | ✓ fully | `lib/resolve.ts` `splitMultiValue` + FK config `multi + delimiter` |
| `onMissing` policies (skip/null/fail/create-stub) | ✓ fully | `lib/hubdb/import.ts` + FK config |
| Dry-run with unresolved-FK CSV download | ✓ fully | `lib/dry-run.ts` |
| Natural-key duplicate detection | ✓ fully | `lib/resolve.ts` `buildKeyMap` |

What is **not** handled today:

- **Visual relationship overview** — a graph of all source tables + their FK edges in one view
- **Add column by joining another source** — e.g., add `brand_slug` to `products` by looking up `products.brand_id` in `brands` and copying `brands.slug`. This is the real "cleanup" step users do externally today.
- **Column synthesis** — build new columns from existing ones via template (`"{City}, {State}"`), slugify (`City + State → "spanish-fort-al"`), lookup (`"AL" → "Alabama"` via dictionary), or constant (same value every row). Every one of these was done by hand for the Prime Capital import. See worked example.
- **Explicit data normalization** — rewriting source values before resolution (e.g., canonicalize `"Acme Corp."` / `"ACME"` / `"acme"` → `"acme"`). Currently handled implicitly by match normalization, but the user can't see or control the result.
- **Preview-driven column transforms** — rename, split, drop, trim with live sample updates
- **Export resolved files** — download the post-resolution dataset for audit or re-upload elsewhere

## Design

### Three distinct features, phased

The "wizard" idea packs three features together. Keeping them separate is critical — we can ship the first and get value immediately without committing to the harder two.

#### Phase A — Relationship canvas (visualization only)

Replace the per-source `ForeignKeyPanel` configuration with a node-graph view:

```
┌──────────────────────┐          ┌──────────────────────┐
│ products.csv [12 rows]│          │ brands.csv [8 rows]  │
├──────────────────────┤          ├──────────────────────┤
│ ○ sku        ★ NK    │          │ ○ slug      ★ NK     │
│ ○ name               │          │ ○ name               │
│ ○ brand_slug ────────┼─────────▶│                      │
│ ○ cat_slugs ─╮       │          │                      │
│ ○ price      │       │          └──────────────────────┘
└──────────────┼───────┘
               │                  ┌──────────────────────┐
               │                  │ categories.csv       │
               │                  ├──────────────────────┤
               │  (multi, ",")    │ ○ slug      ★ NK     │
               ╰─────────────────▶│ ○ name               │
                                  │                      │
                                  └──────────────────────┘
```

- Each parsed source table and each target HubDB table is a node card
- Columns render as rows inside the node, each as a connection port
- Natural keys marked with a star icon
- Drag from a source column port to a target column port to create an FK edge
- Click an edge to open an inline side panel with: `multi`, `delimiter`, `onMissing`, `matchKey` controls (reuses the exact fields the current `ForeignKeyPanel` has)
- Toggle "form view" / "canvas view" at the top of `/import` — form view is unchanged, canvas is additive

**100% backed by existing `MappingState`.** The canvas is a different renderer; `importRows`, dry run, execute, publish, resume — all untouched.

**Canvas layout persistence:** node positions stored in `MappingState.canvasLayout?: Record<string, {x, y}>` (new optional field). Round-trips through profile `state_json` for free.

**Tech:** [React Flow](https://reactflow.dev) (`@xyflow/react`, MIT, ~45kb gzipped). Battle-tested; n8n and Zapier use it. Handles node positioning, edge routing, zoom/pan, selection — the hard parts.

Scope: ~1 week. Zero backend changes.

#### Phase B — Inline column transforms (real data prep)

Add column-level operations in each node card. The list is grounded in the worked example at the top of this doc — each operation here maps to one of the manual steps that happened for the Prime Capital import.

**Edit-in-place transforms** (operate on an existing column):

- **Rename** — change the column name (updates the mapping + the resolver's view of source rows)
- **Trim / casefold / normalize** — apply before FK resolution and before coercion
- **Drop column** — mark unmapped and hide from the row payload

**Column-synthesis transforms** (create a new column from existing ones or from thin air):

- **Template** — build a new column by concatenating other columns and literal text with `{column}` placeholders. E.g., `"{City}, {State}"` on `{City: "Spanish Fort", State: "AL"}` → `"Spanish Fort, AL"`. Also handles the HubDB image-cell format: `"{Header Image URL},1250,480,220713136421"` → the comma-packed string HubDB expects. Supports simple inline modifiers: `{City|lower}`, `{Name|trim}` — kept intentionally minimal so this stays declarative and doesn't become an expression language. See non-goals.
- **Slugify** — URL-safe lowercase + hyphenated from one or more source columns. Options for separator (`-` default), case (lower default), and whether to strip non-ASCII. Covers the `spanish-fort-al` case directly.
- **Lookup** — expand a value via a user-provided dictionary. `{AL: "Alabama", AR: "Arkansas", ...}` turns `AL` into `Alabama`. Dictionary stored on the transform itself (not a separate "dictionaries" model — keeps scope small). `onMissing: pass-through | null | fail` for values not in the dictionary. Covers 2-letter state codes, country codes, department abbreviations, etc.
- **Constant** — same value every row. For boilerplate (`"Frequently Asked Questions"` on every location) and for static FK lists (`"220701211833,220701211904,..."` as the shared FAQ ID list). FK config on the resulting column can then treat it as multi-value by delimiter if the constant is a comma-separated list.
- **Split by delimiter → new column(s)** — split `"size:L, color:red"` on `", "` → `[size:L, color:red]` → optionally further split into two named columns. Keep separate from Template — splits produce N columns from 1; templates produce 1 column from N.

**Join** (the balloon-risk one):

- **Add column by join** — pick another source table + match column + value column → produces a new synthetic column on this table. E.g., add `brand_slug` to products by joining on `products.brand_id = brands.id` and copying `brands.slug`. Covers the "address pulled from another dataset" case in the worked example. **One hop only** (joined columns cannot themselves be joined against) and `onMissing: null | fail | skip-row`.

All transforms are **pure functions** applied to parsed source rows before anything hits the import pipeline. Preview the transformed sample live in the UI.

**Apply order within a table** (deterministic):
1. `rename` — so later transforms refer to the new name
2. `trim` / `casefold` — normalize existing columns before they're read
3. `drop` — remove columns no later transform depends on
4. `template` / `slugify` / `lookup` / `constant` — add synthesized columns
5. `split` — expand multi-value cells (after synthesis so templates can produce the delimited string)
6. `join` — enrich from another table (last so joined column names can reference anything above)

Within a step, transforms apply in `MappingState.transforms[]` order. Collision validation on save: no transform may produce an existing column name except via rename.

**Data model:** new `MappingState.transforms?: ColumnTransform[]` field. Full union below under "Data model additions."

**Applied in:** a new `lib/transforms.ts` module. Applied before dry run computes its report and before `importRows` reads source rows. Caching considerations are minimal — transforms are cheap and deterministic.

**Risk:** "add column by join" is the balloon risk. UX is harder than it looks:
- What happens on missing match? → `onMissing: null | fail | skip-row`
- What's the output column named? → user-provided, validated against collisions
- Can you join on a joined column? → **no, one hop only** for v1 — explicit constraint
- Does the joined column participate in natural-key / FK resolution? → yes, treated as any other source column

**Risk:** template placeholders can shade into an expression language if we add arithmetic / conditionals. Explicit stance: v1 supports `{column}` and `{column|modifier}` where `modifier ∈ {lower, upper, trim, slugify}`. No `{a + b}`, no `{if …}`, no function calls. If users need more, they can slugify a template result (two transforms) or do it in a spreadsheet.

Scope: ~2-3 weeks for the full set (was 1-2 before the worked example surfaced the 4 synthesis transforms). Each transform is small individually — the cost is UI consistency across six operation types.

#### Phase C — Export normalized files

Button in the canvas toolbar: *"Download prepared files (.zip)"*.

- Runs the full resolver without hitting HubSpot — reuses dry-run infrastructure
- For each source table, writes a CSV with:
  - Column renames applied
  - Trim/casefold/split applied
  - Joined columns inlined
  - FK columns written as natural-key values (not HubDB row IDs — those are portal-specific and useless offline)
- Includes a `README.txt` describing the applied transforms + the mapping snapshot

**Scope:** ~3 days. Pure file-format plumbing on top of existing resolver.

**Non-goal:** writing FKs as resolved HubDB row IDs. Those are portal-specific; the point of export is audit / portability / re-upload, not caching.

### Data model additions

Additive only — no migrations to existing data:

```ts
interface MappingState {
  // ...existing fields unchanged
  canvasLayout?: Record<string, { x: number; y: number }>;  // Phase A
  transforms?: ColumnTransform[];                            // Phase B
}

type ColumnTransform =
  // Edit-in-place
  | { kind: "rename"; table: string; from: string; to: string }
  | { kind: "trim"; table: string; column: string }
  | { kind: "casefold"; table: string; column: string; mode: "lower" | "upper" }
  | { kind: "drop"; table: string; column: string }
  // Column synthesis
  | {
      kind: "template";
      table: string;
      newColumnName: string;
      // Pattern string with {column} and {column|modifier} placeholders.
      // Modifiers: lower | upper | trim | slugify. No arithmetic, no conditionals.
      pattern: string;
    }
  | {
      kind: "slugify";
      table: string;
      newColumnName: string;
      // Columns concatenated with `separator` before slugification.
      sourceColumns: string[];
      separator: string; // default "-"
      stripNonAscii: boolean; // default true
    }
  | {
      kind: "lookup";
      table: string;
      sourceColumn: string;
      newColumnName: string;
      dictionary: Record<string, string>;
      onMissing: "pass-through" | "null" | "fail";
    }
  | {
      kind: "constant";
      table: string;
      newColumnName: string;
      value: string; // same value on every row; FK config can still mark it multi-value
    }
  | {
      kind: "split";
      table: string;
      column: string;
      delimiter: string;
      into: string[]; // names for the produced columns
    }
  // Join (one hop only)
  | {
      kind: "join";
      table: string;
      matchColumn: string;
      foreignTable: string;
      foreignMatchColumn: string;
      foreignValueColumn: string;
      newColumnName: string;
      onMissing: "null" | "fail" | "skip-row";
    };
```

Transforms apply in the deterministic order documented in Phase B (rename → trim/casefold → drop → synthesis → split → join), then within each step in `MappingState.transforms[]` order. First-write-wins on conflicts (a second transform that would create an existing column name fails validation on save, not at import time).

### UX

**Form view (unchanged):** stays as the default for 2-4 table imports. Faster for simple cases.

**Canvas view toggle:** a `[form | canvas]` segmented control in the Results section. Toggle persists per portal in sessionStorage alongside the existing wizard state.

**On the canvas:**
- Pan + zoom via trackpad or scroll
- Mini-map in the corner for 10+ table schemas
- Sidebar lists all target HubDB tables not yet dragged in; drag onto canvas to add
- Right-click a node for transform actions (Phase B) or node-level actions (set NK, change target table)
- Right-click an edge for FK config + delete
- "Validate" button at the top runs client-side checks (unmapped NKs, orphan edges, cyclic joins) before dry run

**Keyboard:** arrow keys pan, Escape deselects, Delete removes selected edge/node, Cmd+Z undo (one level deep is fine for v1).

**Mobile:** canvas is desktop-only. On narrow viewports, redirect to form view with a "canvas requires a wider screen" notice.

### Non-goals (explicit)

Keep scope honest. These are things we **will not build**:

- **Editorial content invention** — writing body copy, section titles, SEO descriptions, meta copy, or any text that doesn't exist in a source somewhere. In the Prime Capital example, the `section_2_content` body, the `faq_section_title`, the `meta_description` — those were written by the client's content team or by Saltedstone editorial. The canvas can mechanically transform data the user has; it is not a copywriter. If the user needs a boilerplate string on every row the `constant` transform can do that, but someone has to decide the string.
- **General-purpose expression language** — no computed columns beyond the fixed transform set (template / slugify / lookup / constant / split / join). Template modifiers are limited to `lower | upper | trim | slugify`. If you need `UPPER(SUBSTR(col, 1, 3))`, do it in Excel.
- **Filtering source rows** — the canvas doesn't support `WHERE price > 0`. Rows go in, resolve, come out.
- **Aggregation** — no `GROUP BY` / `SUM` / `COUNT`. This is a schema-mapping tool, not a reporting tool.
- **Cross-import canvas library** — the canvas is per-portal per-wizard-session. Mapping profiles already handle "save + reuse."
- **Multi-step joins** — one hop only. Join to add a column; cannot then join against the added column.
- **Table splitting from one source** — one source file → one target table. If the client sends one sheet that should become three HubDB tables (as happened with Prime Capital: locations in the source, team members from another system, FAQs curated by hand), the user duplicates/filters the source before upload. We considered a "split rows by criterion into N targets" feature; rejected because the three outputs almost always need different enrichment anyway, which is better done as three separate source → target pipelines.
- **Automatic layout** — initial node positions are a simple grid; the user positions nodes manually. (Can add auto-layout later if requested; adds dagre or elkjs dep ~50kb.)
- **Collaborative editing** — single-user tool. No live cursors or merge logic.

## Dependencies

New npm deps (Phase A only; B and C add nothing):

- `@xyflow/react` — ~45kb gzipped, MIT. Node-graph primitives.

No new backend deps. No new MCP servers. No new env vars.

## Migration + rollout

- **Zero migration cost.** All new fields on `MappingState` are optional; old mapping profiles load unchanged.
- **Zero backend cost in Phase A.** Canvas is pure frontend.
- **Phase B's `transforms[]`** adds a pre-processing step but reuses the existing dry-run / execute pipelines. Transforms are applied in a new `lib/transforms.ts` module called from `dry-run.ts` and `importRows` before anything else runs.
- **Phase C** is a new route (`/api/portals/[id]/export` or similar) that reuses the resolver without the HubSpot write.
- **Rollout:** canvas lands as an opt-in toggle. If users ignore it, it's dormant. If they love it, we promote it to the default view after a few weeks of real use.

## Risks

- **`@xyflow/react` bundle size.** 45kb gzipped on top of the current client bundle. Code-split the canvas view behind a dynamic import so form-view users don't pay for it.
- **Canvas becomes the only thing people use** and we end up maintaining two mapping UIs forever. Mitigation: evaluate after 3 months of real usage; sunset the form view if it hits <20% of sessions.
- **Phase B's "join" transform is a mini-ETL.** Scope creep risk — users will ask for filters, aggregations, computed columns next. Mitigation: the non-goals above are the escape hatch. "Not in scope" is a complete answer.
- **Node positioning hell on 10+ table imports.** React Flow handles routing but edges still overlap visually. Add dagre auto-layout (~50kb) only if first users complain.
- **Transform ordering ambiguity.** If a user applies rename+split+join to the same column, the apply order matters. Document the deterministic order (rename → trim/casefold → drop → split → join) and show the applied order in the UI.

## Recommendation

**Phase A only, as a one-week spike.** Build the canvas, wire it to existing `MappingState`, ship behind a toggle. Then use it on a real 5+ table portal import and decide whether B and C are what the user actually needs — or if the visualization alone solves 80% of the pain and the remaining 20% is better served by a different tool (one-off transform scripts, a cleanup checklist, better docs).

Phase B's "add column by join" is the feature that pays for the whole thing if it works. But we should prove the canvas UX first before committing to the ETL surface.

## When to revisit this doc

- After Phase A ships and gets 2-3 real imports through it — update with usage findings
- If React Flow becomes insufficient (unlikely at this scale)
- If users ask for scope beyond the explicit non-goals — update the non-goals list with the rationale for the refusal

## Open questions

- Do we need a "canvas → form" sync so a user can start on the canvas and finish in the form view? (Probably yes if `MappingState` round-trips cleanly, which it should.)
- Should auto-layout be a Phase A feature or a Phase D polish? (Lean: polish — manual positioning is fine for 5-10 nodes.)
- How does the canvas handle Google Sheets refresh (Phase 2 feature)? If the sheet schema changes, do we invalidate the canvas? (Lean: show a diff, let user accept/reject per-column.)
- Should transforms (Phase B) be per-table or cross-table? Current data model is per-table; a cross-table transform ("casefold every slug column across all tables") would be a Phase D convenience.
