import { client, HubdbError, log, runSpike } from "./client";
import { createTable, listTables } from "../../lib/hubdb";
import type { HubdbTable } from "../../lib/hubdb";

const TABLE_NAME = "spike_patch_test";
const TABLE_LABEL = "Spike PATCH auth";

async function deleteIfExists(): Promise<void> {
  const tables = await listTables(client);
  const existing = tables.find((t) => t.name === TABLE_NAME);
  if (!existing) return;
  await client.request(`/tables/${encodeURIComponent(existing.id)}`, { method: "DELETE" });
}

async function fresh(): Promise<HubdbTable> {
  await deleteIfExists();
  return createTable(client, {
    name: TABLE_NAME,
    label: TABLE_LABEL,
    useForPages: false,
    allowChildTables: false,
    enableChildTablePages: false,
    columns: [
      { name: "a", label: "A", type: "TEXT" },
      { name: "b", label: "B", type: "TEXT" },
    ],
  });
}

type Attempt = {
  label: string;
  method: "PATCH" | "PUT";
  base: "v3" | "dated";
  body: unknown;
};

async function tryAttempt(id: string, a: Attempt) {
  try {
    const res = await client.request<HubdbTable>(`/tables/${encodeURIComponent(id)}`, {
      method: a.method,
      base: a.base,
      body: a.body,
    });
    return {
      label: a.label,
      ok: true as const,
      responseColumns: res.columns?.map((c) => ({ id: c.id, name: c.name })),
    };
  } catch (err) {
    if (err instanceof HubdbError) {
      return {
        label: a.label,
        ok: false as const,
        status: err.status,
        body: err.responseBody,
      };
    }
    throw err;
  }
}

runSpike(async () => {
  const t = await fresh();
  log("setup", { id: t.id, cols: t.columns.map((c) => c.name) });

  // Sanity: does GET on the same base work? (yes)
  const attempts: Attempt[] = [
    {
      label: "PATCH v3, columns array only",
      method: "PATCH",
      base: "v3",
      body: { columns: [{ name: "c", label: "C", type: "TEXT" }] },
    },
    {
      label: "PATCH dated, columns array only",
      method: "PATCH",
      base: "dated",
      body: { columns: [{ name: "c", label: "C", type: "TEXT" }] },
    },
    {
      label: "PUT v3, columns array only",
      method: "PUT",
      base: "v3",
      body: { columns: [{ name: "c", label: "C", type: "TEXT" }] },
    },
    {
      label: "PATCH v3, label change only (no columns)",
      method: "PATCH",
      base: "v3",
      body: { label: "Renamed" },
    },
    {
      label: "PATCH v3, full body (name+label+columns)",
      method: "PATCH",
      base: "v3",
      body: {
        name: TABLE_NAME,
        label: TABLE_LABEL,
        columns: [
          { id: t.columns[0].id, name: "a", label: "A", type: "TEXT" },
          { id: t.columns[1].id, name: "b", label: "B", type: "TEXT" },
          { name: "c", label: "C", type: "TEXT" },
        ],
      },
    },
  ];

  for (const a of attempts) {
    const res = await tryAttempt(t.id, a);
    log(a.label, res);
  }

  await deleteIfExists();
  log("cleanup", { note: "spike_patch_test deleted" });
});
