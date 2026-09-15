import { describe, expect, it } from "vitest";
import type { DiffPlan } from "../schema";
import { diffSchema, parseSchema } from "../schema";
import {
  provision,
  ProvisionConflictError,
  type ProvisionEvent,
  type ProvisionOps,
} from "./provision";
import type { HubdbColumn, HubdbTable, HubdbTableInput, HubdbTablePatch } from "./types";

type FakeOps = ProvisionOps & {
  createCalls: { input: HubdbTableInput }[];
  patchCalls: { ref: string; patch: HubdbTablePatch }[];
  tables: Map<string, HubdbTable>;
};

function fakeOps(preExisting: HubdbTable[] = []): FakeOps {
  const tables = new Map<string, HubdbTable>();
  for (const t of preExisting) tables.set(t.id, t);
  const createCalls: FakeOps["createCalls"] = [];
  const patchCalls: FakeOps["patchCalls"] = [];
  let nextId = 100;
  return {
    createCalls,
    patchCalls,
    tables,
    async createTable(input) {
      const id = String(nextId++);
      const table: HubdbTable = {
        id,
        name: input.name,
        label: input.label,
        published: false,
        columns: input.columns.map((c, i) => columnInputToPortal(c, i + 1)),
      };
      tables.set(id, table);
      createCalls.push({ input });
      return table;
    },
    async patchTable(ref, patch) {
      const id = String(ref);
      const existing = tables.get(id);
      if (!existing) throw new Error(`fake patchTable: unknown ref ${id}`);
      patchCalls.push({ ref: id, patch });
      const nextColumns = patch.columns
        ? patch.columns.map((c, i) => columnInputToPortal(c, existing.columns.length + i + 1))
        : existing.columns;
      const updated: HubdbTable = {
        ...existing,
        ...(patch.label ? { label: patch.label } : {}),
        columns: nextColumns,
      };
      tables.set(id, updated);
      return updated;
    },
  };
}

function columnInputToPortal(
  input: {
    id?: string;
    name: string;
    type: string;
    label?: string;
    foreignTableId?: string;
    foreignColumnId?: string;
    foreignTableName?: string;
    foreignColumnName?: string;
  },
  fallbackId: number,
): HubdbColumn {
  const fkTableId =
    input.foreignTableId ??
    (input.foreignTableName ? `resolved-${input.foreignTableName}` : undefined);
  const fkColumnId =
    input.foreignColumnId ?? (input.foreignColumnName ? "1" : undefined);
  return {
    id: input.id ?? String(fallbackId),
    name: input.name,
    type: input.type,
    label: input.label,
    foreignTableId: fkTableId,
    foreignColumnId: fkColumnId,
  };
}

function planFromSchema(rawSchema: unknown, portal: HubdbTable[] = []): DiffPlan {
  return diffSchema(parseSchema(rawSchema), portal);
}

const BRANDS_PRODUCTS = {
  version: 1,
  tables: [
    {
      name: "brands",
      label: "Brands",
      naturalKey: "slug",
      columns: [
        { name: "name", type: "TEXT" },
        { name: "slug", type: "TEXT" },
      ],
    },
    {
      name: "products",
      label: "Products",
      naturalKey: "sku",
      columns: [
        { name: "sku", type: "TEXT" },
        { name: "title", type: "TEXT" },
        { name: "brand", type: "FOREIGN_ID", foreignTable: "brands" },
      ],
    },
  ],
};

