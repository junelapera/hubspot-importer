import type { HubdbClient } from "./client";
import { getDraftTable, listTables } from "./tables";
import type { HubdbColumn, HubdbTable } from "./types";

// Introspection surface for F3 / F4 / F7 / F8. `listTables` returns the
// live snapshot per F0-12, so we follow up with `getDraftTable` per table.
//
// `columns` is the DRAFT column set: every write this app makes targets
// the draft (row batches under /rows/draft, schema PATCHes under /draft),
// so mapping, synthesis, dry run, diff and provision must all see it. A
// column re-created in the HubSpot UI (e.g. TEXT "Department" → SELECT
// "department") exists only in the draft until published — reading live
// columns there mapped rows onto a column the draft no longer has.
export interface PortalSchemaTable extends HubdbTable {
  /** Same as `columns` — kept for callers that name the draft explicitly. */
  draftColumns: HubdbColumn[];
  /** The published schema, for display (may lag the draft). */
  liveColumns: HubdbColumn[];
  draftFetchError?: string;
}

export interface PortalSchemaSnapshot {
  tables: PortalSchemaTable[];
  fetchedAt: string;
}

export async function fetchPortalSchema(
  client: HubdbClient,
  now: () => string = () => new Date().toISOString(),
): Promise<PortalSchemaSnapshot> {
  const listed = await listTables(client);

  const tables = await Promise.all(
    listed.map(async (t): Promise<PortalSchemaTable> => {
      try {
        const draft = await getDraftTable(client, t.id);
        return { ...t, columns: draft.columns, draftColumns: draft.columns, liveColumns: t.columns };
      } catch (err) {
        return {
          ...t,
          draftColumns: t.columns,
          liveColumns: t.columns,
          draftFetchError: (err as Error).message,
        };
      }
    }),
  );

  return { tables, fetchedAt: now() };
}
