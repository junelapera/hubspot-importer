import { hubdb, HubdbError, log, runSpike } from "./client";

type Table = { id: string; name: string; label: string; published: boolean };
type ListTables = { results: Table[] };

type TableSpec = {
  name: string;
  label: string;
  columns: Array<{ name: string; label: string; type: string }>;
};

const FOREIGN_TABLES: TableSpec[] = [
  {
    name: "brands",
    label: "Brands",
    columns: [
      { name: "name", label: "Name", type: "TEXT" },
      { name: "slug", label: "Slug", type: "TEXT" },
    ],
  },
  {
    name: "categories",
    label: "Categories",
    columns: [
      { name: "name", label: "Name", type: "TEXT" },
      { name: "slug", label: "Slug", type: "TEXT" },
    ],
  },
];

async function ensureTable(spec: TableSpec, existing: Table[]) {
  const already = existing.find((t) => t.name === spec.name);
  if (already) {
    return { action: "skip" as const, id: already.id, name: spec.name, published: already.published };
  }
  const created = await hubdb<Table>("/tables", {
    method: "POST",
    body: {
      name: spec.name,
      label: spec.label,
      useForPages: false,
      allowChildTables: false,
      enableChildTablePages: false,
      columns: spec.columns,
    },
  });
  return { action: "create" as const, id: created.id, name: spec.name, published: created.published };
}

async function reproduceBadForeignColumn(existing: Table[]) {
  const badName = "spike_bad_fk";
  const existingBad = existing.find((t) => t.name === badName);
  if (existingBad) {
    return {
      reproduced: null,
      note: `leftover '${badName}' (id ${existingBad.id}) from a previous run — delete it and re-run to re-test the error path`,
    };
  }
  try {
    const res = await hubdb<Table>("/tables", {
      method: "POST",
      body: {
        name: badName,
        label: "Spike bad FK",
        useForPages: false,
        allowChildTables: false,
        enableChildTablePages: false,
        columns: [{ name: "brand", label: "Brand", type: "FOREIGN_ID" }],
      },
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
  const list = await hubdb<ListTables>("/tables");
  log("existing tables", {
    count: list.results?.length ?? 0,
    names: list.results?.map((t) => t.name),
  });

  const provisioned = [] as Array<Awaited<ReturnType<typeof ensureTable>>>;
  for (const spec of FOREIGN_TABLES) {
    provisioned.push(await ensureTable(spec, list.results));
  }
  log("foreign tables", provisioned);

  const badFk = await reproduceBadForeignColumn(list.results);
  log("bad FOREIGN_ID column attempt", badFk);
});
