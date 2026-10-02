"use client";

// Phase A spike of docs/mapping-canvas.md — ERD-like relationship editor
// backed by the existing MappingState. Scope: render nodes + FK edges,
// drag-to-connect creates FKs, double-click to delete, fullscreen toggle.
// Click-to-edit edge config, cross-session position persistence, node
// palette, mini-map are all follow-up spikes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeTypes,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2, Minimize2, Star } from "lucide-react";
import type { HubdbTable } from "@/lib/hubdb";
import {
  initialMappingState,
  type ForeignKeyConfig,
  type MappingState,
} from "@/lib/mapping";
import type { SourceTable } from "./mapping-editor";
import { Button } from "@/components/ui/button";

const NODE_WIDTH = 260;

type TableColumnRow = {
  name: string;
  mappedTarget: string | null;
  isNaturalKey: boolean;
  hasFk: boolean;
};

type TableNodeData = {
  tableName: string;
  targetName: string | null;
  columns: TableColumnRow[];
};

function TableNode({ data }: { data: TableNodeData }) {
  return (
    <div
      className="rounded-md border border-border bg-background text-xs shadow-sm"
      style={{ width: NODE_WIDTH }}
    >
      <header className="rounded-t-md border-b border-border bg-muted/60 px-3 py-2">
        <div className="font-semibold">{data.tableName}</div>
        {data.targetName ? (
          <div className="text-muted-foreground">→ {data.targetName}</div>
        ) : (
          <div className="italic text-muted-foreground">no target picked</div>
        )}
      </header>
      <ul className="divide-y divide-border">
        {data.columns.map((c) => (
          <li
            key={c.name}
            className="relative flex items-center justify-between gap-2 px-3 py-1.5"
          >
            <Handle
              type="target"
              position={Position.Left}
              id={c.name}
              className="!h-2 !w-2 !border-background !bg-muted-foreground"
            />
            <span className="flex min-w-0 items-center gap-1">
              {c.isNaturalKey ? (
                <Star
                  aria-label="natural key"
                  className="size-3 shrink-0 fill-primary stroke-primary"
                />
              ) : null}
              <span className="truncate">{c.name}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
              {c.mappedTarget && c.mappedTarget !== c.name ? (
                <span className="truncate">→ {c.mappedTarget}</span>
              ) : null}
              {c.hasFk ? (
                <span className="rounded bg-primary/10 px-1 py-0.5 font-medium text-primary">
                  FK
                </span>
              ) : null}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={c.name}
              className="!h-2 !w-2 !border-background !bg-muted-foreground"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

const nodeTypes: NodeTypes = { table: TableNode };

function defaultPosition(i: number) {
  return { x: (i % 3) * 320, y: Math.floor(i / 3) * 320 };
}

function buildNodeData(
  src: SourceTable,
  mapping: MappingState | undefined,
): TableNodeData {
  return {
    tableName: src.name,
    targetName: mapping?.targetTableName ?? null,
    columns: src.headers.map((h) => {
      const assignment = mapping?.columnMap[h];
      return {
        name: h,
        mappedTarget: assignment?.kind === "mapped" ? assignment.targetColumn : null,
        isNaturalKey: mapping?.naturalKey.includes(h) ?? false,
        hasFk: Boolean(mapping?.foreignKeys[h]?.sourceTable),
      };
    }),
  };
}

export function MappingCanvas(props: {
  allSources: SourceTable[];
  portalTables: HubdbTable[];
  mappings: Record<string, MappingState>;
  onMappingChange: (source: string, next: MappingState) => void;
}) {
  // ReactFlowProvider is required for useReactFlow() in the inner component.
  return (
    <ReactFlowProvider>
      <MappingCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function MappingCanvasInner({
  allSources,
  // portalTables kept for the follow-up spike (rendering target tables as
  // separate nodes). Current source-only view doesn't consume it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  portalTables,
  mappings,
  onMappingChange,
}: {
  allSources: SourceTable[];
  portalTables: HubdbTable[];
  mappings: Record<string, MappingState>;
  onMappingChange: (source: string, next: MappingState) => void;
}) {
  // React Flow owns the nodes array (positions + selection + dragging). We
  // sync *data* into it when `allSources`/`mappings` change, but we never
  // overwrite `position` after the initial seed — otherwise the drag event
  // and the external re-render fight each other and the node flickers.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>([]);

  // One-way sync from external data → React Flow's internal node state.
  // Merge semantics: existing nodes keep their position + any RF-managed
  // flags; new sources get the default grid position; removed sources drop.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      return allSources.map((src, i) => {
        const existing = byId.get(src.name);
        return {
          id: src.name,
          type: "table",
          position: existing?.position ?? defaultPosition(i),
          data: buildNodeData(src, mappings[src.name]),
          // Preserve selection/drag flags across data changes.
          selected: existing?.selected,
          dragging: existing?.dragging,
        };
      });
    });
  }, [allSources, mappings, setNodes]);

  const edges: Edge[] = useMemo(() => {
    const result: Edge[] = [];
    for (const [sourceName, mapping] of Object.entries(mappings)) {
      for (const [sourceCol, fk] of Object.entries(mapping.foreignKeys)) {
        if (!fk.sourceTable || !fk.matchKey) continue;
        result.push({
          id: `${sourceName}:${sourceCol}->${fk.sourceTable}:${fk.matchKey}`,
          source: sourceName,
          sourceHandle: sourceCol,
          target: fk.sourceTable,
          targetHandle: fk.matchKey,
          animated: fk.multi,
          label: fk.multi ? `multi (${fk.delimiter})` : undefined,
          labelStyle: { fontSize: 10 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: { strokeWidth: 1.5 },
        });
      }
    }
    return result;
  }, [mappings]);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return;
      const existing = mappings[params.source] ?? initialMappingState();
      const prevFk = existing.foreignKeys[params.sourceHandle];
      const nextFk: ForeignKeyConfig = prevFk
        ? { ...prevFk, sourceTable: params.target, matchKey: params.targetHandle }
        : {
            sourceTable: params.target,
            matchKey: params.targetHandle,
            multi: false,
            delimiter: ",",
            onMissing: "null",
            matching: "default",
          };
      onMappingChange(params.source, {
        ...existing,
        foreignKeys: {
          ...existing.foreignKeys,
          [params.sourceHandle]: nextFk,
        },
      });
    },
    [mappings, onMappingChange],
  );

  const deleteEdges = useCallback(
    (toDelete: Edge[]) => {
      const bySource = new Map<string, Set<string>>();
      for (const e of toDelete) {
        if (!e.source || !e.sourceHandle) continue;
        const set = bySource.get(e.source) ?? new Set<string>();
        set.add(e.sourceHandle);
        bySource.set(e.source, set);
      }
      for (const [sourceName, cols] of bySource) {
        const existing = mappings[sourceName];
        if (!existing) continue;
        const nextFks = { ...existing.foreignKeys };
        for (const col of cols) delete nextFks[col];
        onMappingChange(sourceName, { ...existing, foreignKeys: nextFks });
      }
    },
    [mappings, onMappingChange],
  );

  const onEdgeDoubleClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      deleteEdges([edge]);
    },
    [deleteEdges],
  );

  // Fullscreen — uses the native Fullscreen API on the canvas container.
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { fitView } = useReactFlow();

  useEffect(() => {
    function onFsChange() {
      const now = Boolean(document.fullscreenElement);
      setIsFullscreen(now);
      // Re-fit after the viewport dimensions change so no node ends up offscreen.
      // The RAF defers past the layout flush — fitView before layout is a no-op.
      requestAnimationFrame(() => fitView({ padding: 0.1 }));
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [fitView]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Browser denied the request (e.g., not triggered by user gesture).
      // Fail quiet — fullscreen is a nice-to-have.
    }
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          Drag a card to move it · drag between column dots to create an FK ·{" "}
          <strong>double-click</strong> a connection to delete it (or select it and press{" "}
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">Delete</kbd>)
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          className="shrink-0 gap-1.5"
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="size-3.5" />
              Exit fullscreen
            </>
          ) : (
            <>
              <Maximize2 className="size-3.5" />
              Fullscreen
            </>
          )}
        </Button>
      </div>
      <div
        ref={containerRef}
        className={
          "overflow-hidden rounded-md border border-border bg-background " +
          (isFullscreen ? "h-screen w-screen rounded-none border-0" : "h-[600px]")
        }
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onEdgesDelete={deleteEdges}
          onEdgeDoubleClick={onEdgeDoubleClick}
          deleteKeyCode={["Delete", "Backspace"]}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
