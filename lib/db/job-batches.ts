import type { SupabaseClient } from "@supabase/supabase-js";

// Per-batch cursor persistence for resume-from-failure. One row per
// 100-row batch attempted against HubDB. Resume looks up succeeded rows
// and skips them; failed / sent-but-crashed rows are re-attempted.

export type BatchKind = "create" | "update";
export type BatchStatus = "pending" | "sent" | "succeeded" | "failed";

export type BatchStartInput = {
  jobId: string;
  tableName: string;
  batchIndex: number;
  kind: BatchKind;
  size: number;
};

export type BatchCompleteInput = {
  jobId: string;
  tableName: string;
  batchIndex: number;
  status: Exclude<BatchStatus, "pending">;
};

// Written when we're about to issue the HubSpot call. Upsert on the
// unique (job_id, table_name, batch_index) so a resume can update the
// same row (pending → sent → succeeded / failed).
export async function recordBatchStart(
  client: SupabaseClient,
  input: BatchStartInput,
): Promise<void> {
  const { error } = await client.from("job_batches").upsert(
    {
      job_id: input.jobId,
      table_name: input.tableName,
      batch_index: input.batchIndex,
      status: "sent",
      sent_at: new Date().toISOString(),
    },
    { onConflict: "job_id,table_name,batch_index" },
  );
  if (error) throw new Error(`job_batches.upsert(sent) failed: ${error.message}`);
}

export async function recordBatchComplete(
  client: SupabaseClient,
  input: BatchCompleteInput,
): Promise<void> {
  const { error } = await client
    .from("job_batches")
    .update({ status: input.status, finished_at: new Date().toISOString() })
    .eq("job_id", input.jobId)
    .eq("table_name", input.tableName)
    .eq("batch_index", input.batchIndex);
  if (error) throw new Error(`job_batches.update failed: ${error.message}`);
}

export type CompletedBatchIndex = Record<string, Set<number>>;

// Returns { tableName → Set<batchIndex> } of batches that reached
// `succeeded`. Resume skips these on the next attempt.
export async function listCompletedBatches(
  client: SupabaseClient,
  jobId: string,
): Promise<CompletedBatchIndex> {
  const { data, error } = await client
    .from("job_batches")
    .select("table_name, batch_index")
    .eq("job_id", jobId)
    .eq("status", "succeeded");
  if (error) throw new Error(`job_batches.list failed: ${error.message}`);
  const out: CompletedBatchIndex = {};
  for (const row of (data ?? []) as { table_name: string; batch_index: number }[]) {
    if (!out[row.table_name]) out[row.table_name] = new Set();
    out[row.table_name].add(row.batch_index);
  }
  return out;
}
