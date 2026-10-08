import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getJobById, listJobErrors } from "@/lib/db/jobs";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ErrorCard } from "@/components/ui/error-card";
import { DeleteJobButton } from "./delete-job-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createSupabaseServerClient();
  let job: Awaited<ReturnType<typeof getJobById>> = null;
  let errors: Awaited<ReturnType<typeof listJobErrors>> = [];
  let loadError: string | null = null;
  try {
    job = await getJobById(supabase, id);
    if (job) errors = await listJobErrors(supabase, job.id);
  } catch (err) {
    loadError = (err as Error).message;
  }

  if (!loadError && !job) notFound();

  const totals = job?.totals;
  const durationMs = totals?.durationMs;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 space-y-6">
      <Breadcrumbs
        items={[
          { label: "Jobs", href: "/jobs" },
          { label: job?.id ? `Job ${shortId(job.id)}` : "Job" },
        ]}
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Job {job?.id}</h1>
          {job ? (
            <p className="text-sm text-muted-foreground">
              {job.mappingName ? (
                <>
                  {job.mappingName} · {job.portalLabel} ({job.portalEnv})
                </>
              ) : (
                <span className="italic">profile deleted — provenance link lost</span>
              )}
              {" · "}
              {job.kind}
            </p>
          ) : null}
        </div>
        {job ? <DeleteJobButton jobId={job.id} status={job.status} /> : null}
      </header>

      {loadError ? <ErrorCard error={loadError} /> : null}

      {job ? (
        <>
          <section className="grid grid-cols-2 gap-3 rounded-md border border-border p-4 text-sm sm:grid-cols-4">
            <Stat label="Status" value={job.status} />
            <Stat
              label="Started"
              value={job.startedAt ? new Date(job.startedAt).toLocaleString() : "—"}
            />
            <Stat
              label="Finished"
              value={job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "—"}
            />
            <Stat
              label="Duration"
              value={durationMs != null ? `${(durationMs / 1000).toFixed(2)}s` : "—"}
            />
          </section>

          {job.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {job.error}
            </p>
          ) : null}

          {(job.status === "failed" || job.status === "cancelled") && job.portalId && job.mappingId ? (
            <section className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-4 text-sm">
              <h2 className="text-sm font-semibold">Resume this run</h2>
              <p className="text-xs text-muted-foreground">
                Reopens the wizard with this job&apos;s mapping profile pre-loaded. Re-upload
                the same source files, then click <em>Execute</em> — the run continues on
                this job id, and per-table upserts by natural key skip any rows that
                already landed in HubDB.
              </p>
              <Link
                href={`/import?resume=${job.id}&portalId=${job.portalId}&mappingId=${job.mappingId}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
              >
                Resume in wizard
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </section>
          ) : null}

          {totals ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                Per-table totals · order:{" "}
                {totals.order.map((n) => (
                  <code key={n} className="mr-1 rounded bg-muted px-1 text-xs">
                    {n}
                  </code>
                ))}
              </h2>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Table</th>
                      <th className="px-3 py-2 font-medium text-right">Created</th>
                      <th className="px-3 py-2 font-medium text-right">Updated</th>
                      <th className="px-3 py-2 font-medium text-right">Skipped</th>
                      <th className="px-3 py-2 font-medium text-right">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.tables.map((t) => (
                      <tr key={t.name} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{t.name}</td>
                        <td className="px-3 py-2 text-right">{t.created.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{t.updated.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{t.skipped.toLocaleString()}</td>
                        <td
                          className={
                            "px-3 py-2 text-right " +
                            (t.errors > 0 ? "text-destructive font-medium" : "")
                          }
                        >
                          {t.errors.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totals.publish && totals.publish !== "none" ? (
                <p className="text-xs text-muted-foreground">
                  Publish mode: <code className="rounded bg-muted px-1">{totals.publish}</code>
                  {totals.publishedTables && totals.publishedTables.length > 0 ? (
                    <>
                      {" · published "}
                      {totals.publishedTables.map((n) => (
                        <code key={n} className="mr-1 rounded bg-muted px-1">
                          {n}
                        </code>
                      ))}
                    </>
                  ) : null}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Row errors ({errors.length})</h2>
            {errors.length === 0 ? (
              <p className="text-xs text-muted-foreground">No row-level errors were logged.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Table</th>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Kind</th>
                      <th className="px-3 py-2 font-medium">Column</th>
                      <th className="px-3 py-2 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map((e) => (
                      <tr key={e.id} className="border-t border-border align-top">
                        <td className="px-3 py-2">{e.tableName}</td>
                        <td className="px-3 py-2 font-mono">{e.sourceIndex ?? "—"}</td>
                        <td className="px-3 py-2">
                          <code className="rounded bg-muted px-1">{e.kind}</code>
                        </td>
                        <td className="px-3 py-2">
                          {e.columnName ? (
                            <code className="rounded bg-muted px-1">{e.columnName}</code>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">{e.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
