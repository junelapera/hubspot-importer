"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { deleteJobsRequest } from "./delete-jobs";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";

// Trimmed, client-safe slice of JobWithMapping — the full row carries the
// input_sources / response blobs, which would bloat the RSC payload.
export type JobListRow = {
  id: string;
  kind: string;
  status: string;
  startedAt: string | null;
  portalLabel: string | null;
  portalEnv: string | null;
  mappingName: string | null;
  created: number;
  updated: number;
  errors: number;
};

const RUNNING_TITLE = "Cancel the run before deleting it";

export function JobsList({ jobs }: { jobs: JobListRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  const deletable = jobs.filter((j) => j.status !== "running");
  // Rows can vanish after a refresh; only count ids still on screen.
  const selectedIds = deletable.filter((j) => selected.has(j.id)).map((j) => j.id);
  const allSelected = deletable.length > 0 && selectedIds.length === deletable.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(deletable.map((j) => j.id)));
  }

  // Ids awaiting confirmation in the modal; null when it's closed.
  const [pending, setPending] = useState<string[] | null>(null);

  function remove(ids: string[]) {
    if (ids.length > 0) setPending(ids);
  }

  async function confirmDelete() {
    if (!pending) return;
    setBusy(true);
    setMessage(null);
    try {
      const { deleted, skipped } = await deleteJobsRequest(pending);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of deleted) next.delete(id);
        return next;
      });
      if (skipped.length > 0) {
        setMessage(
          `${skipped.length} job${skipped.length === 1 ? " was" : "s were"} not deleted — ` +
            "it started running or no longer exists.",
        );
      }
      setPending(null);
      startRefresh(() => router.refresh());
    } catch (err) {
      setMessage((err as Error).message);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={allSelected}
            disabled={deletable.length === 0 || busy}
            onChange={toggleAll}
            aria-label="Select all deletable jobs"
          />
          {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Select all"}
        </label>
        <Button
          variant="destructive"
          size="sm"
          disabled={selectedIds.length === 0 || busy}
          onClick={() => remove(selectedIds)}
        >
          <Trash2 aria-hidden="true" />
          {busy ? "Deleting…" : `Delete selected${selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}`}
        </Button>
      </div>

      <ConfirmDeleteDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        count={pending?.length ?? 0}
        queued={jobs.filter((j) => pending?.includes(j.id) && j.status === "queued").length}
        busy={busy}
        onConfirm={confirmDelete}
      />

      {message ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-xs">{message}</p>
      ) : null}

      {/* Desktop/tablet table — hidden under lg; cards take over below */}
      <div className="hidden overflow-x-auto rounded-md border border-border lg:block">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="w-8 px-3 py-2"><span className="sr-only">Select</span></th>
              <th className="px-3 py-2 font-medium">Started</th>
              <th className="px-3 py-2 font-medium">Portal</th>
              <th className="px-3 py-2 font-medium">Profile</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Created</th>
              <th className="px-3 py-2 font-medium text-right">Updated</th>
              <th className="px-3 py-2 font-medium text-right">Errors</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const running = j.status === "running";
              return (
                <tr
                  key={j.id}
                  className={"border-t border-border align-top " + (selected.has(j.id) ? "bg-muted/40" : "")}
                >
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selected.has(j.id)}
                      disabled={running || busy}
                      title={running ? RUNNING_TITLE : undefined}
                      onChange={() => toggle(j.id)}
                      aria-label={`Select job ${j.id}`}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono">
                    {j.startedAt ? new Date(j.startedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {j.portalLabel ? (
                      <>
                        {j.portalLabel}
                        <EnvBadge env={j.portalEnv} className="ml-2" />
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">(profile deleted)</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {j.mappingName ?? <span className="text-muted-foreground italic">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <code className="rounded bg-muted px-1">{j.kind}</code>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="px-3 py-2 text-right">{j.created.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{j.updated.toLocaleString()}</td>
                  <td
                    className={"px-3 py-2 text-right " + (j.errors > 0 ? "text-destructive font-medium" : "")}
                  >
                    {j.errors.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/jobs/${j.id}`}
                        className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-foreground"
                      >
                        details
                        <ArrowRight aria-hidden="true" className="size-3" />
                      </Link>
                      <RowDeleteButton job={j} disabled={busy} onDelete={remove} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile/tablet cards — shown under lg */}
      <ul className="space-y-2 lg:hidden">
        {jobs.map((j) => {
          const running = j.status === "running";
          return (
            <li
              key={j.id}
              className={"rounded-md border border-border p-3 text-xs space-y-2 " + (selected.has(j.id) ? "bg-muted/40" : "")}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Checkbox
                    checked={selected.has(j.id)}
                    disabled={running || busy}
                    title={running ? RUNNING_TITLE : undefined}
                    onChange={() => toggle(j.id)}
                    aria-label={`Select job ${j.id}`}
                  />
                  <StatusBadge status={j.status} />
                  <code className="rounded bg-muted px-1">{j.kind}</code>
                  {j.startedAt ? (
                    <span className="text-muted-foreground font-mono">
                      {new Date(j.startedAt).toLocaleString()}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/jobs/${j.id}`}
                    className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                  >
                    details
                    <ArrowRight aria-hidden="true" className="size-3" />
                  </Link>
                  <RowDeleteButton job={j} disabled={busy} onDelete={remove} />
                </div>
              </div>
              <div className="flex flex-wrap items-baseline gap-2">
                {j.portalLabel ? (
                  <>
                    <span className="font-medium">{j.portalLabel}</span>
                    <EnvBadge env={j.portalEnv} />
                  </>
                ) : (
                  <span className="text-muted-foreground italic">(profile deleted)</span>
                )}
                {j.mappingName ? <span className="text-muted-foreground">· {j.mappingName}</span> : null}
              </div>
              <div className="flex flex-wrap gap-3 tabular-nums">
                <span>
                  <span className="text-muted-foreground">created </span>
                  <span className="text-emerald-700 dark:text-emerald-300 font-medium">{j.created.toLocaleString()}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">updated </span>
                  <span className="text-blue-700 dark:text-blue-300 font-medium">{j.updated.toLocaleString()}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">errors </span>
                  <span className={j.errors > 0 ? "text-destructive font-medium" : "font-medium"}>
                    {j.errors.toLocaleString()}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RowDeleteButton({
  job,
  disabled,
  onDelete,
}: {
  job: JobListRow;
  disabled: boolean;
  onDelete: (ids: string[]) => void;
}) {
  const running = job.status === "running";
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      disabled={running || disabled}
      title={running ? RUNNING_TITLE : "Delete job"}
      aria-label={`Delete job ${job.id}`}
      onClick={() => onDelete([job.id])}
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 aria-hidden="true" />
    </Button>
  );
}

function EnvBadge({ env, className = "" }: { env: string | null; className?: string }) {
  return (
    <span
      className={
        `rounded px-1 py-0.5 text-[10px] uppercase ${className} ` +
        (env === "production" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")
      }
    >
      {env}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "succeeded"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "failed"
        ? "bg-destructive/10 text-destructive"
        : status === "running"
          ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
          : status === "queued"
            ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
            : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>{status}</span>
  );
}
