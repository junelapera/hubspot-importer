"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DryRunSource } from "@/lib/dry-run";
import type { ImportEvent, ImportResult, RowError } from "@/lib/hubdb";
import type { MappingState } from "@/lib/mapping";

type PublishMode = "none" | "foreign-only" | "all";

type PublishedEntry = { table: string; publishedAt?: string; error?: string };

// The shape the polling endpoint returns.
type JobPollResponse = {
  id: string;
  status: "queued" | "pending" | "running" | "succeeded" | "failed" | "cancelled";
  totals: {
    tables: { name: string; created: number; updated: number; skipped: number; errors: number }[];
    order: string[];
    ok: boolean;
    publish?: PublishMode;
    publishedTables?: string[];
  } | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  batchesDone: number;
  response: {
    result?: ImportResult;
    events?: ImportEvent[];
    published?: PublishedEntry[];
    hubspot?: { status: number; path: string; method: string; body?: unknown };
    row?: RowError;
    fail?: { kind: "fail-fast" | "cancelled"; message: string };
  } | null;
};

// What the client ends up rendering. Assembled from JobPollResponse
// once the run flips terminal; the running-state renderer only needs
// {status, batchesDone, totals}.
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
  hubspot?: { status: number; path: string; method: string; body?: unknown };
};

type Stage =
  | { kind: "idle" }
  | {
      kind: "polling";
      jobId: string;
      startedAt: string;
      batchesDone: number;
      status: JobPollResponse["status"];
      totals: JobPollResponse["totals"];
      cancelling: boolean;
    }
  | { kind: "error"; message: string; issues?: unknown[]; hubspot?: ExecuteResponse["hubspot"] }
  | { kind: "fail-fast"; response: ExecuteResponse; startedAt: string; finishedAt: string; message: string }
  | { kind: "cancelled"; response: ExecuteResponse; startedAt: string; finishedAt: string; message: string }
  | { kind: "done"; response: ExecuteResponse; startedAt: string; finishedAt: string };

const POLL_INTERVAL_MS = 2000;

