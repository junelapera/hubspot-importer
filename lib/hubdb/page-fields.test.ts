import { describe, expect, it } from "vitest";
import type { HubdbClient } from "./client";
import { liftPageValues, withPageValues } from "./page-fields";
import { batchCreateDraftRows, batchUpdateDraftRows, listAllDraftRows } from "./rows";

describe("withPageValues", () => {
  it("folds row path / name into values.hs_path / values.hs_name", () => {
    expect(withPageValues({ id: "1", path: "jane-doe", name: "Jane Doe", values: { title: "Advisor" } })).toEqual({
      id: "1",
      path: "jane-doe",
      name: "Jane Doe",
      values: { title: "Advisor", hs_path: "jane-doe", hs_name: "Jane Doe" },
    });
  });

  it("leaves rows without page fields untouched", () => {
    const row = { id: "1", values: { slug: "acme" } };
    expect(withPageValues(row)).toBe(row);
  });
});

describe("liftPageValues", () => {
  it("lifts values.hs_path / values.hs_name to row path / name", () => {
    expect(liftPageValues({ values: { hs_path: "jane-doe", hs_name: "Jane Doe", title: "Advisor" } })).toEqual({
      path: "jane-doe",
      name: "Jane Doe",
      values: { title: "Advisor" },
    });
  });

  it("keeps the row id on updates", () => {
    expect(liftPageValues({ id: "9", values: { hs_path: "x" } })).toEqual({ id: "9", path: "x", values: {} });
  });
});

function recordingClient(response: unknown) {
  const calls: { path: string; body: unknown }[] = [];
  const client = {
    request: async (path: string, init?: { body?: unknown }) => {
      calls.push({ path, body: init?.body });
      return response;
    },
  } as unknown as HubdbClient;
  return { client, calls };
}

describe("row I/O", () => {
  it("batch create / update send page fields as row-level path / name", async () => {
    const { client, calls } = recordingClient({ results: [{ id: 5, path: "jane-doe", values: {} }] });
    const created = await batchCreateDraftRows(client, "1", [{ values: { hs_path: "jane-doe", title: "A" } }]);
    await batchUpdateDraftRows(client, "1", [{ id: "5", values: { hs_name: "Jane", title: "B" } }]);
    expect(calls[0]?.body).toEqual({ inputs: [{ path: "jane-doe", values: { title: "A" } }] });
    expect(calls[1]?.body).toEqual({ inputs: [{ id: "5", name: "Jane", values: { title: "B" } }] });
    // Responses fold back so fresh ids key by hs_path like listed rows do.
    expect(created[0]?.values).toEqual({ hs_path: "jane-doe" });
  });

  it("reads fold path into values so rows can be matched on hs_path", async () => {
    const { client } = recordingClient({ results: [{ id: 7, path: "jane-doe", name: "Jane", values: { title: "A" } }] });
    const rows = await listAllDraftRows(client, "1");
    expect(rows[0]).toMatchObject({ id: "7", values: { title: "A", hs_path: "jane-doe", hs_name: "Jane" } });
  });
});
