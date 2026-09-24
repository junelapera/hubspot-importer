"use client";

import { useState, useTransition } from "react";
import type { FormEventHandler } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Conflict, DiffPlan, SchemaColumn, TableDiff } from "@/lib/schema";
import type { ProvisionEvent, ProvisionResult } from "@/lib/hubdb";
import { TutorialPanel, TutorialSteps, TutorialTip } from "@/components/ui/tutorial-panel";

type PlanResponse = {
  plan: DiffPlan;
  schema: unknown;
  fetchedAt: string;
  error?: string;
  issues?: string[];
};

type ProvisionResponse = {
  plan?: DiffPlan;
  result?: ProvisionResult;
  events?: ProvisionEvent[];
  error?: string;
  conflictTables?: string[];
  issues?: string[];
};

type Stage =
  | { kind: "idle" }
  | { kind: "diffing" }
  | { kind: "planned"; payload: PlanResponse; sourceText: string }
  | { kind: "provisioning"; payload: PlanResponse; sourceText: string }
  | { kind: "provisioned"; payload: PlanResponse; result: ProvisionResponse; sourceText: string }
  | { kind: "error"; message: string; issues?: string[]; sourceText: string };

export function SchemaPlanner({ portalId }: { portalId: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [text, setText] = useState<string>("");
  const [refreshing, startRefresh] = useTransition();

  async function readFile(file: File): Promise<string> {
    return await file.text();
  }

  const onSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file") as File | null;
    let sourceText = text;
    if (file && file.size > 0) {
      sourceText = await readFile(file);
      setText(sourceText);
    }
    if (!sourceText.trim()) {
      setStage({ kind: "error", message: "paste or upload a schema JSON", sourceText });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(sourceText);
    } catch (err) {
      setStage({ kind: "error", message: `not valid JSON: ${(err as Error).message}`, sourceText });
      return;
    }

    setStage({ kind: "diffing" });
    try {
      const res = await fetch(`/api/portals/${portalId}/diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: parsed }),
      });
      const payload = (await res.json()) as PlanResponse;
      if (!res.ok) {
        setStage({
          kind: "error",
          message: payload.error ?? `HTTP ${res.status}`,
          issues: payload.issues,
          sourceText,
        });
        return;
      }
      setStage({ kind: "planned", payload, sourceText });
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message, sourceText });
    }
  };

  async function onProvision() {
    if (stage.kind !== "planned") return;
    const { sourceText, payload } = stage;
    let parsed: unknown;
    try {
      parsed = JSON.parse(sourceText);
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message, sourceText });
      return;
    }
    setStage({ kind: "provisioning", payload, sourceText });
    try {
      const res = await fetch(`/api/portals/${portalId}/provision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: parsed }),
      });
      const body = (await res.json()) as ProvisionResponse;
      if (!res.ok) {
        setStage({
          kind: "error",
          message: body.error ?? `HTTP ${res.status}`,
          issues: body.issues ?? body.conflictTables?.map((t) => `conflict on ${t}`),
          sourceText,
        });
        return;
      }
      setStage({ kind: "provisioned", payload, result: body, sourceText });
      startRefresh(() => router.refresh());
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message, sourceText });
    }
  }

  const busy = stage.kind === "diffing" || stage.kind === "provisioning";

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Diff against a schema definition</h2>
        {stage.kind === "planned" || stage.kind === "provisioned" ? (
          <span className="text-xs text-muted-foreground">
            {stage.kind === "planned"
              ? `plan generated · ${stage.payload.plan.tables.length} table${stage.payload.plan.tables.length === 1 ? "" : "s"}`
              : "provisioning complete"}
          </span>
        ) : null}
      </header>

      <TutorialPanel>
        <p>
          <strong>Provisioning</strong> creates the HubDB tables your import will land in. The app
          does this in <strong>two safe steps</strong> so nothing changes in HubSpot until you
          confirm.
        </p>
        <p>
          <strong>Don&apos;t have a schema.json?</strong> Skip this page — go to{" "}
          <Link href="/import" className="text-primary underline-offset-2 hover:underline">
            Import
          </Link>{" "}
          instead, upload your source files, and use the <em>Suggest a schema</em> panel above the
          mapping cards. It auto-detects column types + relationships and downloads a{" "}
          <code className="rounded bg-muted px-1 text-xs">schema.json</code> for you. Come back
          here to paste it in.
        </p>
        <p>If you already have a schema.json, here&apos;s how it works:</p>
        <TutorialSteps>
          <li>Paste the JSON below or upload the .json file.</li>
          <li>
            Click <strong>Generate plan</strong>. The app compares your schema against what&apos;s
            already in this HubSpot portal and gives each table a verdict:
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs">
              <li>
                <strong>create</strong> — table doesn&apos;t exist yet; will be created.
              </li>
              <li>
                <strong>match</strong> — already exists and matches; nothing to do.
              </li>
              <li>
                <strong>update</strong> — exists but missing some columns; they&apos;ll be added.
              </li>
              <li>
                <strong>conflict</strong> — an existing column has a different type. The app
                <em> refuses to change existing columns</em>, so this stops the flow and asks
                you to reconcile by hand in HubSpot.
              </li>
            </ul>
            No writes happen at this step — you can click <em>Generate plan</em> as many times as
            you want to preview.
          </li>
          <li>
            If no conflicts, click <strong>Provision</strong>. The app creates missing tables and
            columns in the right order (foreign tables first so links land correctly).
          </li>
        </TutorialSteps>
        <TutorialTip>
          Everything created here lands in HubSpot&apos;s <em>draft</em> state — the tables
          aren&apos;t visible to your website or via HubL until they&apos;re published. Publishing
          happens later, on the Execute step of the import wizard.
        </TutorialTip>
      </TutorialPanel>

      <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-border p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Paste schema JSON</span>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            placeholder='{\n  "version": 1,\n  "tables": [ … ]\n}'
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">…or upload a .json file</span>
          <input
            name="file"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/60"
          />
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {stage.kind === "diffing" ? "Diffing…" : "Generate plan"}
          </Button>
          {stage.kind === "error" ? (
            <div className="text-sm text-destructive">
              <p>{stage.message}</p>
              {stage.issues && stage.issues.length > 0 ? (
                <ul className="ml-4 list-disc text-xs">
                  {stage.issues.map((i, k) => <li key={k}>{i}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </form>

      {(stage.kind === "planned" || stage.kind === "provisioning" || stage.kind === "provisioned") ? (
        <PlanView
          plan={stage.payload.plan}
          onProvision={onProvision}
          provisioning={stage.kind === "provisioning"}
          provisioned={stage.kind === "provisioned"}
          result={stage.kind === "provisioned" ? stage.result : null}
          refreshing={refreshing}
        />
      ) : null}
    </section>
  );
}

function PlanView({
  plan,
  onProvision,
  provisioning,
  provisioned,
  result,
  refreshing,
}: {
  plan: DiffPlan;
  onProvision: () => void;
  provisioning: boolean;
  provisioned: boolean;
  result: ProvisionResponse | null;
  refreshing: boolean;
}) {
  const counts = plan.tables.reduce<Record<string, number>>((acc, t) => {
    acc[t.action] = (acc[t.action] ?? 0) + 1;
    return acc;
  }, {});
  const hasChanges = (counts.create ?? 0) + (counts.update ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <SummaryChip label="create" count={counts.create ?? 0} tone="green" />
        <SummaryChip label="update" count={counts.update ?? 0} tone="blue" />
        <SummaryChip label="match" count={counts.match ?? 0} tone="muted" />
        <SummaryChip label="conflict" count={counts.conflict ?? 0} tone="red" />
        <div className="ml-auto flex items-center gap-2">
          {!plan.ok ? (
            <span className="text-xs text-destructive">
              plan has {counts.conflict ?? 0} conflict(s) — resolve before provisioning
            </span>
          ) : provisioned ? (
            <span className="text-xs text-emerald-700 dark:text-emerald-300">
              provisioned ✓ {refreshing ? "· refreshing schema…" : ""}
            </span>
          ) : hasChanges ? (
            <Button onClick={onProvision} disabled={provisioning}>
              {provisioning ? "Provisioning…" : "Provision"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">no schema changes to apply</span>
          )}
        </div>
      </div>

      <ul className="space-y-3">
        {plan.tables.map((t) => (
          <li key={t.name}><TableDiffCard diff={t} /></li>
        ))}
      </ul>

      {result?.result ? (
        <details className="rounded-md border border-border p-3 text-xs">
          <summary className="cursor-pointer font-medium">
            Provisioning result — order {result.result.order.join(" → ")}
            {result.result.deferred.length > 0
              ? ` · ${result.result.deferred.length} deferred edge(s)`
              : ""}
          </summary>
          <div className="mt-3 space-y-2">
            <div>
              <p className="font-medium">New table ids</p>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(result.result.tableIds).map(([name, id]) => (
                  <li key={name}>
                    <code className="rounded bg-muted px-1">{name}</code> → <code className="rounded bg-muted px-1">{id}</code>
                  </li>
                ))}
              </ul>
            </div>
            {result.events && result.events.length > 0 ? (
              <div>
                <p className="font-medium">Events</p>
                <ol className="mt-1 space-y-0.5">
                  {result.events.map((e, i) => (
                    <li key={i}>
                      <code className="rounded bg-muted px-1">{e.kind}</code>{" "}
                      {"table" in e ? e.table : ""}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function TableDiffCard({ diff }: { diff: TableDiff }) {
  return (
    <article className="rounded-md border border-border p-3">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold">{diff.name}</span>
        <ActionBadge action={diff.action} />
      </header>
      <div className="mt-2 text-xs text-muted-foreground">
        {diff.action === "create" ? (
          <p>Will create the table with {diff.schema.columns.length} column(s).</p>
        ) : diff.action === "match" ? (
          <p>Portal already matches; nothing to change.</p>
        ) : diff.action === "update" ? (
          <div>
            <p>
              Will add {diff.addColumns.length} column(s) to the existing table (id{" "}
              <code className="rounded bg-muted px-1">{diff.portal.id}</code>).
            </p>
            <ul className="mt-1 ml-4 list-disc text-foreground">
              {diff.addColumns.map((c: SchemaColumn) => (
                <li key={c.name}>
                  <code className="rounded bg-muted px-1">{c.name}</code>{" "}
                  <code className="rounded bg-muted px-1 text-[10px] uppercase">{c.type}</code>
                  {c.type === "FOREIGN_ID" && c.foreignTable ? (
                    <> → {c.foreignTable}{c.foreignColumn ? `.${c.foreignColumn}` : ""}</>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div>
            <p>
              {diff.conflicts.length} conflict(s) on portal table id{" "}
              <code className="rounded bg-muted px-1">{diff.portal.id}</code> — v1 never drops or retypes columns, so
              resolve manually.
            </p>
            <ul className="mt-1 ml-4 list-disc text-foreground">
              {diff.conflicts.map((c: Conflict, i: number) => (
                <li key={i}><ConflictLine conflict={c} /></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

function ConflictLine({ conflict }: { conflict: Conflict }) {
  if (conflict.kind === "column-type-mismatch") {
    return (
      <>
        <code className="rounded bg-muted px-1">{conflict.column}</code>: type mismatch — schema wants{" "}
        <code className="rounded bg-muted px-1">{conflict.expected}</code>, portal has{" "}
        <code className="rounded bg-muted px-1">{conflict.actual}</code>
      </>
    );
  }
  if (conflict.kind === "fk-target-mismatch") {
    return (
      <>
        <code className="rounded bg-muted px-1">{conflict.column}</code>: FK target mismatch — schema wants{" "}
        <code className="rounded bg-muted px-1">{conflict.expectedTable}</code>, portal points at table id{" "}
        <code className="rounded bg-muted px-1">{conflict.actualTableId}</code>
      </>
    );
  }
  return (
    <>
      <code className="rounded bg-muted px-1">{conflict.column}</code>: FK display column mismatch — schema wants{" "}
      <code className="rounded bg-muted px-1">{conflict.expectedColumn}</code>, portal has column id{" "}
      <code className="rounded bg-muted px-1">{conflict.actualColumnId}</code>
    </>
  );
}

function ActionBadge({ action }: { action: TableDiff["action"] }) {
  const tone =
    action === "create"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : action === "update"
        ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
        : action === "match"
          ? "border-border bg-muted text-muted-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <span
      className={
        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " + tone
      }
    >
      {action}
    </span>
  );
}

function SummaryChip({ label, count, tone }: { label: string; count: number; tone: "green" | "blue" | "muted" | "red" }) {
  const cls =
    tone === "green"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "blue"
        ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
        : tone === "red"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-muted-foreground";
  return (
    <span className={"rounded-full border px-2 py-0.5 text-[11px] font-medium " + cls}>
      {label} {count}
    </span>
  );
}
