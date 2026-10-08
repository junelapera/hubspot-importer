import { client, log, runSpike } from "./client";
import {
  fetchPortalSchema,
  importRows,
  listAllDraftRows,
  opsFromClient,
  opsFromClientForImport,
  provision,
} from "../../lib/hubdb";
import { synthesizeExecution } from "../../lib/execution";
import { initialMappingState, type MappingState } from "../../lib/mapping";
import { diffSchema, parseSchema } from "../../lib/schema";

// Page-table round trip with hs_path as the natural key — the "re-import
// team members matched on their page path" case:
//   provision a useForPages table → synthesize from the portal snapshot
//   (hs_path / hs_name pseudo-columns) → import → verify row-level path /
//   name → re-import with an edited title → verify updates, no duplicates
//   → cleanup

const TEAM = `spike_pages_${Date.now()}`;

async function cleanup(): Promise<void> {
  const snapshot = await fetchPortalSchema(client);
  const t = snapshot.tables.find((x) => x.name === TEAM);
  if (t) await client.request(`/tables/${encodeURIComponent(t.id)}`, { method: "DELETE" });
}

function run(rows: Record<string, string>[], portalTables: Awaited<ReturnType<typeof fetchPortalSchema>>["tables"]) {
  const mapping: MappingState = {
    ...initialMappingState(),
    targetTableName: TEAM,
    columnMap: {
      hs_path: { kind: "mapped", targetColumn: "hs_path" },
      Name: { kind: "mapped", targetColumn: "hs_name" },
      Title: { kind: "mapped", targetColumn: "title" },
    },
    naturalKey: ["hs_path"],
  };
  const syn = synthesizeExecution({ sources: [{ name: TEAM, rows }], mappings: { [TEAM]: mapping }, portalTables });
  if (!syn.schema) throw new Error(`synthesis failed: ${JSON.stringify(syn.issues)}`);
  return importRows(opsFromClientForImport(client), { schema: syn.schema, tableIds: syn.tableIds, source: syn.source });
}

runSpike(async () => {
  log("using table", TEAM);
  try {
    const schema = parseSchema({
      version: 1,
      tables: [
        {
          name: TEAM,
          label: TEAM,
          useForPages: true,
          naturalKey: "title",
          columns: [{ name: "title", label: "Title", type: "TEXT" }],
        },
      ],
    });
    const before = await fetchPortalSchema(client);
    await provision(opsFromClient(client), diffSchema(schema, before.tables));

    const snapshot = await fetchPortalSchema(client);
    const table = snapshot.tables.find((t) => t.name === TEAM);
    if (!table) throw new Error("provisioned table missing");
    log("step-1 snapshot columns", table.columns.map((c) => c.name));

    const rows = [
      { hs_path: "jane-doe", Name: "Jane Doe", Title: "Advisor" },
      { hs_path: "john-roe", Name: "John Roe", Title: "Partner" },
    ];
    const first = await run(rows, snapshot.tables);
    log("step-2 import", first.tables.map((t) => ({ created: t.created, updated: t.updated, errors: t.errors })));

    const draft = await listAllDraftRows(client, table.id);
    log("step-3 draft rows", draft.map((r) => ({ id: r.id, path: r.path, name: r.name, values: r.values })));
    const jane = draft.find((r) => r.path === "jane-doe");
    if (!jane || jane.name !== "Jane Doe") throw new Error("row-level path / name did not round-trip");

    const second = await run([{ ...rows[0], Title: "Senior Advisor" }, rows[1]], snapshot.tables);
    const t2 = second.tables[0];
    log("step-4 re-import", { created: t2?.created, updated: t2?.updated, errors: t2?.errors });
    const after = await listAllDraftRows(client, table.id);
    if (after.length !== 2) throw new Error(`expected 2 rows after re-import, got ${after.length}`);
    const jane2 = after.find((r) => r.path === "jane-doe");
    if (jane2?.id !== jane.id || jane2.values["title"] !== "Senior Advisor") {
      throw new Error(`re-import did not update jane-doe in place: ${JSON.stringify(jane2)}`);
    }
    log("step-5 verified", "matched on hs_path, updated in place, no duplicates");
  } finally {
    await cleanup();
    log("cleanup", "table deleted");
  }
});
