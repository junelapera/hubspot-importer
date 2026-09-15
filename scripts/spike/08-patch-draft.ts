import { client, HubdbError, log, runSpike } from "./client";
import { createTable, listTables } from "../../lib/hubdb";
import type { HubdbTable } from "../../lib/hubdb";

const TABLE_NAME = "spike_patch_test";
const TABLE_LABEL = "Spike PATCH draft-path";

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

async function tryPath(label: string, path: string, method: "GET" | "PATCH" | "POST" | "PUT", body?: unknown) {
  try {
    const res = await client.request<unknown>(path, { method, body });
    return { label, ok: true as const, response: res };
  } catch (err) {
    if (err instanceof HubdbError) {
      const bodyPreview =
        typeof err.responseBody === "string"
          ? err.responseBody.slice(0, 200)
          : err.responseBody;
      return { label, ok: false as const, status: err.status, body: bodyPreview };
    }
    throw err;
  }
}

runSpike(async () => {
  const t = await fresh();
  log("setup", { id: t.id, cols: t.columns.map((c) => c.name) });

  const id = t.id;
  const patchBody = {
    columns: [
      { id: t.columns[0].id, name: "a", label: "A", type: "TEXT" },
      { id: t.columns[1].id, name: "b", label: "B", type: "TEXT" },
      { name: "c", label: "C", type: "TEXT" },
    ],
  };

  // Discovery: what does /tables/{id}/draft look like?
  log(
    "GET /tables/{id}/draft",
    await tryPath("GET draft", `/tables/${encodeURIComponent(id)}/draft`, "GET"),
  );

  // Try PATCH on /tables/{id}/draft
  log(
    "PATCH /tables/{id}/draft",
    await tryPath("PATCH draft", `/tables/${encodeURIComponent(id)}/draft`, "PATCH", patchBody),
  );

  // Try PUT on /tables/{id}/draft
  log(
    "PUT /tables/{id}/draft",
    await tryPath("PUT draft", `/tables/${encodeURIComponent(id)}/draft`, "PUT", patchBody),
  );

  // Try POST /tables/{id}/draft (some HubSpot endpoints use POST for updates)
  log(
    "POST /tables/{id}/draft",
    await tryPath("POST draft", `/tables/${encodeURIComponent(id)}/draft`, "POST", patchBody),
  );

  await deleteIfExists();
  log("cleanup", { note: "spike_patch_test deleted" });
});
