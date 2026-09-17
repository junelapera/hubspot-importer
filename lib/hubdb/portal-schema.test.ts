import { describe, expect, it } from "vitest";
import { fetchPortalSchema } from "./portal-schema";
import type { HubdbClient } from "./client";
import type { HubdbColumn, HubdbTable } from "./types";

function table(id: string, name: string, columns: HubdbColumn[], overrides: Partial<HubdbTable> = {}): HubdbTable {
  return {
    id,
    name,
    label: name,
    published: false,
    columns,
    ...overrides,
  };
}

function col(id: string, name: string, type: string = "TEXT"): HubdbColumn {
  return { id, name, type };
}

function fakeClient(handlers: {
  onList: () => unknown;
  onGetDraft: (ref: string) => unknown;
}): HubdbClient {
  return {
    request: async (path: string) => {
      if (path === "/tables") return handlers.onList();
      const match = path.match(/^\/tables\/([^/]+)\/draft$/);
      if (match) return handlers.onGetDraft(decodeURIComponent(match[1]));
      throw new Error(`unexpected path: ${path}`);
    },
  } as unknown as HubdbClient;
}

describe("fetchPortalSchema", () => {
  it("returns tables with draft columns merged over live columns", async () => {
    const live = table("1", "brands", [col("1", "slug")], { rowCount: 3 });
    const draft = table("1", "brands", [col("1", "slug"), col("2", "name")], { rowCount: 3 });
    const snapshot = await fetchPortalSchema(
      fakeClient({
        onList: () => ({ results: [live] }),
        onGetDraft: () => draft,
      }),
      () => "2026-09-17T00:00:00Z",
    );
    expect(snapshot.tables).toHaveLength(1);
    expect(snapshot.tables[0]?.draftColumns.map((c) => c.name)).toEqual(["slug", "name"]);
    expect(snapshot.tables[0]?.rowCount).toBe(3);
    expect(snapshot.fetchedAt).toBe("2026-09-17T00:00:00Z");
  });

  it("keeps other tables when a per-table draft fetch fails", async () => {
    const ok = table("1", "brands", [col("1", "slug")]);
    const boom = table("2", "products", [col("1", "sku")]);
    const snapshot = await fetchPortalSchema(
      fakeClient({
        onList: () => ({ results: [ok, boom] }),
        onGetDraft: (ref) => {
          if (ref === "2") throw new Error("HTTP 403 forbidden");
          return table(ref, "brands", [col("1", "slug"), col("2", "name")]);
        },
      }),
    );
    expect(snapshot.tables).toHaveLength(2);
    const failed = snapshot.tables.find((t) => t.id === "2");
    expect(failed?.draftFetchError).toBe("HTTP 403 forbidden");
    expect(failed?.draftColumns).toEqual(boom.columns);
    const okOut = snapshot.tables.find((t) => t.id === "1");
    expect(okOut?.draftColumns.map((c) => c.name)).toEqual(["slug", "name"]);
  });

  it("handles the empty-portal case", async () => {
    const snapshot = await fetchPortalSchema(
      fakeClient({ onList: () => ({ results: [] }), onGetDraft: () => { throw new Error("nope"); } }),
    );
    expect(snapshot.tables).toEqual([]);
    expect(snapshot.fetchedAt).toBeTruthy();
  });
});
