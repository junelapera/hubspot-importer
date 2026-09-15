import type { HubdbTable, HubdbTableInput } from "./hubdb";

export type GraphNode = {
  name: string;
  dependencies: readonly string[];
};

export type GraphEdge = {
  from: string;
  to: string;
};

export type ToposortResult = {
  order: string[];
  cycles: string[][];
};

export type CycleBreakResult = {
  order: string[];
  deferred: GraphEdge[];
  cycles: string[][];
};

export class GraphCycleError extends Error {
  readonly cycles: string[][];
  constructor(cycles: string[][]) {
    super(`Dependency cycle detected: ${cycles.map((c) => c.join(" -> ")).join("; ")}`);
    this.name = "GraphCycleError";
    this.cycles = cycles;
  }
}

type Normalized = {
  names: string[];
  index: Map<string, number>;
  adj: number[][];
};

function normalize(nodes: readonly GraphNode[]): Normalized {
  const names: string[] = [];
  const index = new Map<string, number>();
  for (const n of nodes) {
    if (index.has(n.name)) {
      throw new Error(`Duplicate node: ${n.name}`);
    }
    index.set(n.name, names.length);
    names.push(n.name);
  }
  const adj: number[][] = names.map(() => []);
  for (const n of nodes) {
    const dependent = index.get(n.name) as number;
    for (const dep of n.dependencies) {
      const prereq = index.get(dep);
      if (prereq === undefined) continue;
      adj[prereq].push(dependent);
    }
  }
  return { names, index, adj };
}

function stronglyConnectedComponents(g: Normalized): number[][] {
  const n = g.names.length;
  const indices = new Array<number>(n).fill(-1);
  const lowlink = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const components: number[][] = [];
  let idx = 0;

  type Frame = { node: number; iter: number };
  for (let start = 0; start < n; start++) {
    if (indices[start] !== -1) continue;
    const frames: Frame[] = [{ node: start, iter: 0 }];
    indices[start] = idx;
    lowlink[start] = idx;
    idx++;
    stack.push(start);
    onStack[start] = true;

    while (frames.length) {
      const frame = frames[frames.length - 1];
      const v = frame.node;
      const neighbors = g.adj[v];
      if (frame.iter < neighbors.length) {
        const w = neighbors[frame.iter++];
        if (indices[w] === -1) {
          indices[w] = idx;
          lowlink[w] = idx;
          idx++;
          stack.push(w);
          onStack[w] = true;
          frames.push({ node: w, iter: 0 });
        } else if (onStack[w]) {
          if (indices[w] < lowlink[v]) lowlink[v] = indices[w];
        }
        continue;
      }

      if (lowlink[v] === indices[v]) {
        const comp: number[] = [];
        while (true) {
          const w = stack.pop() as number;
          onStack[w] = false;
          comp.push(w);
          if (w === v) break;
        }
        comp.sort((a, b) => a - b);
        components.push(comp);
      }
      frames.pop();
      if (frames.length) {
        const parent = frames[frames.length - 1].node;
        if (lowlink[v] < lowlink[parent]) lowlink[parent] = lowlink[v];
      }
    }
  }
  return components;
}

function findCycles(g: Normalized, components: number[][]): number[][] {
  const cycles: number[][] = [];
  for (const comp of components) {
    if (comp.length > 1) {
      cycles.push(comp);
      continue;
    }
    const v = comp[0];
    if (g.adj[v].includes(v)) cycles.push(comp);
  }
  return cycles;
}

function edgeKey(from: number, to: number): string {
  return `${from}|${to}`;
}

function kahnOrder(g: Normalized, blocked: (from: number, to: number) => boolean): number[] {
  const n = g.names.length;
  const indeg = new Array<number>(n).fill(0);
  for (let v = 0; v < n; v++) {
    for (const w of g.adj[v]) {
      if (blocked(v, w)) continue;
      indeg[w]++;
    }
  }
  const queue: number[] = [];
  for (let v = 0; v < n; v++) if (indeg[v] === 0) queue.push(v);
  const order: number[] = [];
  let head = 0;
  while (head < queue.length) {
    const v = queue[head++];
    order.push(v);
    for (const w of g.adj[v]) {
      if (blocked(v, w)) continue;
      if (--indeg[w] === 0) queue.push(w);
    }
  }
  return order;
}

export function toposort(nodes: readonly GraphNode[]): ToposortResult {
  const g = normalize(nodes);
  const sccs = stronglyConnectedComponents(g);
  const cycleIndexes = findCycles(g, sccs);
  const inCycle = new Set<number>();
  for (const comp of cycleIndexes) for (const v of comp) inCycle.add(v);

  const order = kahnOrder(g, (from, to) => inCycle.has(from) || inCycle.has(to));
  return {
    order: order.filter((i) => !inCycle.has(i)).map((i) => g.names[i]),
    cycles: cycleIndexes.map((comp) => comp.map((i) => g.names[i])),
  };
}

export function toposortOrThrow(nodes: readonly GraphNode[]): string[] {
  const { order, cycles } = toposort(nodes);
  if (cycles.length) throw new GraphCycleError(cycles);
  return order;
}

export function breakCycles(nodes: readonly GraphNode[]): CycleBreakResult {
  const g = normalize(nodes);
  const sccs = stronglyConnectedComponents(g);
  const cycleIndexes = findCycles(g, sccs);

  const componentOf = new Array<number>(g.names.length).fill(-1);
  for (let i = 0; i < sccs.length; i++) {
    for (const v of sccs[i]) componentOf[v] = i;
  }
  const cyclicComponent = new Set<number>();
  for (const comp of cycleIndexes) cyclicComponent.add(componentOf[comp[0]]);

  const deferred: GraphEdge[] = [];
  const deferredEdges = new Set<string>();
  for (let v = 0; v < g.names.length; v++) {
    for (const w of g.adj[v]) {
      if (componentOf[v] === componentOf[w] && cyclicComponent.has(componentOf[v])) {
        deferred.push({ from: g.names[w], to: g.names[v] });
        deferredEdges.add(edgeKey(v, w));
      }
    }
  }

  const order = kahnOrder(g, (from, to) => deferredEdges.has(edgeKey(from, to)));

  return {
    order: order.map((i) => g.names[i]),
    deferred,
    cycles: cycleIndexes.map((comp) => comp.map((i) => g.names[i])),
  };
}

export function nodesFromTableInputs(inputs: readonly HubdbTableInput[]): GraphNode[] {
  const knownNames = new Set(inputs.map((t) => t.name));
  return inputs.map((t) => {
    const deps = new Set<string>();
    for (const col of t.columns) {
      if (col.type !== "FOREIGN_ID") continue;
      const dep = col.foreignTableName;
      if (dep && dep !== t.name && knownNames.has(dep)) {
        deps.add(dep);
      }
    }
    return { name: t.name, dependencies: [...deps] };
  });
}

export function nodesFromHubdbTables(tables: readonly HubdbTable[]): GraphNode[] {
  const byId = new Map(tables.map((t) => [t.id, t.name] as const));
  return tables.map((t) => {
    const deps = new Set<string>();
    for (const col of t.columns) {
      if (col.type !== "FOREIGN_ID" || !col.foreignTableId) continue;
      const depName = byId.get(col.foreignTableId);
      if (depName && depName !== t.name) deps.add(depName);
    }
    return { name: t.name, dependencies: [...deps] };
  });
}
