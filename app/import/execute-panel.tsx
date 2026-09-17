"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DryRunSource } from "@/lib/dry-run";
import type { ImportEvent, ImportResult } from "@/lib/hubdb";
import type { MappingState } from "@/lib/mapping";

type PublishMode = "none" | "foreign-only" | "all";

type PublishedEntry = { table: string; publishedAt?: string; error?: string };

type ExecuteResponse = {
  result?: ImportResult;
  events?: ImportEvent[];
  published?: PublishedEntry[];
  error?: string;
  issues?: unknown[];
};

type Stage =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string; issues?: unknown[] }
  | { kind: "done"; response: ExecuteResponse };

export function ExecutePanel({
  portalId,
  sources,
  mappings,
  disabled,
  disabledReason,
}: {
  portalId: string;
  sources: DryRunSource[];
  mappings: Record<string, MappingState>;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [publish, setPublish] = useState<PublishMode>("foreign-only");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  async function run() {
    setStage({ kind: "running" });
    try {
      const res = await fetch(`/api/portals/${portalId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources, mappings, publish }),
      });
      const body = (await res.json()) as ExecuteResponse;
      if (!res.ok) {
        setStage({ kind: "error", message: body.error ?? `HTTP ${res.status}`, issues: body.issues });
        return;
      }
      setStage({ kind: "done", response: body });
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
            {stage.kind === "running" ? "Executing…" : stage.kind === "done" ? "Re-run" : "Execute"}
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

      {stage.kind === "done" && stage.response.result ? <ResultView response={stage.response} /> : null}
    </section>
  );
}

function ResultView({ response }: { response: ExecuteResponse }) {
  const result = response.result!;
  const totalErrors = result.tables.reduce((n, t) => n + t.errors.length, 0);
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Import ordered: {result.order.map((n) => (
          <code key={n} className="mr-1 rounded bg-muted px-1">{n}</code>
        ))}
        · {result.ok ? "all rows accepted" : `${totalErrors} row error(s)`}
      </p>

      <ul className="space-y-2">
        {result.tables.map((t) => (
          <li key={t.name} className="rounded-md border border-border p-3 text-xs space-y-1">
            <header className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold">{t.name}</span>
              <span className="text-emerald-700 dark:text-emerald-300">{t.created} created</span>
              <span className="text-blue-700 dark:text-blue-300">{t.updated} updated</span>
              {t.skipped > 0 ? <span className="text-muted-foreground">{t.skipped} skipped</span> : null}
              {t.errors.length > 0 ? (
                <span className="text-destructive">{t.errors.length} errors</span>
              ) : null}
            </header>
            {t.errors.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-destructive">Row errors</summary>
                <ul className="mt-1 space-y-0.5">
                  {t.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>
                      row {e.sourceIndex}: <code className="rounded bg-muted px-1">{e.kind}</code> — {e.detail}
                    </li>
                  ))}
                  {t.errors.length > 50 ? (
                    <li className="text-muted-foreground">…and {t.errors.length - 50} more</li>
                  ) : null}
                </ul>
              </details>
            ) : null}
          </li>
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
