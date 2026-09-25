import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { getJobById } from "@/lib/db/jobs";
import { countCompletedBatches } from "@/lib/db/job-batches";

export const runtime = "nodejs";

// Polling endpoint the wizard's ExecutePanel hits every ~2s while a run
// is in flight, and reads the final response payload from once the run
// flips terminal. Serves everything the old synchronous execute route
// used to return in one shot — extracted from jobs.response, which the
// Inngest finalize step writes.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const job = await getJobById(supabase, id);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  // Best-effort — count query on an empty table returns 0; a DB blip
  // would poll again in 2s. Never let a count failure break the poll.
  let batchesDone = 0;
  try {
    batchesDone = await countCompletedBatches(supabase, id);
  } catch {
    batchesDone = 0;
  }
  return NextResponse.json({
    id: job.id,
    status: job.status,
    kind: job.kind,
    portalId: job.portalId,
    mappingId: job.mappingId,
    totals: job.totals,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    cancelRequested: job.cancelRequested,
    batchesDone,
    response: job.response,
  });
}
