import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { getJobById, requestCancel } from "@/lib/db/jobs";

export const runtime = "nodejs";

// Client fires this from the Cancel button on ExecutePanel while a run
// is in flight. Idempotent — flipping cancel_requested to true a second
// time is a no-op. The actual cancel takes effect at the next batch
// boundary inside the Inngest import-rows step, which polls this flag
// via a 1s interval and calls AbortController.abort() when set.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const job = await getJobById(supabase, id);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  if (job.status !== "queued" && job.status !== "running" && job.status !== "pending") {
    // Already terminal — nothing to cancel. Return 200 with a note so
    // the client can suppress the button and move on.
    return NextResponse.json({ status: job.status, alreadyTerminal: true });
  }
  await requestCancel(supabase, id);
  return NextResponse.json({ status: job.status, cancelRequested: true }, { status: 202 });
}
