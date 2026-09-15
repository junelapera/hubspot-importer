import { client, HubdbError, log, runSpike } from "./client";
import { createTable, getTable, listTables } from "../../lib/hubdb";
import type { HubdbColumn, HubdbTable } from "../../lib/hubdb";

const TABLE_NAME = "spike_patch_test";
const TABLE_LABEL = "Spike PATCH semantics";

async function deleteIfExists(): Promise<void> {
  const tables = await listTables(client);
  const existing = tables.find((t) => t.name === TABLE_NAME);
  if (!existing) return;
  await client.request(`/tables/${encodeURIComponent(existing.id)}`, { method: "DELETE" });
}

async function reset(
  cols: Array<{ name: string; type: string; label?: string }>,
): Promise<HubdbTable> {
  await deleteIfExists();
  return createTable(client, {
    name: TABLE_NAME,
    label: TABLE_LABEL,
    useForPages: false,
    allowChildTables: false,
    enableChildTablePages: false,
    columns: cols.map((c) => ({ label: c.name.toUpperCase(), ...c })),
  });
}

function colSummary(cols: readonly HubdbColumn[]) {
  return cols.map((c) => ({ id: c.id, name: c.name, type: c.type, label: c.label }));
}

async function patch(id: string, body: unknown) {
  try {
    const res = await client.request<HubdbTable>(`/tables/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    });
    return { ok: true as const, response: { id: res.id, columns: colSummary(res.columns) } };
  } catch (err) {
    if (err instanceof HubdbError) {
      return { ok: false as const, status: err.status, body: err.responseBody };
    }
    throw err;
  }
}

async function fetchCols(id: string) {
  const t = await getTable(client, id);
  return colSummary(t.columns);
}

runSpike(async () => {
  log("SETUP", { note: "Starting from a clean slate; will delete throwaway table between tests" });

  // ─── Test 1 ───────────────────────────────────────────────────────
  // PATCH with new columns only, no ids for the existing ones.
  {
    const start = await reset([
      { name: "a", type: "TEXT" },
      { name: "b", type: "TEXT" },
    ]);
    log("test-1 setup", { id: start.id, columns: colSummary(start.columns) });
    const patched = await patch(start.id, {
      columns: [{ name: "c", label: "C", type: "TEXT" }],
    });
    log("test-1 PATCH new-only response", patched);
    log("test-1 GET after PATCH", { columns: await fetchCols(start.id) });
  }

  // ─── Test 2 ───────────────────────────────────────────────────────
  // PATCH with existing (id-preserving) plus a new column.
  {
    const start = await reset([
      { name: "a", type: "TEXT" },
      { name: "b", type: "TEXT" },
    ]);
    const aId = start.columns.find((c) => c.name === "a")?.id;
    const bId = start.columns.find((c) => c.name === "b")?.id;
    log("test-2 setup", { id: start.id, columns: colSummary(start.columns) });
    const patched = await patch(start.id, {
      columns: [
        { id: aId, name: "a", label: "A", type: "TEXT" },
        { id: bId, name: "b", label: "B", type: "TEXT" },
        { name: "c", label: "C", type: "TEXT" },
      ],
    });
    log("test-2 PATCH existing+new response", patched);
    log("test-2 GET after PATCH", { columns: await fetchCols(start.id) });
  }

  // ─── Test 3 ───────────────────────────────────────────────────────
  // PATCH with a strict subset of existing columns (a, b, c → send only a).
  {
    const start = await reset([
      { name: "a", type: "TEXT" },
      { name: "b", type: "TEXT" },
      { name: "c", type: "TEXT" },
    ]);
    const aId = start.columns.find((c) => c.name === "a")?.id;
    log("test-3 setup", { id: start.id, columns: colSummary(start.columns) });
    const patched = await patch(start.id, {
      columns: [{ id: aId, name: "a", label: "A", type: "TEXT" }],
    });
    log("test-3 PATCH subset response", patched);
    log("test-3 GET after PATCH", { columns: await fetchCols(start.id) });
  }

  // ─── Test 4 ───────────────────────────────────────────────────────
  // PATCH one existing column with a label change, omit the other.
  {
    const start = await reset([
      { name: "a", type: "TEXT", label: "A" },
      { name: "b", type: "TEXT", label: "B" },
    ]);
    const aId = start.columns.find((c) => c.name === "a")?.id;
    log("test-4 setup", { id: start.id, columns: colSummary(start.columns) });
    const patched = await patch(start.id, {
      columns: [{ id: aId, name: "a", type: "TEXT", label: "Alpha" }],
    });
    log("test-4 PATCH label-change response", patched);
    log("test-4 GET after PATCH", { columns: await fetchCols(start.id) });
  }

  // Cleanup so the sandbox doesn't accumulate spike_patch_test artifacts.
  await deleteIfExists();
  log("CLEANUP", { note: "spike_patch_test deleted" });
});
