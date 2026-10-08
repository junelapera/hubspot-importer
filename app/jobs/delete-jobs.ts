// Client-side wrapper for DELETE /api/jobs, shared by the /jobs list and
// the /jobs/[id] delete button.
export async function deleteJobsRequest(
  ids: string[],
): Promise<{ deleted: string[]; skipped: string[] }> {
  const res = await fetch("/api/jobs", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    deleted?: string[];
    skipped?: string[];
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return { deleted: body.deleted ?? [], skipped: body.skipped ?? [] };
}
