import { client, log, runSpike } from "./client";
import {
  createTable,
  getDraftTable,
  listTables,
  opsFromClient,
  provision,
} from "../../lib/hubdb";
import { diffSchema, parseSchema } from "../../lib/schema";

const TABLE_NAME = "spike_provision_test";
const TABLE_LABEL = "Spike provisioner end-to-end";

async function deleteIfExists(): Promise<void> {
  const tables = await listTables(client);
  const existing = tables.find((t) => t.name === TABLE_NAME);
  if (!existing) return;
  await client.request(`/tables/${encodeURIComponent(existing.id)}`, { method: "DELETE" });
}

runSpike(async () => {
  await deleteIfExists();

  // Step 1: create the table with initial columns via the wrapper's createTable.
  const created = await createTable(client, {
    name: TABLE_NAME,
    label: TABLE_LABEL,
    useForPages: false,
    allowChildTables: false,
    enableChildTablePages: false,
    columns: [
      { name: "sku", label: "SKU", type: "TEXT" },
      { name: "title", label: "Title", type: "TEXT" },
    ],
  });
  log("step-1 created", { id: created.id, cols: created.columns.map((c) => c.name) });

  // Step 2: schema wants three columns (add "description"). Diff against the
  // draft state, then hand the plan to provision().
  const schema = parseSchema({
    version: 1,
    tables: [
      {
        name: TABLE_NAME,
        label: TABLE_LABEL,
        naturalKey: "sku",
        columns: [
          { name: "sku", label: "SKU", type: "TEXT" },
          { name: "title", label: "Title", type: "TEXT" },
          { name: "description", label: "Description", type: "TEXT" },
        ],
      },
    ],
  });

  const draftBefore = await getDraftTable(client, created.id);
  log("step-2 draft before diff", { cols: draftBefore.columns.map((c) => c.name) });

  const plan = diffSchema(schema, [draftBefore]);
  log("step-2 diff plan", {
    ok: plan.ok,
    actions: plan.tables.map((t) => ({
      name: t.name,
      action: t.action,
      ...(t.action === "update" ? { addColumns: t.addColumns.map((c) => c.name) } : {}),
    })),
  });

  // Step 3: provision
  const events: string[] = [];
  const result = await provision(opsFromClient(client), plan, {
    onEvent: (e) => events.push(`${e.kind}:${e.table}`),
  });
  log("step-3 provision result", { events, tableIds: result.tableIds });

  // Step 4: verify draft actually has all three columns now
  const draftAfter = await getDraftTable(client, created.id);
  const finalNames = draftAfter.columns.map((c) => c.name);
  log("step-4 draft after provision", { cols: finalNames });

  const expected = ["sku", "title", "description"];
  const actualSorted = [...finalNames].sort();
  const expectedSorted = [...expected].sort();
  const match = JSON.stringify(actualSorted) === JSON.stringify(expectedSorted);
  log("step-4 verdict", { expected, actual: finalNames, match });

  await deleteIfExists();
  log("cleanup", { note: `${TABLE_NAME} deleted` });

  if (!match) throw new Error(`provision did not converge draft to expected columns`);
});