describe("provision", () => {
  it("creates all-new tables in topological order and returns portal ids", async () => {
    const ops = fakeOps();
    const plan = planFromSchema(BRANDS_PRODUCTS);
    const events: ProvisionEvent[] = [];
    const result = await provision(ops, plan, { onEvent: (e) => events.push(e) });

    expect(ops.createCalls.map((c) => c.input.name)).toEqual(["brands", "products"]);
    expect(ops.patchCalls).toHaveLength(0);
    expect(result.order).toEqual(["brands", "products"]);
    expect(result.deferred).toEqual([]);
    expect(result.tableIds).toEqual({ brands: "100", products: "101" });

    const productsCreate = ops.createCalls.find((c) => c.input.name === "products");
    const brandCol = productsCreate?.input.columns.find((c) => c.name === "brand");
    expect(brandCol?.foreignTableName).toBe("brands");
    expect(brandCol?.foreignColumnName).toBe("slug");

    expect(events.map((e) => e.kind)).toEqual([
      "create-start",
      "create-done",
      "create-start",
      "create-done",
    ]);
  });

  it("PATCHes existing tables that need new columns and skips matches", async () => {
    const portalBrands: HubdbTable = {
      id: "10",
      name: "brands",
      label: "Brands",
      published: true,
      columns: [
        { id: "1", name: "name", type: "TEXT" },
        { id: "2", name: "slug", type: "TEXT" },
      ],
    };
    const portalProducts: HubdbTable = {
      id: "20",
      name: "products",
      label: "Products",
      published: true,
      columns: [{ id: "1", name: "sku", type: "TEXT" }],
    };
    const ops = fakeOps([portalBrands, portalProducts]);
    const plan = planFromSchema(BRANDS_PRODUCTS, [portalBrands, portalProducts]);

    const result = await provision(ops, plan);
    expect(ops.createCalls).toHaveLength(0);
    expect(ops.patchCalls).toHaveLength(1);
    expect(ops.patchCalls[0].ref).toBe("20");
    const patchedNames = ops.patchCalls[0].patch.columns?.map((c) => c.name);
    expect(patchedNames).toEqual(["sku", "title", "brand"]);
    expect(result.tableIds).toEqual({ brands: "10", products: "20" });
  });

  it("does not emit a PATCH when an update has zero addColumns (nothing to do)", async () => {
    const portal: HubdbTable = {
      id: "10",
      name: "brands",
      label: "Brands",
      published: true,
      columns: [
        { id: "1", name: "name", type: "TEXT" },
        { id: "2", name: "slug", type: "TEXT" },
      ],
    };
    const ops = fakeOps([portal]);
    const plan = planFromSchema(
      { version: 1, tables: [BRANDS_PRODUCTS.tables[0]] },
      [portal],
    );
    await provision(ops, plan);
    expect(ops.patchCalls).toHaveLength(0);
    expect(ops.createCalls).toHaveLength(0);
  });

  it("breaks a self-loop by creating without the FK column, then PATCHing it in", async () => {
    const selfRef = {
      version: 1,
      tables: [
        {
          name: "categories",
          label: "Categories",
          naturalKey: "slug",
          columns: [
            { name: "name", type: "TEXT" },
            { name: "slug", type: "TEXT" },
            { name: "parent", type: "FOREIGN_ID", foreignTable: "categories" },
          ],
        },
      ],
    };
    const ops = fakeOps();
    const plan = planFromSchema(selfRef);
    const result = await provision(ops, plan);

    expect(ops.createCalls).toHaveLength(1);
    const createdCols = ops.createCalls[0].input.columns.map((c) => c.name);
    expect(createdCols).toEqual(["name", "slug"]);

    expect(ops.patchCalls).toHaveLength(1);
    const patchCols = ops.patchCalls[0].patch.columns?.map((c) => c.name);
    expect(patchCols).toEqual(["name", "slug", "parent"]);
    expect(result.deferred).toEqual([{ from: "categories", to: "categories" }]);
  });

  it("breaks a 2-node cycle with column-less creates and follow-up PATCHes", async () => {
    const cyclic = {
      version: 1,
      tables: [
        {
          name: "left",
          label: "Left",
          columns: [
            { name: "id", type: "TEXT" },
            { name: "right_ref", type: "FOREIGN_ID", foreignTable: "right", foreignColumn: "id" },
          ],
        },
        {
          name: "right",
          label: "Right",
          columns: [
            { name: "id", type: "TEXT" },
            { name: "left_ref", type: "FOREIGN_ID", foreignTable: "left", foreignColumn: "id" },
          ],
        },
      ],
    };
    const ops = fakeOps();
    const plan = planFromSchema(cyclic);
    const result = await provision(ops, plan);

    expect(ops.createCalls).toHaveLength(2);
    expect(ops.createCalls[0].input.columns.map((c) => c.name)).toEqual(["id"]);
    expect(ops.createCalls[1].input.columns.map((c) => c.name)).toEqual(["id"]);
    expect(ops.patchCalls).toHaveLength(2);
    expect(result.deferred).toHaveLength(2);
  });

  it("throws ProvisionConflictError when the plan has any conflict", async () => {
    const portal: HubdbTable = {
      id: "10",
      name: "brands",
      label: "Brands",
      published: true,
      columns: [
        { id: "1", name: "name", type: "TEXT" },
        { id: "2", name: "slug", type: "RICHTEXT" },
      ],
    };
    const ops = fakeOps([portal]);
    const plan = planFromSchema({ version: 1, tables: [BRANDS_PRODUCTS.tables[0]] }, [portal]);
    await expect(provision(ops, plan)).rejects.toBeInstanceOf(ProvisionConflictError);
    expect(ops.createCalls).toHaveLength(0);
    expect(ops.patchCalls).toHaveLength(0);
  });

  it("emits defer-patch events in the two-phase run", async () => {
    const selfRef = {
      version: 1,
      tables: [
        {
          name: "categories",
          label: "Categories",
          naturalKey: "slug",
          columns: [
            { name: "name", type: "TEXT" },
            { name: "slug", type: "TEXT" },
            { name: "parent", type: "FOREIGN_ID", foreignTable: "categories" },
          ],
        },
      ],
    };
    const ops = fakeOps();
    const plan = planFromSchema(selfRef);
    const events: ProvisionEvent[] = [];
    await provision(ops, plan, { onEvent: (e) => events.push(e) });
    expect(events.map((e) => e.kind)).toEqual([
      "create-start",
      "create-done",
      "defer-patch-start",
      "defer-patch-done",
    ]);
  });
});

