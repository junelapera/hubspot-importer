import { client, HubdbError, log, runSpike } from "./client";
import { createTable, listTables } from "../../lib/hubdb";
import type { HubdbColumn, HubdbTable } from "../../lib/hubdb";

const TABLE_NAME = "spike_patch_test";
const TABLE_LABEL = "Spike PATCH draft truth";

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

async function getDraft(id: string) {
  const res = await client.request<HubdbTable>(`/tables/${encodeURIComponent(id)}/draft`);
  return colSummary(res.columns);
}

async function pushLiveAndGet(id: string) {
  await client.request(`/tables/${encodeURIComponent(id)}/draft/push-live`, { method: "POST" });
  const res = await client.request<HubdbTable>(`/tables/${encodeURIComponent(id)}`);
  return colSummary(res.columns);
}

runSpike(async () => {
  // Question: is PATCH /draft merge or replace? Verify against GET /draft
  // (draft view) and after push-live GET (live view).

  // Test 1: only new column, no ids — does existing survive in draft?
  {
    const start = await reset([
      { name: "a", label: "A", type: "TEXT" },
      { name: "b", label: "B", type: "TEXT" },
    ]);
    log("test-1 setup", { id: start.id, cols: colSummary(start.columns) });
    log("test-1 PATCH response", await patchDraft(start.id, {
      columns: [{ name: "c", label: "C", type: "TEXT" }],
    }));
    log("test-1 GET draft after PATCH", { cols: await getDraft(start.id) });
    log("test-1 GET live after push-live", { cols: await pushLiveAndGet(start.id) });
  }

  // Test 2: subset of existing (drop test)
  {
    const start = await reset([
      { name: "a", label: "A", type: "TEXT" },
      { name: "b", label: "B", type: "TEXT" },
      { name: "c", label: "C", type: "TEXT" },
    ]);
    log("test-2 setup", { id: start.id, cols: colSummary(start.columns) });
    log("test-2 PATCH response", await patchDraft(start.id, {
      columns: [{ id: start.columns[0].id, name: "a", label: "A", type: "TEXT" }],
    }));
    log("test-2 GET draft after PATCH", { cols: await getDraft(start.id) });
    log("test-2 GET live after push-live", { cols: await pushLiveAndGet(start.id) });
  }

  await deleteIfExists();
  log("cleanup", { note: "spike_patch_test deleted" });
});
