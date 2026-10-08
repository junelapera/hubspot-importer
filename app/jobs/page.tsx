import Link from "next/link";
import { listRecentJobs } from "@/lib/db/jobs";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { PAGE_ACCENTS, PageHeader } from "@/components/ui/page-header";
import { ErrorCard } from "@/components/ui/error-card";
import { JobsList, type JobListRow } from "./jobs-list";

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
  const sum = (j: (typeof jobs)[number], k: "created" | "updated" | "errors") =>
    j.totals?.tables.reduce((n, t) => n + t[k], 0) ?? 0;
  const rows: JobListRow[] = jobs.map((j) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    startedAt: j.startedAt,
    portalLabel: j.portalLabel,
    portalEnv: j.portalEnv,
    mappingName: j.mappingName,
    created: sum(j, "created"),
    updated: sum(j, "updated"),
    errors: sum(j, "errors"),
  }));

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

      {rows.length > 0 ? <JobsList jobs={rows} /> : null}
    </main>
  );
}
