import type { HubdbClient } from "./client";
import { getDraftTable, listTables } from "./tables";
import type { HubdbColumn, HubdbTable } from "./types";

// Introspection surface for F3. `listTables` returns the live snapshot
// per F0-12, so we follow up with `getDraftTable` per table to pick up
// pending column changes that a diff / provision needs to see.
export interface PortalSchemaTable extends HubdbTable {
  draftColumns: HubdbColumn[];
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
        return { ...t, draftColumns: draft.columns };
      } catch (err) {
        return {
          ...t,
          draftColumns: t.columns,
          draftFetchError: (err as Error).message,
        };
      }
    }),
  );

  return { tables, fetchedAt: now() };
}
