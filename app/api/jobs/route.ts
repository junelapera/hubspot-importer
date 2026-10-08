import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { deleteJobs } from "@/lib/db/jobs";
import { inngest } from "@/lib/inngest/client";

export const runtime = "nodejs";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

// Bulk delete from /jobs (also used by the single-job delete button on
// /jobs/[id] with a one-element list). Running jobs are skipped — the
// caller should cancel them first — and reported back in `skipped`
// alongside ids that didn't exist.
export async function DELETE(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const body = Body.safeParse(raw);
  if (!body.success) {
    return NextResponse.json({ error: "body must be { ids: uuid[] }" }, { status: 400 });
  }

  const ids = [...new Set(body.data.ids)];
  const supabase = createSupabaseServerClient();
  let deleted;
  try {
    deleted = await deleteJobs(supabase, ids);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // Drop any Inngest run that hasn't started yet. Best-effort: if the
  // event can't be sent (dev server down), the preflight step sees the
  // missing row and no-ops instead.
  const pending = deleted.filter((j) => j.status === "queued" || j.status === "pending");
  if (pending.length > 0) {
    try {
      await inngest.send(
        pending.map((j) => ({ name: "import.execute.deleted", data: { jobId: j.id } })),
      );
    } catch (err) {
      console.warn("[jobs.delete] cancel event not sent", err);
    }
  }

  const deletedIds = new Set(deleted.map((j) => j.id));
  return NextResponse.json({
    deleted: [...deletedIds],
    skipped: ids.filter((id) => !deletedIds.has(id)),
  });
}
