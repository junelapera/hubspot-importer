import { describe, expect, it } from "vitest";
import {
  diffSchema,
  parseSchema,
  resolveDefaults,
  SchemaValidationError,
  type Schema,
} from "./schema";
import type { HubdbTable } from "./hubdb";

const validSchema = {
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

describe("parseSchema", () => {
  it("parses a valid schema and resolves foreignColumn from target's naturalKey", () => {
    const schema = parseSchema(validSchema);
    const brand = schema.tables[1].columns.find((c) => c.name === "brand");
    expect(brand?.foreignColumn).toBe("slug");
  });

  it("preserves explicit foreignColumn over the naturalKey default", () => {
    const schema = parseSchema({
      ...validSchema,
      tables: [
        validSchema.tables[0],
        {
          ...validSchema.tables[1],
          columns: [
            ...validSchema.tables[1].columns.slice(0, 2),
            { name: "brand", type: "FOREIGN_ID", foreignTable: "brands", foreignColumn: "name" },
          ],
        },
      ],
    });
    const brand = schema.tables[1].columns.find((c) => c.name === "brand");
    expect(brand?.foreignColumn).toBe("name");
  });

  it("does not resolve defaults when opts.resolveDefaults is false", () => {
    const schema = parseSchema(validSchema, { resolveDefaults: false });
    const brand = schema.tables[1].columns.find((c) => c.name === "brand");
    expect(brand?.foreignColumn).toBeUndefined();
  });

  it("throws SchemaValidationError on missing version", () => {
    expect(() => parseSchema({ tables: validSchema.tables })).toThrow(SchemaValidationError);
  });

  it("throws on empty tables array", () => {
    expect(() => parseSchema({ version: 1, tables: [] })).toThrow(SchemaValidationError);
  });

  it("throws on duplicate table names", () => {
    const dup = {
      version: 1,
      tables: [validSchema.tables[0], validSchema.tables[0]],
    };
    try {
      parseSchema(dup);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).issues.some((i) => i.includes("Duplicate table"))).toBe(true);
    }
  });

  it("throws on duplicate column names within a table", () => {
    const bad = {
      version: 1,
      tables: [
        {
          name: "brands",
          label: "Brands",
          columns: [
            { name: "name", type: "TEXT" },
            { name: "name", type: "TEXT" },
          ],
        },
      ],
    };
    try {
      parseSchema(bad);
      expect.fail("expected throw");
    } catch (err) {
      expect((err as SchemaValidationError).issues.some((i) => i.includes("duplicate column"))).toBe(true);
    }
  });

  it("throws when FOREIGN_ID references an unknown table", () => {
    const bad = {
      version: 1,
      tables: [
        {
          name: "products",
          label: "P",
          columns: [
            { name: "sku", type: "TEXT" },
            { name: "brand", type: "FOREIGN_ID", foreignTable: "does_not_exist" },
          ],
        },
      ],
    };
    try {
      parseSchema(bad);
      expect.fail("expected throw");
    } catch (err) {
      expect((err as SchemaValidationError).issues.some((i) => i.includes("does_not_exist"))).toBe(true);
    }
  });

  it("throws when FOREIGN_ID column omits foreignTable", () => {
    const bad = {
      version: 1,
      tables: [
        {
          name: "products",
          label: "P",
          columns: [{ name: "brand", type: "FOREIGN_ID" }],
        },
      ],
    };
    expect(() => parseSchema(bad)).toThrow(SchemaValidationError);
  });

  it("throws when FOREIGN_ID foreignColumn is not a column on the target", () => {
    const bad = {
      version: 1,
      tables: [
        { name: "brands", label: "B", columns: [{ name: "name", type: "TEXT" }] },
        {
          name: "products",
          label: "P",
          columns: [
            { name: "sku", type: "TEXT" },
            {
              name: "brand",
              type: "FOREIGN_ID",
              foreignTable: "brands",
              foreignColumn: "nonexistent",
            },
          ],
        },
      ],
    };
    try {
      parseSchema(bad);
      expect.fail("expected throw");
    } catch (err) {
      expect((err as SchemaValidationError).issues.some((i) => i.includes("nonexistent"))).toBe(true);
    }
  });

  it("throws when naturalKey references an undefined column", () => {
    const bad = {
      version: 1,
      tables: [
        {
          name: "brands",
          label: "B",
          naturalKey: "missing_col",
          columns: [{ name: "name", type: "TEXT" }],
        },
      ],
    };
    try {
      parseSchema(bad);
      expect.fail("expected throw");
    } catch (err) {
      expect((err as SchemaValidationError).issues.some((i) => i.includes("naturalKey"))).toBe(true);
    }
  });

  it("accepts a composite naturalKey", () => {
    const schema = parseSchema({
      version: 1,
      tables: [
        {
          name: "brands",
          label: "B",
          naturalKey: ["name", "slug"],
          columns: [
            { name: "name", type: "TEXT" },
            { name: "slug", type: "TEXT" },
          ],
        },
      ],
    });
    expect(schema.tables[0].naturalKey).toEqual(["name", "slug"]);
  });

  it("does not default FK foreignColumn when target has a composite naturalKey", () => {
    const schema = parseSchema({
      version: 1,
      tables: [
        {
          name: "brands",
          label: "B",
          naturalKey: ["name", "slug"],
          columns: [
            { name: "name", type: "TEXT" },
            { name: "slug", type: "TEXT" },
          ],
        },
        {
          name: "products",
          label: "P",
          columns: [{ name: "brand", type: "FOREIGN_ID", foreignTable: "brands" }],
        },
      ],
    });
    const brand = schema.tables[1].columns.find((c) => c.name === "brand");
    expect(brand?.foreignColumn).toBeUndefined();
  });
});

