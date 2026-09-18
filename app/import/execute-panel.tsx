"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DryRunSource } from "@/lib/dry-run";
import type { ImportEvent, ImportResult, RowError } from "@/lib/hubdb";
import type { MappingState } from "@/lib/mapping";

type PublishMode = "none" | "foreign-only" | "all";

type PublishedEntry = { table: string; publishedAt?: string; error?: string };

type ExecuteResponse = {
  result?: ImportResult;
  events?: ImportEvent[];
  published?: PublishedEntry[];
  jobId?: string | null;
  persistenceError?: string | null;
  autoSavedProfile?: boolean;
  row?: RowError;
  error?: string;
  issues?: unknown[];
};

type Stage =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string; issues?: unknown[] }
  | { kind: "fail-fast"; response: ExecuteResponse; startedAt: string; finishedAt: string; message: string }
  | { kind: "done"; response: ExecuteResponse; startedAt: string; finishedAt: string };

export function ExecutePanel({
  portalId,
  sources,
  mappings,
  profileId,
  disabled,
  disabledReason,
}: {
  portalId: string;
  sources: DryRunSource[];
  mappings: Record<string, MappingState>;
  profileId?: string | null;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [publish, setPublish] = useState<PublishMode>("foreign-only");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  async function run() {
    const startedAt = new Date().toISOString();
    setStage({ kind: "running" });
    try {
      const res = await fetch(`/api/portals/${portalId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources, mappings, publish, profileId: profileId ?? undefined }),
      });
      const body = (await res.json()) as ExecuteResponse;
      const finishedAt = new Date().toISOString();
      if (!res.ok) {
        // fail-fast: server returned 422 with a full result + failing row
        if (res.status === 422 && body.result && body.row) {
          setStage({
            kind: "fail-fast",
            response: body,
            startedAt,
            finishedAt,
            message: body.error ?? "fail-fast",
          });
          return;
        }
        setStage({ kind: "error", message: body.error ?? `HTTP ${res.status}`, issues: body.issues });
        return;
      }
      setStage({ kind: "done", response: body, startedAt, finishedAt });
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Execute</h2>
          <p className="text-xs text-muted-foreground">
            Writes to draft tables via <code className="rounded bg-muted px-1">importRows</code>. Batches at 100/call, upserts by natural key.
            Publish step runs in dependency order.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <span>Publish</span>
            <select
              value={publish}
              onChange={(e) => setPublish(e.target.value as PublishMode)}
              disabled={stage.kind === "running"}
              className="rounded-md border border-input bg-background px-2 py-1"
            >
              <option value="none">none (draft only)</option>
              <option value="foreign-only">foreign tables only</option>
              <option value="all">all</option>
            </select>
          </label>
          <Button onClick={run} disabled={disabled || stage.kind === "running"}>
            {stage.kind === "running"
              ? "Executing…"
              : stage.kind === "done" || stage.kind === "fail-fast"
                ? "Re-run"
                : "Execute"}
          </Button>
        </div>
      </header>

      {disabled && disabledReason ? (
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      ) : null}

      {stage.kind === "error" ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <p>{stage.message}</p>
          {stage.issues && stage.issues.length > 0 ? (
            <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(stage.issues, null, 2)}</pre>
          ) : null}
        </div>
      ) : null}

      {stage.kind === "fail-fast" && stage.response.result ? (
        <>
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive space-y-1">
            <p className="font-semibold">Import aborted (onMissing=&quot;fail&quot;)</p>
            <p className="text-xs">{stage.message}</p>
            {stage.response.row ? (
              <p className="text-xs">
                Triggered by <code className="rounded bg-muted px-1 text-foreground">{stage.response.row.table}</code>{" "}
                row <code className="rounded bg-muted px-1 text-foreground">{stage.response.row.sourceIndex}</code>
                {stage.response.row.column ? (
                  <>
                    {" · column "}
                    <code className="rounded bg-muted px-1 text-foreground">{stage.response.row.column}</code>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <ResultView
            response={stage.response}
            portalId={portalId}
            publish={publish}
            startedAt={stage.startedAt}
            finishedAt={stage.finishedAt}
          />
        </>
      ) : null}

      {stage.kind === "done" && stage.response.result ? (
        <ResultView
          response={stage.response}
          portalId={portalId}
          publish={publish}
          startedAt={stage.startedAt}
          finishedAt={stage.finishedAt}
        />
      ) : null}
    </section>
  );
}

function ResultView({
  response,
  portalId,
  publish,
  startedAt,
  finishedAt,
}: {
  response: ExecuteResponse;
  portalId: string;
  publish: PublishMode;
  startedAt: string;
  finishedAt: string;
}) {
  const result = response.result!;
  const totals = useMemo(() => {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    for (const t of result.tables) {
      created += t.created;
      updated += t.updated;
      skipped += t.skipped;
      errors += t.errors.length;
    }
    return { created, updated, skipped, errors };
  }, [result]);

  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();

  return (
    <div className="space-y-4">
      {response.persistenceError ? (
        <p className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2 text-xs text-yellow-800 dark:text-yellow-200">
          Job persistence warning: {response.persistenceError}
        </p>
      ) : null}
      {response.jobId ? (
        <p className="text-xs text-muted-foreground">
          Job:{" "}
          <a href={`/jobs/${response.jobId}`} className="underline">
            <code className="rounded bg-muted px-1">{response.jobId}</code>
          </a>
          {response.autoSavedProfile ? " · profile auto-saved" : null}
        </p>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Import ordered: {result.order.map((n) => (
            <code key={n} className="mr-1 rounded bg-muted px-1">{n}</code>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <DownloadButton
            filename="row-errors.csv"
            mime="text/csv;charset=utf-8"
            content={() => buildErrorsCsv(result.tables.flatMap((t) => t.errors))}
            disabled={totals.errors === 0}
            label="Download errors CSV"
          />
          <DownloadButton
            filename="import-log.json"
            mime="application/json"
            content={() =>
              JSON.stringify(
                {
                  portalId,
                  publish,
                  startedAt,
                  finishedAt,
                  durationMs,
                  result,
                  events: response.events ?? [],
                  published: response.published ?? [],
                },
                null,
                2,
              )
            }
            label="Download log JSON"
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 text-xs sm:grid-cols-5">
        <Stat label="Tables" value={result.tables.length} />
        <Stat label="Created" value={totals.created} tone="ok" />
        <Stat label="Updated" value={totals.updated} tone="info" />
        <Stat label="Skipped" value={totals.skipped} tone="mute" />
        <Stat label="Errors" value={totals.errors} tone={totals.errors > 0 ? "bad" : "mute"} />
      </dl>

      <ul className="space-y-2">
        {result.tables.map((t) => (
          <TableCard key={t.name} table={t} />
        ))}
      </ul>

      {response.published && response.published.length > 0 ? (
        <div className="rounded-md border border-border p-3 text-xs space-y-1">
          <p className="font-medium">Publish results</p>
          <ul className="space-y-0.5">
            {response.published.map((p) => (
              <li key={p.table}>
                <code className="rounded bg-muted px-1">{p.table}</code>{" "}
                {p.error ? (
                  <span className="text-destructive">— {p.error}</span>
                ) : (
                  <span className="text-muted-foreground">
                    published{p.publishedAt ? ` at ${new Date(p.publishedAt).toLocaleTimeString()}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {response.events && response.events.length > 0 ? (
        <details className="rounded-md border border-border p-3 text-xs">
          <summary className="cursor-pointer font-medium">Event log ({response.events.length})</summary>
          <ol className="mt-2 space-y-0.5">
            {response.events.map((e, i) => (
              <li key={i}>
                <code className="rounded bg-muted px-1">{e.kind}</code>{" "}
                <code className="rounded bg-muted px-1">{"table" in e ? e.table : ""}</code>
                {"batch" in e ? ` batch=${e.batch} sent=${(e as { sent: number }).sent}` : ""}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function TableCard({ table }: { table: ImportResult["tables"][number] }) {
  const grouped = useMemo(() => groupErrors(table.errors), [table.errors]);
  return (
    <li className="rounded-md border border-border p-3 text-xs space-y-2">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold">{table.name}</span>
        <span className="text-emerald-700 dark:text-emerald-300">{table.created} created</span>
        <span className="text-blue-700 dark:text-blue-300">{table.updated} updated</span>
        {table.skipped > 0 ? <span className="text-muted-foreground">{table.skipped} skipped</span> : null}
        {table.errors.length > 0 ? (
          <span className="text-destructive">{table.errors.length} errors</span>
        ) : null}
      </header>
      {grouped.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {grouped.map((g) => (
            <li
              key={`${g.kind}:${g.column ?? ""}`}
              className="rounded border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-destructive"
            >
              <code className="mr-1 rounded bg-muted px-1 text-foreground">{g.kind}</code>
              {g.column ? <span className="mr-1">on <code className="rounded bg-muted px-1 text-foreground">{g.column}</code></span> : null}
              × {g.count}
            </li>
          ))}
        </ul>
      ) : null}
      {table.errors.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-destructive">Row errors ({table.errors.length})</summary>
          <ul className="mt-1 max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {table.errors.map((e, i) => (
              <li key={i}>
                row {e.sourceIndex}: <code className="rounded bg-muted px-1">{e.kind}</code>
                {e.column ? <> · <code className="rounded bg-muted px-1">{e.column}</code></> : null}
                {" — "}
                {e.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function Stat({
  label,
  value,
  tone = "mute",
}: {
  label: string;
  value: number;
  tone?: "ok" | "info" | "bad" | "mute";
}) {
  const color =
    tone === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "info"
        ? "text-blue-700 dark:text-blue-300"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-base font-semibold ${color}`}>{value}</dd>
    </div>
  );
}

function DownloadButton({
  filename,
  mime,
  content,
  disabled,
  label,
}: {
  filename: string;
  mime: string;
  content: () => string;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => downloadBlob(filename, mime, content())}
    >
      {label}
    </Button>
  );
}

function downloadBlob(filename: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function groupErrors(errors: readonly RowError[]) {
  const map = new Map<string, { kind: string; column?: string; count: number }>();
  for (const e of errors) {
    const key = `${e.kind}:${e.column ?? ""}`;
    const cur = map.get(key);
    if (cur) cur.count++;
    else map.set(key, { kind: e.kind, column: e.column, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function buildErrorsCsv(errors: readonly RowError[]) {
  const header = ["table", "sourceIndex", "kind", "column", "detail"];
  const lines = [header.join(",")];
  for (const e of errors) {
    lines.push(
      [
        csvEscape(e.table),
        String(e.sourceIndex),
        csvEscape(e.kind),
        csvEscape(e.column ?? ""),
        csvEscape(e.detail),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function csvEscape(v: string): string {
  if (v === "") return "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
