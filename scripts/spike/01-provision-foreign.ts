import { client, HubdbError, log, runSpike } from "./client";
import { createTable, listTables, type HubdbTable, type HubdbTableInput } from "../../lib/hubdb";

const FOREIGN_TABLES: HubdbTableInput[] = [
  {
    name: "brands",
    label: "Brands",
    useForPages: false,
    allowChildTables: false,
    enableChildTablePages: false,
    columns: [
      { name: "name", label: "Name", type: "TEXT" },
      { name: "slug", label: "Slug", type: "TEXT" },
    ],
  },
  {
    name: "categories",
    label: "Categories",
    useForPages: false,
    allowChildTables: false,
    enableChildTablePages: false,
    columns: [
      { name: "name", label: "Name", type: "TEXT" },
      { name: "slug", label: "Slug", type: "TEXT" },
    ],
  },
];

async function ensureTable(spec: HubdbTableInput, existing: HubdbTable[]) {
  const already = existing.find((t) => t.name === spec.name);
  if (already) {
    return { action: "skip" as const, id: already.id, name: spec.name, published: already.published };
  }
  const created = await createTable(client, spec);
  return { action: "create" as const, id: created.id, name: spec.name, published: created.published };
}

async function reproduceBadForeignColumn(existing: HubdbTable[]) {
  const badName = "spike_bad_fk";
  const existingBad = existing.find((t) => t.name === badName);
  if (existingBad) {
    return {
      reproduced: null,
      note: `leftover '${badName}' (id ${existingBad.id}) from a previous run — delete it and re-run to re-test the error path`,
    };
  }
  try {
    const res = await createTable(client, {
      name: badName,
      label: "Spike bad FK",
      useForPages: false,
      allowChildTables: false,
      enableChildTablePages: false,
      columns: [{ name: "brand", label: "Brand", type: "FOREIGN_ID" }],
    });
    return {
      reproduced: false,
      createdId: res.id,
      note: "unexpected — FOREIGN_ID column without foreignTableId/foreignColumnId was accepted; delete it manually",
    };
  } catch (err) {
    if (err instanceof HubdbError) {
      return { reproduced: true, status: err.status, body: err.responseBody };
    }
    throw err;
  }
}

runSpike(async () => {
  const existing = await listTables(client);
  log("existing tables", {
    count: existing.length,
    names: existing.map((t) => t.name),
  });

  const provisioned = [] as Array<Awaited<ReturnType<typeof ensureTable>>>;
  for (const spec of FOREIGN_TABLES) {
    provisioned.push(await ensureTable(spec, existing));
  }
  log("foreign tables", provisioned);

  const badFk = await reproduceBadForeignColumn(existing);
  log("bad FOREIGN_ID column attempt", badFk);
});
