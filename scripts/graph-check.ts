import {
  breakCycles,
  GraphCycleError,
  nodesFromHubdbTables,
  nodesFromTableInputs,
  toposort,
  toposortOrThrow,
  type GraphNode,
} from "../lib/graph";
import type { HubdbTable, HubdbTableInput } from "../lib/hubdb";

let passed = 0;
let failed = 0;

function assertEqual<T>(label: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    process.stdout.write(`  ok  ${label}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}\n`);
  }
}

function section(name: string) {
  process.stdout.write(`\n# ${name}\n`);
}

section("linear DAG A → B → C (deps come first)");
{
  const nodes: GraphNode[] = [
    { name: "C", dependencies: ["B"] },
    { name: "B", dependencies: ["A"] },
    { name: "A", dependencies: [] },
  ];
  const { order, cycles } = toposort(nodes);
  assertEqual("order", order, ["A", "B", "C"]);
  assertEqual("cycles", cycles, []);
}

section("brands/categories/products (spike scenario)");
{
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
  const nodes = nodesFromTableInputs(inputs);
  assertEqual("nodes", nodes, [
    { name: "products", dependencies: ["brands", "categories"] },
    { name: "brands", dependencies: [] },
    { name: "categories", dependencies: [] },
  ]);
  const order = toposortOrThrow(nodes);
  assertEqual("order (brands+categories before products)", order.at(-1), "products");
  assertEqual("brands present", order.includes("brands"), true);
  assertEqual("categories present", order.includes("categories"), true);
}

section("self-loop");
{
  const nodes: GraphNode[] = [{ name: "A", dependencies: ["A"] }];
  const { order, cycles } = toposort(nodes);
  assertEqual("order excludes cycle", order, []);
  assertEqual("cycles", cycles, [["A"]]);
}

section("2-node cycle A ↔ B");
{
  const nodes: GraphNode[] = [
    { name: "A", dependencies: ["B"] },
    { name: "B", dependencies: ["A"] },
  ];
  const { order, cycles } = toposort(nodes);
  assertEqual("order excludes cycle", order, []);
  assertEqual("cycles", cycles, [["A", "B"]]);
}

section("3-node cycle A → B → C → A with dangling D → A");
{
  const nodes: GraphNode[] = [
    { name: "A", dependencies: ["C"] },
    { name: "B", dependencies: ["A"] },
    { name: "C", dependencies: ["B"] },
    { name: "D", dependencies: ["A"] },
  ];
  const { order, cycles } = toposort(nodes);
  assertEqual("D still emitted (not in cycle, no non-cyclic deps)", order, ["D"]);
  assertEqual("cycles", cycles, [["A", "B", "C"]]);
}

section("toposortOrThrow raises GraphCycleError with cycle payload");
{
  const nodes: GraphNode[] = [
    { name: "A", dependencies: ["B"] },
    { name: "B", dependencies: ["A"] },
  ];
  let caught: unknown = null;
  try {
    toposortOrThrow(nodes);
  } catch (err) {
    caught = err;
  }
  assertEqual("threw GraphCycleError", caught instanceof GraphCycleError, true);
  if (caught instanceof GraphCycleError) {
    assertEqual("cycles on error", caught.cycles, [["A", "B"]]);
  }
}

section("breakCycles defers cycle-internal edges, orders the rest");
{
  const nodes: GraphNode[] = [
    { name: "A", dependencies: ["C"] },
    { name: "B", dependencies: ["A"] },
    { name: "C", dependencies: ["B"] },
    { name: "D", dependencies: ["A"] },
  ];
  const { order, deferred, cycles } = breakCycles(nodes);
  assertEqual("cycles", cycles, [["A", "B", "C"]]);
  assertEqual("deferred edges (all internal to SCC)", deferred.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)), [
    { from: "A", to: "C" },
    { from: "B", to: "A" },
    { from: "C", to: "B" },
  ]);
  assertEqual("D comes after A in order", order.indexOf("D") > order.indexOf("A"), true);
  assertEqual("A, B, C, D all in order", order.slice().sort(), ["A", "B", "C", "D"]);
}

section("breakCycles on self-loop defers the self-edge");
{
  const nodes: GraphNode[] = [{ name: "A", dependencies: ["A"] }];
  const { order, deferred, cycles } = breakCycles(nodes);
  assertEqual("order", order, ["A"]);
  assertEqual("deferred", deferred, [{ from: "A", to: "A" }]);
  assertEqual("cycles", cycles, [["A"]]);
}

section("disjoint components preserve input order at ties");
{
  const nodes: GraphNode[] = [
    { name: "X", dependencies: [] },
    { name: "Y", dependencies: [] },
    { name: "Z", dependencies: ["Y"] },
  ];
  const order = toposortOrThrow(nodes);
  assertEqual("order (X before Y; Y before Z)", order, ["X", "Y", "Z"]);
}

section("nodesFromTableInputs ignores non-FOREIGN_ID columns and unknown targets");
{
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
  const nodes = nodesFromTableInputs(inputs);
  assertEqual("deps", nodes, [
    { name: "products", dependencies: ["brands"] },
    { name: "brands", dependencies: [] },
  ]);
}

section("nodesFromHubdbTables resolves foreignTableId to names");
{
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
  const nodes = nodesFromHubdbTables(tables);
  assertEqual("deps", nodes, [
    { name: "brands", dependencies: [] },
    { name: "products", dependencies: ["brands"] },
  ]);
}

section("duplicate node names throw");
{
  const nodes: GraphNode[] = [
    { name: "A", dependencies: [] },
    { name: "A", dependencies: [] },
  ];
  let caught: unknown = null;
  try {
    toposort(nodes);
  } catch (err) {
    caught = err;
  }
  assertEqual("threw", caught instanceof Error, true);
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