describe("resolveDefaults", () => {
  it("is idempotent", () => {
    const once = resolveDefaults(parseSchema(validSchema, { resolveDefaults: false }));
    const twice = resolveDefaults(once);
    expect(twice).toEqual(once);
  });
});

const parsed = (): Schema => parseSchema(validSchema);

describe("diffSchema", () => {
  it("marks every schema table as create when the portal is empty", () => {
    const plan = diffSchema(parsed(), []);
    expect(plan.ok).toBe(true);
    expect(plan.tables.map((t) => t.action)).toEqual(["create", "create"]);
  });

  it("marks as match when portal columns line up with the schema", () => {
    const schema = parsed();
    const portal: HubdbTable[] = [
      {
        id: "10",
        name: "brands",
        label: "Brands",
        published: true,
        columns: [
          { id: "1", name: "name", type: "TEXT" },
          { id: "2", name: "slug", type: "TEXT" },
        ],
      },
      {
        id: "20",
        name: "products",
        label: "Products",
        published: true,
        columns: [
          { id: "1", name: "sku", type: "TEXT" },
          { id: "2", name: "title", type: "TEXT" },
          {
            id: "3",
            name: "brand",
            type: "FOREIGN_ID",
            foreignTableId: "10",
            foreignColumnId: "2",
          },
        ],
      },
    ];
    const plan = diffSchema(schema, portal);
    expect(plan.ok).toBe(true);
    expect(plan.tables.map((t) => t.action)).toEqual(["match", "match"]);
  });

  it("marks as update and lists missing columns to add", () => {
    const schema = parsed();
    const portal: HubdbTable[] = [
      {
        id: "10",
        name: "brands",
        label: "Brands",
        published: true,
        columns: [{ id: "1", name: "name", type: "TEXT" }],
      },
      {
        id: "20",
        name: "products",
        label: "Products",
        published: true,
        columns: [{ id: "1", name: "sku", type: "TEXT" }],
      },
    ];
    const plan = diffSchema(schema, portal);
    expect(plan.ok).toBe(true);
    const brands = plan.tables[0];
    const products = plan.tables[1];
    if (brands.action !== "update" || products.action !== "update") {
      throw new Error("expected update actions");
    }
    expect(brands.addColumns.map((c) => c.name)).toEqual(["slug"]);
    expect(products.addColumns.map((c) => c.name)).toEqual(["title", "brand"]);
  });

  it("reports column-type-mismatch as a conflict", () => {
    const schema = parsed();
    const portal: HubdbTable[] = [
      {
        id: "10",
        name: "brands",
        label: "Brands",
        published: true,
        columns: [
          { id: "1", name: "name", type: "TEXT" },
          { id: "2", name: "slug", type: "RICHTEXT" },
        ],
      },
    ];
    const plan = diffSchema(schema, portal);
    expect(plan.ok).toBe(false);
    const brands = plan.tables[0];
    if (brands.action !== "conflict") throw new Error("expected conflict");
    expect(brands.conflicts).toEqual([
      {
        kind: "column-type-mismatch",
        table: "brands",
        column: "slug",
        expected: "TEXT",
        actual: "RICHTEXT",
      },
    ]);
  });

  it("reports fk-target-mismatch when FK column points at a different table id", () => {
    const schema = parsed();
    const portal: HubdbTable[] = [
      {
        id: "10",
        name: "brands",
        label: "Brands",
        published: true,
        columns: [
          { id: "1", name: "name", type: "TEXT" },
          { id: "2", name: "slug", type: "TEXT" },
        ],
      },
      {
        id: "20",
        name: "products",
        label: "Products",
        published: true,
        columns: [
          { id: "1", name: "sku", type: "TEXT" },
          { id: "2", name: "title", type: "TEXT" },
          {
            id: "3",
            name: "brand",
            type: "FOREIGN_ID",
            foreignTableId: "999",
            foreignColumnId: "2",
          },
        ],
      },
    ];
    const plan = diffSchema(schema, portal);
    expect(plan.ok).toBe(false);
    const products = plan.tables[1];
    if (products.action !== "conflict") throw new Error("expected conflict");
    expect(products.conflicts[0]).toMatchObject({
      kind: "fk-target-mismatch",
      table: "products",
      column: "brand",
      expectedTable: "brands",
      actualTableId: "999",
    });
  });

  it("reports fk-column-mismatch when FK points at the right table but wrong display column", () => {
    const schema = parsed();
    const portal: HubdbTable[] = [
      {
        id: "10",
        name: "brands",
        label: "Brands",
        published: true,
        columns: [
          { id: "1", name: "name", type: "TEXT" },
          { id: "2", name: "slug", type: "TEXT" },
        ],
      },
      {
        id: "20",
        name: "products",
        label: "Products",
        published: true,
        columns: [
          { id: "1", name: "sku", type: "TEXT" },
          { id: "2", name: "title", type: "TEXT" },
          {
            id: "3",
            name: "brand",
            type: "FOREIGN_ID",
            foreignTableId: "10",
            foreignColumnId: "1",
          },
        ],
      },
    ];
    const plan = diffSchema(schema, portal);
    expect(plan.ok).toBe(false);
    const products = plan.tables[1];
    if (products.action !== "conflict") throw new Error("expected conflict");
    expect(products.conflicts[0]).toMatchObject({
      kind: "fk-column-mismatch",
      expectedColumn: "slug",
      actualColumnId: "1",
    });
  });

  it("ignores extra portal columns not present in the schema", () => {
    const schema = parsed();
    const portal: HubdbTable[] = [
      {
        id: "10",
        name: "brands",
        label: "Brands",
        published: true,
        columns: [
          { id: "1", name: "name", type: "TEXT" },
          { id: "2", name: "slug", type: "TEXT" },
          { id: "3", name: "legacy_note", type: "TEXT" },
        ],
      },
    ];
    const plan = diffSchema(schema, portal);
    const brands = plan.tables[0];
    expect(brands.action).toBe("match");
  });
});
