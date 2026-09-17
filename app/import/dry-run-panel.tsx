"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DryRunReport, DryRunSource, DryRunTableReport, DryRunUnresolvedFk } from "@/lib/dry-run";
import type { MappingState } from "@/lib/mapping";

type Stage =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string }
  | { kind: "done"; report: DryRunReport };

export function DryRunPanel({
  portalId,
  sources,
  mappings,
}: {
  portalId: string;
  sources: DryRunSource[];
  mappings: Record<string, MappingState>;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  async function run() {
    setStage({ kind: "running" });
    try {
      const res = await fetch(`/api/portals/${portalId}/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources, mappings }),
      });
      const body = (await res.json()) as { report?: DryRunReport; error?: string };
      if (!res.ok || !body.report) {
        setStage({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setStage({ kind: "done", report: body.report });
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Dry run</h2>
          <p className="text-xs text-muted-foreground">
            Reports create/update counts, unresolved FKs, coercion warnings, and projected API calls. No writes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {stage.kind === "done" ? (
            <span className={"text-xs " + (stage.report.ok ? "text-emerald-700 dark:text-emerald-300" : "text-yellow-800 dark:text-yellow-200")}>
              {stage.report.ok ? "clean" : "needs review"} · {stage.report.projectedApiCalls} projected API call{stage.report.projectedApiCalls === 1 ? "" : "s"}
            </span>
          ) : null}
          <Button onClick={run} disabled={stage.kind === "running"}>
            {stage.kind === "running" ? "Running…" : stage.kind === "done" ? "Re-run" : "Run dry run"}
          </Button>
        </div>
      </header>

      {stage.kind === "error" ? (
        <p className="text-sm text-destructive">{stage.message}</p>
      ) : null}

      {stage.kind === "done" ? <ReportView report={stage.report} /> : null}
    </section>
  );
}

function ReportView({ report }: { report: DryRunReport }) {
  const unresolved = report.tables.flatMap((t) => t.unresolvedFks);
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {report.tables.map((t) => (
          <li key={t.sourceName}><TableReport table={t} /></li>
        ))}
      </ul>
      {unresolved.length > 0 ? (
        <div className="flex items-center justify-between rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs">
          <span className="text-yellow-800 dark:text-yellow-200">
            {unresolved.length} unresolved FK reference{unresolved.length === 1 ? "" : "s"} across all tables
          </span>
          <UnresolvedDownload rows={unresolved} />
        </div>
      ) : null}
    </div>
  );
}

function TableReport({ table }: { table: DryRunTableReport }) {
  return (
    <article className="rounded-md border border-border p-3 text-xs space-y-2">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold">{table.sourceName}</span>
        <span className="text-muted-foreground">
          → {table.targetName ? <code className="rounded bg-muted px-1">{table.targetName}</code> : <em>no target</em>}
          {table.targetId ? <> (id <code className="rounded bg-muted px-1">{table.targetId}</code>)</> : null}
        </span>
        <span className="ml-auto text-muted-foreground">{table.apiCalls} API call{table.apiCalls === 1 ? "" : "s"}</span>
      </header>

      <div className="grid gap-2 sm:grid-cols-4">
        <Metric label="Source rows" value={table.sourceRows} />
        <Metric label="Existing (draft)" value={table.existingRows} />
        <Metric label="Will create" value={table.planned.create} tone={table.planned.create > 0 ? "green" : undefined} />
        <Metric label="Will update" value={table.planned.update} tone={table.planned.update > 0 ? "blue" : undefined} />
      </div>

      {table.errors.length > 0 ? (
        <ul className="rounded-md border border-destructive/30 bg-destructive/10 p-2 space-y-0.5">
          {table.errors.map((e, i) => (
            <li key={i} className="text-destructive">{e}</li>
          ))}
        </ul>
      ) : null}

      {table.coercionWarnings.length > 0 ? (
        <ul className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2 space-y-0.5">
          {table.coercionWarnings.map((w, i) => (
            <li key={i} className="text-yellow-800 dark:text-yellow-200">
              <code className="rounded bg-muted px-1">{w.sourceColumn}</code> → <code className="rounded bg-muted px-1">{w.targetColumn}</code>{" "}
              ({w.targetType}): {w.badCount} value(s) won&apos;t coerce cleanly
            </li>
          ))}
        </ul>
      ) : null}

      {table.unresolvedFks.length > 0 ? (
        <details className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2">
          <summary className="cursor-pointer text-yellow-800 dark:text-yellow-200">
            {table.unresolvedFks.length} unresolved FK reference{table.unresolvedFks.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-0.5 max-h-48 overflow-y-auto">
            {table.unresolvedFks.slice(0, 100).map((u, i) => (
              <li key={i}>
                row {u.rowIndex}: <code className="rounded bg-muted px-1">{u.sourceColumn}</code> ={" "}
                <code className="rounded bg-muted px-1">{u.value}</code> not in{" "}
                <code className="rounded bg-muted px-1">{u.foreignSource}.{u.matchKey}</code>
              </li>
            ))}
            {table.unresolvedFks.length > 100 ? (
              <li className="text-muted-foreground">…and {table.unresolvedFks.length - 100} more (download CSV for the full list)</li>
            ) : null}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "green" | "blue" }) {
  const cls =
    tone === "green"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "blue"
        ? "text-blue-700 dark:text-blue-300"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2 py-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={"text-sm font-semibold " + cls}>{value.toLocaleString()}</p>
    </div>
  );
}

function UnresolvedDownload({ rows }: { rows: DryRunUnresolvedFk[] }) {
  function download() {
    const header = ["sourceTable", "rowIndex", "sourceColumn", "foreignSource", "matchKey", "value"].join(",");
    const body = rows
      .map((r) => [r.sourceTable, r.rowIndex, r.sourceColumn, r.foreignSource, r.matchKey, escape(r.value)].join(","))
      .join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "unresolved-fks.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return (
    <Button variant="outline" size="sm" onClick={download}>
      Download CSV
    </Button>
  );
}

function escape(v: string): string {
  if (v.includes(",") || v.includes("\"") || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
