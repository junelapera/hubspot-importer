import { describe, expect, it } from "vitest";
import {
  breakCycles,
  GraphCycleError,
  nodesFromHubdbTables,
  nodesFromTableInputs,
  toposort,
  toposortOrThrow,
  type GraphEdge,
  type GraphNode,
} from "./graph";
import type { HubdbTable, HubdbTableInput } from "./hubdb";

const sortEdges = (edges: GraphEdge[]) =>
  [...edges].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

describe("toposort", () => {
  it("orders a linear DAG with prerequisites first", () => {
    const nodes: GraphNode[] = [
      { name: "C", dependencies: ["B"] },
      { name: "B", dependencies: ["A"] },
      { name: "A", dependencies: [] },
    ];
    expect(toposort(nodes)).toEqual({ order: ["A", "B", "C"], cycles: [] });
  });

  it("orders brands/categories before products (spike scenario)", () => {
    const inputs: HubdbTableInput[] = [
      {
        name: "products",
        label: "Products",
        columns: [
          { name: "sku", type: "TEXT" },
          { name: "brand", type: "FOREIGN_ID", foreignTableName: "brands", foreignColumnName: "name" },
          { name: "category", type: "FOREIGN_ID", foreignTableName: "categories", foreignColumnName: "name" },
        ],
      },
      { name: "brands", label: "Brands", columns: [{ name: "name", type: "TEXT" }] },
      { name: "categories", label: "Categories", columns: [{ name: "name", type: "TEXT" }] },
    ];
    const order = toposortOrThrow(nodesFromTableInputs(inputs));
    expect(order).toContain("brands");
    expect(order).toContain("categories");
    expect(order.at(-1)).toBe("products");
  });

  it("excludes a self-loop node from the order and reports the SCC", () => {
    const nodes: GraphNode[] = [{ name: "A", dependencies: ["A"] }];
    expect(toposort(nodes)).toEqual({ order: [], cycles: [["A"]] });
  });

  it("excludes both nodes of a 2-node cycle", () => {
    const nodes: GraphNode[] = [
      { name: "A", dependencies: ["B"] },
      { name: "B", dependencies: ["A"] },
    ];
    expect(toposort(nodes)).toEqual({ order: [], cycles: [["A", "B"]] });
  });

  it("emits non-cycle dependents of a cycle (D depends on cyclic A)", () => {
    const nodes: GraphNode[] = [
      { name: "A", dependencies: ["C"] },
      { name: "B", dependencies: ["A"] },
      { name: "C", dependencies: ["B"] },
      { name: "D", dependencies: ["A"] },
    ];
    expect(toposort(nodes)).toEqual({ order: ["D"], cycles: [["A", "B", "C"]] });
  });

  it("respects input order at ties in disjoint components", () => {
    const nodes: GraphNode[] = [
      { name: "X", dependencies: [] },
      { name: "Y", dependencies: [] },
      { name: "Z", dependencies: ["Y"] },
    ];
    expect(toposortOrThrow(nodes)).toEqual(["X", "Y", "Z"]);
  });

  it("throws on duplicate node names", () => {
    const nodes: GraphNode[] = [
      { name: "A", dependencies: [] },
      { name: "A", dependencies: [] },
    ];
    expect(() => toposort(nodes)).toThrow(/Duplicate node/);
  });
});

describe("toposortOrThrow", () => {
  it("throws GraphCycleError with the cycles payload", () => {
    const nodes: GraphNode[] = [
      { name: "A", dependencies: ["B"] },
      { name: "B", dependencies: ["A"] },
    ];
    try {
      toposortOrThrow(nodes);
      expect.fail("expected GraphCycleError");
    } catch (err) {
      expect(err).toBeInstanceOf(GraphCycleError);
      expect((err as GraphCycleError).cycles).toEqual([["A", "B"]]);
    }
  });
});

describe("breakCycles", () => {
  it("defers cycle-internal edges and orders the rest", () => {
    const nodes: GraphNode[] = [
      { name: "A", dependencies: ["C"] },
      { name: "B", dependencies: ["A"] },
      { name: "C", dependencies: ["B"] },
      { name: "D", dependencies: ["A"] },
    ];
    const { order, deferred, cycles } = breakCycles(nodes);
    expect(cycles).toEqual([["A", "B", "C"]]);
    expect(sortEdges(deferred)).toEqual([
      { from: "A", to: "C" },
      { from: "B", to: "A" },
      { from: "C", to: "B" },
    ]);
    expect([...order].sort()).toEqual(["A", "B", "C", "D"]);
    expect(order.indexOf("D")).toBeGreaterThan(order.indexOf("A"));
  });

  it("defers a self-edge and still emits the node", () => {
    const nodes: GraphNode[] = [{ name: "A", dependencies: ["A"] }];
    expect(breakCycles(nodes)).toEqual({
      order: ["A"],
      deferred: [{ from: "A", to: "A" }],
      cycles: [["A"]],
    });
  });
});

describe("nodesFromTableInputs", () => {
  it("ignores non-FOREIGN_ID columns and unknown FK targets", () => {
    const inputs: HubdbTableInput[] = [
      {
        name: "products",
        label: "P",
        columns: [
          { name: "text", type: "TEXT" },
          { name: "brand", type: "FOREIGN_ID", foreignTableName: "brands" },
          { name: "external", type: "FOREIGN_ID", foreignTableName: "not_in_input" },
        ],
      },
      { name: "brands", label: "B", columns: [{ name: "name", type: "TEXT" }] },
    ];
    expect(nodesFromTableInputs(inputs)).toEqual([
      { name: "products", dependencies: ["brands"] },
      { name: "brands", dependencies: [] },
    ]);
  });
});

describe("nodesFromHubdbTables", () => {
  it("resolves foreignTableId to names and drops unknown ids", () => {
    const tables: HubdbTable[] = [
      {
        id: "1",
        name: "brands",
        label: "B",
        published: true,
        columns: [{ id: "1", name: "name", type: "TEXT" }],
      },
      {
        id: "2",
        name: "products",
        label: "P",
        published: true,
        columns: [
          { id: "1", name: "sku", type: "TEXT" },
          { id: "2", name: "brand", type: "FOREIGN_ID", foreignTableId: "1", foreignColumnId: "1" },
          { id: "3", name: "stray", type: "FOREIGN_ID", foreignTableId: "999" },
        ],
      },
    ];
    expect(nodesFromHubdbTables(tables)).toEqual([
      { name: "brands", dependencies: [] },
      { name: "products", dependencies: ["brands"] },
    ]);
  });
});
