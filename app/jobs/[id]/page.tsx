import Link from "next/link";
import { notFound } from "next/navigation";
import { getJobById, listJobErrors } from "@/lib/db/jobs";
import { createSupabaseServerClient } from "@/lib/db/supabase";

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
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <Link href="/jobs" className="text-xs underline text-muted-foreground">
          ← Back to jobs
        </Link>
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
      </header>

      {loadError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Could not load job: {loadError}
        </p>
      ) : null}

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
