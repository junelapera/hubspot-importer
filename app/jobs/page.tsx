import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { listRecentJobs } from "@/lib/db/jobs";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { PAGE_ACCENTS, PageHeader } from "@/components/ui/page-header";
import { ErrorCard } from "@/components/ui/error-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const supabase = createSupabaseServerClient();
  let jobs: Awaited<ReturnType<typeof listRecentJobs>> = [];
  let loadError: string | null = null;
  try {
    jobs = await listRecentJobs(supabase, 50);
  } catch (err) {
    loadError = (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 space-y-6">
      <PageHeader
        icon={PAGE_ACCENTS.jobs.icon}
        accentColor={PAGE_ACCENTS.jobs.color}
        title="Job history"
        description={
          <>
            Most recent 50 imports, dry runs, and publishes across all portals. Rows are written by{" "}
            <code className="rounded bg-muted px-1">POST /api/portals/[id]/execute</code>.
          </>
        }
      />

      {loadError ? <ErrorCard error={loadError} /> : null}

      {!loadError && jobs.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          No jobs yet. Run an import from{" "}
          <Link href="/import" className="underline">
            /import
          </Link>{" "}
          and it will appear here.
        </p>
      ) : null}

      {jobs.length > 0 ? (
        <>
          {/* Desktop/tablet table — hidden under lg; cards take over below */}
          <div className="hidden overflow-x-auto rounded-md border border-border lg:block">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-left">
                <tr>
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
                  const totals = j.totals;
                  const created = totals?.tables.reduce((n, t) => n + t.created, 0) ?? 0;
                  const updated = totals?.tables.reduce((n, t) => n + t.updated, 0) ?? 0;
                  const errors = totals?.tables.reduce((n, t) => n + t.errors, 0) ?? 0;
                  return (
                    <tr key={j.id} className="border-t border-border align-top">
                      <td className="px-3 py-2 whitespace-nowrap font-mono">
                        {j.startedAt ? new Date(j.startedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {j.portalLabel ? (
                          <>
                            {j.portalLabel}
                            <span
                              className={
                                "ml-2 rounded px-1 py-0.5 text-[10px] uppercase " +
                                (j.portalEnv === "production"
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-muted text-muted-foreground")
                              }
                            >
                              {j.portalEnv}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground italic">(profile deleted)</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {j.mappingName ?? (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <code className="rounded bg-muted px-1">{j.kind}</code>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={j.status} />
                      </td>
                      <td className="px-3 py-2 text-right">{created.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{updated.toLocaleString()}</td>
                      <td
                        className={
                          "px-3 py-2 text-right " + (errors > 0 ? "text-destructive font-medium" : "")
                        }
                      >
                        {errors.toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/jobs/${j.id}`}
                          className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-foreground"
                        >
                          details
                          <ArrowRight aria-hidden="true" className="size-3" />
                        </Link>
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
              const totals = j.totals;
              const created = totals?.tables.reduce((n, t) => n + t.created, 0) ?? 0;
              const updated = totals?.tables.reduce((n, t) => n + t.updated, 0) ?? 0;
              const errors = totals?.tables.reduce((n, t) => n + t.errors, 0) ?? 0;
              return (
                <li key={j.id} className="rounded-md border border-border p-3 text-xs space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <StatusBadge status={j.status} />
                      <code className="rounded bg-muted px-1">{j.kind}</code>
                      {j.startedAt ? (
                        <span className="text-muted-foreground font-mono">
                          {new Date(j.startedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                    <Link
                      href={`/jobs/${j.id}`}
                      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                    >
                      details
                      <ArrowRight aria-hidden="true" className="size-3" />
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    {j.portalLabel ? (
                      <>
                        <span className="font-medium">{j.portalLabel}</span>
                        <span
                          className={
                            "rounded px-1 py-0.5 text-[10px] uppercase " +
                            (j.portalEnv === "production"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground")
                          }
                        >
                          {j.portalEnv}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">(profile deleted)</span>
                    )}
                    {j.mappingName ? (
                      <span className="text-muted-foreground">· {j.mappingName}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-3 tabular-nums">
                    <span>
                      <span className="text-muted-foreground">created </span>
                      <span className="text-emerald-700 dark:text-emerald-300 font-medium">{created.toLocaleString()}</span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">updated </span>
                      <span className="text-blue-700 dark:text-blue-300 font-medium">{updated.toLocaleString()}</span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">errors </span>
                      <span className={errors > 0 ? "text-destructive font-medium" : "font-medium"}>{errors.toLocaleString()}</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </main>
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
