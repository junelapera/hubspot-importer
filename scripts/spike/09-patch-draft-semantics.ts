import { client, HubdbError, log, runSpike } from "./client";
import { createTable, getTable, listTables } from "../../lib/hubdb";
import type { HubdbColumn, HubdbTable } from "../../lib/hubdb";

const TABLE_NAME = "spike_patch_test";
const TABLE_LABEL = "Spike PATCH draft semantics";

async function deleteIfExists(): Promise<void> {
  const tables = await listTables(client);
  const existing = tables.find((t) => t.name === TABLE_NAME);
  if (!existing) return;
  await client.request(`/tables/${encodeURIComponent(existing.id)}`, { method: "DELETE" });
}

async function reset(cols: Array<{ name: string; type: string; label: string }>): Promise<HubdbTable> {
  await deleteIfExists();
  return createTable(client, {
    name: TABLE_NAME,
    label: TABLE_LABEL,
    useForPages: false,
    allowChildTables: false,
    enableChildTablePages: false,
    columns: cols,
  });
}

function colSummary(cols: readonly HubdbColumn[]) {
  return cols.map((c) => ({ id: c.id, name: c.name, type: c.type, label: c.label }));
}

async function patchDraft(id: string, body: unknown) {
  try {
    const res = await client.request<HubdbTable>(
      `/tables/${encodeURIComponent(id)}/draft`,
      { method: "PATCH", body },
    );
    return { ok: true as const, columns: colSummary(res.columns) };
  } catch (err) {
    if (err instanceof HubdbError) return { ok: false as const, status: err.status, body: err.responseBody };
    throw err;
  }
}

async function fetchCols(id: string) {
  const t = await getTable(client, id);
  return colSummary(t.columns);
}

runSpike(async () => {
  // ─── Test 1: PATCH with only-new column (no ids) ────────────────
  {
    const start = await reset([
      { name: "a", label: "A", type: "TEXT" },
      { name: "b", label: "B", type: "TEXT" },
    ]);
    log("test-1 setup", { id: start.id, cols: colSummary(start.columns) });
    const patched = await patchDraft(start.id, {
      columns: [{ name: "c", label: "C", type: "TEXT" }],
    });
    log("test-1 PATCH response (new-only)", patched);
    log("test-1 GET after PATCH", { cols: await fetchCols(start.id) });
  }

  // ─── Test 2: PATCH with existing (with ids) + new ────────────────
  {
    const start = await reset([
      { name: "a", label: "A", type: "TEXT" },
      { name: "b", label: "B", type: "TEXT" },
    ]);
    log("test-2 setup", { id: start.id, cols: colSummary(start.columns) });
    const patched = await patchDraft(start.id, {
      columns: [
        { id: start.columns[0].id, name: "a", label: "A", type: "TEXT" },
        { id: start.columns[1].id, name: "b", label: "B", type: "TEXT" },
        { name: "c", label: "C", type: "TEXT" },
      ],
    });
    log("test-2 PATCH response (existing+new)", patched);
    log("test-2 GET after PATCH", { cols: await fetchCols(start.id) });
  }

  // ─── Test 3: PATCH with subset of existing (drop test) ──────────
  {
    const start = await reset([
      { name: "a", label: "A", type: "TEXT" },
      { name: "b", label: "B", type: "TEXT" },
      { name: "c", label: "C", type: "TEXT" },
    ]);
    log("test-3 setup", { id: start.id, cols: colSummary(start.columns) });
    const patched = await patchDraft(start.id, {
      columns: [{ id: start.columns[0].id, name: "a", label: "A", type: "TEXT" }],
    });
    log("test-3 PATCH response (subset)", patched);
    log("test-3 GET after PATCH", { cols: await fetchCols(start.id) });
  }

  // ─── Test 4: PATCH one existing col with label change, omit others ──
  {
    const start = await reset([
      { name: "a", label: "A", type: "TEXT" },
      { name: "b", label: "B", type: "TEXT" },
    ]);
    log("test-4 setup", { id: start.id, cols: colSummary(start.columns) });
    const patched = await patchDraft(start.id, {
      columns: [{ id: start.columns[0].id, name: "a", label: "Alpha", type: "TEXT" }],
    });
    log("test-4 PATCH response (label change on one, other omitted)", patched);
    log("test-4 GET after PATCH", { cols: await fetchCols(start.id) });
  }

  await deleteIfExists();
  log("cleanup", { note: "spike_patch_test deleted" });
});