export function ExecutePanel({
  portalId,
  sources,
  mappings,
  profileId,
  resumeJobId,
  dryRunSignature,
  disabled,
  disabledReason,
}: {
  portalId: string;
  sources: DryRunSource[];
  mappings: Record<string, MappingState>;
  profileId?: string | null;
  resumeJobId?: string | null;
  dryRunSignature: string | null;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [publish, setPublish] = useState<PublishMode>("foreign-only");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const autoSavedRef = useRef<boolean>(false);

  // Clean up the poll timer on unmount so an unmounted panel doesn't
  // keep hitting the API forever.
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function pollOnce(jobId: string, startedAt: string) {
    let body: JobPollResponse;
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) {
        // 404 → the job disappeared (mapping cascade-delete). Terminal
        // error. Otherwise let the next tick try again.
        if (res.status === 404) {
          stopPolling();
          setStage({ kind: "error", message: `job ${jobId} not found` });
        }
        return;
      }
      body = (await res.json()) as JobPollResponse;
    } catch {
      // Network blip — let the next tick retry.
      return;
    }

    // Still in flight — update the live counter + status.
    if (body.status === "queued" || body.status === "pending" || body.status === "running") {
      setStage((prev) =>
        prev.kind === "polling"
          ? {
              ...prev,
              batchesDone: body.batchesDone,
              status: body.status,
              totals: body.totals,
              cancelling: body.cancelRequested,
            }
          : prev,
      );
      return;
    }

    // Terminal — stop polling and dispatch into the render stage.
    stopPolling();
    const finishedAt = body.finishedAt ?? new Date().toISOString();
    const response: ExecuteResponse = {
      result: body.response?.result,
      events: body.response?.events,
      published: body.response?.published,
      jobId,
      persistenceError: null,
      autoSavedProfile: autoSavedRef.current,
      row: body.response?.row,
      hubspot: body.response?.hubspot,
      error: body.error ?? body.response?.fail?.message ?? undefined,
    };

    if (body.status === "cancelled") {
      setStage({
        kind: "cancelled",
        response,
        startedAt,
        finishedAt,
        message: response.error ?? "cancelled",
      });
      return;
    }

    if (body.status === "failed") {
      // Fail-fast has a per-row `row` on the response payload. Anything
      // else with a result is a "run finished with errors" state that
      // we render as `done` (the ResultView already highlights errors).
      // Hubspot 4xx from a preflight/hubspot error path shows as
      // top-level `error` stage.
      if (body.response?.fail?.kind === "fail-fast" && response.result && response.row) {
        setStage({
          kind: "fail-fast",
          response,
          startedAt,
          finishedAt,
          message: response.error ?? "fail-fast",
        });
        return;
      }
      if (response.result) {
        // Runs that finished but had per-row errors — render the full
        // result cards so users can see which rows failed.
        setStage({ kind: "done", response, startedAt, finishedAt });
        return;
      }
      setStage({
        kind: "error",
        message: response.error ?? "failed",
        hubspot: response.hubspot,
      });
      return;
    }

    // Succeeded.
    setStage({ kind: "done", response, startedAt, finishedAt });
  }

  async function run() {
    const startedAt = new Date().toISOString();
    stopPolling();
    setStage({
      kind: "polling",
      jobId: "",
      startedAt,
      batchesDone: 0,
      status: "queued",
      totals: null,
      cancelling: false,
    });
    try {
      const res = await fetch(`/api/portals/${portalId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources,
          mappings,
          publish,
          profileId: profileId ?? undefined,
          resumeJobId: resumeJobId ?? undefined,
          dryRunSignature,
        }),
      });
      const body = (await res.json()) as {
        jobId?: string;
        status?: string;
        error?: string;
        issues?: unknown[];
        autoSavedProfile?: boolean;
      };
      if (!res.ok || !body.jobId) {
        setStage({
          kind: "error",
          message: body.error ?? `HTTP ${res.status}`,
          issues: body.issues,
        });
        return;
      }
      jobIdRef.current = body.jobId;
      autoSavedRef.current = body.autoSavedProfile ?? false;
      setStage({
        kind: "polling",
        jobId: body.jobId,
        startedAt,
        batchesDone: 0,
        status: "queued",
        totals: null,
        cancelling: false,
      });
      // First tick immediately so the UI updates fast if the run
      // completed in-between the enqueue and now (small imports finish
      // in seconds).
      void pollOnce(body.jobId, startedAt);
      pollTimerRef.current = setInterval(
        () => void pollOnce(body.jobId!, startedAt),
        POLL_INTERVAL_MS,
      );
    } catch (err) {
      stopPolling();
      setStage({ kind: "error", message: (err as Error).message });
    }
  }

  async function cancel() {
    if (stage.kind !== "polling" || !stage.jobId) return;
    // Optimistic — flip the local flag so the button feedback is
    // immediate. The real cancel takes effect at the next batch
    // boundary on the server.
    setStage((prev) => (prev.kind === "polling" ? { ...prev, cancelling: true } : prev));
    try {
      await fetch(`/api/jobs/${stage.jobId}/cancel`, { method: "POST" });
    } catch {
      // Best-effort — the next poll will show whether the flag flipped.
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Execute</h2>
          <p className="text-xs text-muted-foreground">
            Enqueues an Inngest job that runs <code className="rounded bg-muted px-1">importRows</code>. Batches at 100/call, upserts by natural key.
            Publish step runs in dependency order. Safe to close this tab — the run continues on the server.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <span>Publish</span>
            <Select
              value={publish}
              onValueChange={(v) => setPublish(v as PublishMode)}
              disabled={stage.kind === "polling"}
              items={[
                { value: "none", label: "none (draft only)" },
                { value: "foreign-only", label: "foreign tables only" },
                { value: "all", label: "all" },
              ]}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">none (draft only)</SelectItem>
                <SelectItem value="foreign-only">foreign tables only</SelectItem>
                <SelectItem value="all">all</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {stage.kind === "polling" && stage.jobId ? (
            <Button
              variant="destructive"
              onClick={cancel}
              disabled={stage.cancelling}
            >
              {stage.cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          ) : null}
          <Button
            onClick={run}
            disabled={disabled || !dryRunSignature || stage.kind === "polling"}
          >
            {stage.kind === "polling"
              ? stage.status === "queued"
                ? "Queued…"
                : "Running…"
              : stage.kind === "done" || stage.kind === "fail-fast" || stage.kind === "cancelled"
                ? "Re-run"
                : "Execute"}
          </Button>
        </div>
      </header>

      {!dryRunSignature ? (
        <p className="text-xs text-muted-foreground">
          Run a dry run first — execute is gated on a matching dry-run signature (PRD F7).
        </p>
      ) : disabled && disabledReason ? (
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      ) : null}

      {stage.kind === "polling" && stage.jobId ? (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-xs space-y-1">
          <p>
            <span className="font-medium">Job</span>{" "}
            <a href={`/jobs/${stage.jobId}`} className="underline">
              <code className="rounded bg-muted px-1">{stage.jobId}</code>
            </a>
            {" · "}
            <span className="capitalize">{stage.status}</span>
            {stage.cancelling ? " · cancel requested" : null}
          </p>
          <p className="text-muted-foreground">
            {stage.batchesDone} batch{stage.batchesDone === 1 ? "" : "es"} completed
            {stage.totals?.tables && stage.totals.tables.length > 0 ? (
              <>
                {" · tables so far: "}
                {stage.totals.tables.map((t) => (
                  <span key={t.name} className="mr-1">
                    <code className="rounded bg-muted px-1 text-foreground">{t.name}</code>
                    <span className="text-emerald-700 dark:text-emerald-300"> +{t.created}</span>
                    {t.updated > 0 ? <span className="text-blue-700 dark:text-blue-300"> ~{t.updated}</span> : null}
                    {t.errors > 0 ? <span className="text-destructive"> !{t.errors}</span> : null}
                  </span>
                ))}
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {stage.kind === "error" ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <p>{stage.message}</p>
          {stage.issues && stage.issues.length > 0 ? (
            <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(stage.issues, null, 2)}</pre>
          ) : null}
          {stage.hubspot ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-medium">
                HubSpot response — {stage.hubspot.method} {stage.hubspot.path} → {stage.hubspot.status}
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-background/40 p-2 text-foreground">
                {JSON.stringify(stage.hubspot.body, null, 2)}
              </pre>
            </details>
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

      {stage.kind === "cancelled" ? (
        <>
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-900 dark:text-yellow-100 space-y-1">
            <p className="font-semibold">Import cancelled</p>
            <p className="text-xs">{stage.message}</p>
          </div>
          {stage.response.result ? (
            <ResultView
              response={stage.response}
              portalId={portalId}
              publish={publish}
              startedAt={stage.startedAt}
              finishedAt={stage.finishedAt}
            />
          ) : null}
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
