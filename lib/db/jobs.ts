import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportEvent, ImportResult, RowError } from "../hubdb";
import type { MappingState } from "../mapping";
import type { ExecutionSourceInput } from "../execution";

export type JobKind = "dry_run" | "import" | "publish";
export type JobStatus = "queued" | "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type PublishMode = "none" | "foreign-only" | "all";
export type PublishedEntry = { table: string; publishedAt?: string; error?: string };

// The full response payload the client rendered off the old synchronous
// execute route. Persisted onto jobs.response at finalize time so the
// polling endpoint can serve it verbatim once the run flips terminal.
export type JobResponsePayload = {
  result: ImportResult;
  events: ImportEvent[];
  published: PublishedEntry[];
  hubspot?: { status: number; path: string; method: string; body?: unknown };
  row?: RowError;
  fail?: { kind: "fail-fast" | "cancelled"; message: string };
};

/**
 * Per-table totals stored under `jobs.totals`. Mirrors the shape of
 * `TableImportResult` minus the row-error array (row errors live in
 * `job_errors` for cheap querying).
 */
export type JobTableTotals = {
  name: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
};

export type JobTotals = {
  order: string[];
  tables: JobTableTotals[];
  ok: boolean;
  publish?: "none" | "foreign-only" | "all";
  publishedTables?: string[];
  durationMs?: number;
};

export type JobSummary = {
  id: string;
  mappingId: string | null;
  portalId: string | null;
  kind: JobKind;
  status: JobStatus;
  totals: JobTotals | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  inputSources: ExecutionSourceInput[] | null;
  inputMappings: Record<string, MappingState> | null;
  inputPublish: PublishMode | null;
  dryRunSignature: string | null;
  response: JobResponsePayload | null;
  cancelRequested: boolean;
};

/**
 * `mappingName` / `portalLabel` / `portalEnv` are null when the source
 * profile has been deleted — the job persists (ON DELETE SET NULL) but
 * loses its provenance link. `portalId` on `JobSummary` is the
 * denormalized column from the runner-rework migration; callers reading
 * `.portalId` here get the joined mapping's portal_id only as a fallback
 * for legacy rows written before the migration.
 */
export type JobWithMapping = JobSummary & {
  mappingName: string | null;
  portalLabel: string | null;
  portalEnv: string | null;
};

export type JobErrorRow = {
  id: string;
  jobId: string;
  tableName: string;
  sourceIndex: number | null;
  columnName: string | null;
  kind: string;
  detail: string;
  createdAt: string;
};

type JobDbRow = {
  id: string;
  mapping_id: string | null;
  portal_id: string | null;
  kind: JobKind;
  status: JobStatus;
  totals: JobTotals | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  input_sources: ExecutionSourceInput[] | null;
  input_mappings: Record<string, MappingState> | null;
  input_publish: PublishMode | null;
  dry_run_signature: string | null;
  response: JobResponsePayload | null;
  cancel_requested: boolean | null;
};

function toSummary(row: JobDbRow): JobSummary {
  return {
    id: row.id,
    mappingId: row.mapping_id,
    portalId: row.portal_id,
    kind: row.kind,
    status: row.status,
    totals: row.totals,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    inputSources: row.input_sources,
    inputMappings: row.input_mappings,
    inputPublish: row.input_publish,
    dryRunSignature: row.dry_run_signature,
    response: row.response,
    cancelRequested: row.cancel_requested ?? false,
  };
}

export async function createJob(
  client: SupabaseClient,
  input: {
    mappingId: string;
    kind: JobKind;
    // If omitted, the row is created in the historic "running" state
    // (kept for anything that still runs synchronously — dry-runs, unit
    // tests). The Inngest execute path passes "queued" and marks running
    // itself once the preflight step fires.
    status?: JobStatus;
    portalId?: string;
    inputSources?: ExecutionSourceInput[];
    inputMappings?: Record<string, MappingState>;
    inputPublish?: PublishMode;
    dryRunSignature?: string;
  },
): Promise<JobSummary> {
  const status = input.status ?? "running";
  const { data, error } = await client
    .from("jobs")
    .insert({
      mapping_id: input.mappingId,
      portal_id: input.portalId ?? null,
      kind: input.kind,
      status,
      // started_at only when we're actually starting synchronously —
      // "queued" rows get their started_at when preflight flips them
      // running.
      started_at: status === "running" ? new Date().toISOString() : null,
      input_sources: input.inputSources ?? null,
      input_mappings: input.inputMappings ?? null,
      input_publish: input.inputPublish ?? null,
      dry_run_signature: input.dryRunSignature ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`jobs.insert failed: ${error.message}`);
  return toSummary(data as JobDbRow);
}

// Called from the Inngest preflight step to mark the job as running (it
// was queued when the API route enqueued it).
export async function markJobRunning(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from("jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`jobs.markRunning failed: ${error.message}`);
}

// Reset a job row to "queued" so the Inngest handler can re-run it.
// Used on the resume path where the client points at an existing failed /
// cancelled job. Clears totals + response so the polling endpoint doesn't
// serve stale terminal data mid-re-run.
export async function requeueJob(
  client: SupabaseClient,
  id: string,
  input: {
    inputSources: ExecutionSourceInput[];
    inputMappings: Record<string, MappingState>;
    inputPublish: PublishMode;
    dryRunSignature: string;
  },
): Promise<void> {
  const { error } = await client
    .from("jobs")
    .update({
      status: "queued",
      started_at: null,
      finished_at: null,
      totals: null,
      error: null,
      response: null,
      cancel_requested: false,
      input_sources: input.inputSources,
      input_mappings: input.inputMappings,
      input_publish: input.inputPublish,
      dry_run_signature: input.dryRunSignature,
    })
    .eq("id", id);
  if (error) throw new Error(`jobs.requeue failed: ${error.message}`);
}

// Written by the finalize step. Split from completeJob() so the response
// payload can be quite large (per-row errors + event log) without
// bloating the update semantics of completeJob's totals+status write.
export async function setJobResponse(
  client: SupabaseClient,
  id: string,
  response: JobResponsePayload,
): Promise<void> {
  const { error } = await client
    .from("jobs")
    .update({ response })
    .eq("id", id);
  if (error) throw new Error(`jobs.setResponse failed: ${error.message}`);
}

// POST /api/jobs/[id]/cancel flips this; the importRows onBatchStart hook
// polls it and throws ImportCancelledError when set.
export async function requestCancel(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from("jobs")
    .update({ cancel_requested: true })
    .eq("id", id);
  if (error) throw new Error(`jobs.requestCancel failed: ${error.message}`);
}

export async function isCancelRequested(
  client: SupabaseClient,
  id: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("jobs")
    .select("cancel_requested")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`jobs.isCancelRequested failed: ${error.message}`);
  return Boolean((data as { cancel_requested: boolean | null } | null)?.cancel_requested);
}

export async function completeJob(
  client: SupabaseClient,
  id: string,
  input: { status: JobStatus; totals?: JobTotals | null; error?: string | null },
): Promise<void> {
  const { error } = await client
    .from("jobs")
    .update({
      status: input.status,
      totals: input.totals ?? null,
      error: input.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`jobs.update failed: ${error.message}`);
}

export async function insertJobErrors(
  client: SupabaseClient,
  jobId: string,
  errors: readonly RowError[],
): Promise<void> {
  if (errors.length === 0) return;
  const rows = errors.map((e) => ({
    job_id: jobId,
    table_name: e.table,
    source_index: e.sourceIndex,
    column_name: e.column ?? null,
    kind: e.kind,
    detail: e.detail,
  }));
  const { error } = await client.from("job_errors").insert(rows);
  if (error) throw new Error(`job_errors.insert failed: ${error.message}`);
}

type JobJoinRow = JobDbRow & {
  mappings: { name: string; portal_id: string; portals: { label: string; env: string } | null } | null;
};

function toJobWithMapping(row: JobJoinRow): JobWithMapping {
  const summary = toSummary(row);
  return {
    ...summary,
    // Prefer the denormalized column; fall back to the mapping's portal_id
    // for legacy rows written before the runner-rework migration.
    portalId: summary.portalId ?? row.mappings?.portal_id ?? null,
    mappingName: row.mappings?.name ?? null,
    portalLabel: row.mappings?.portals?.label ?? null,
    portalEnv: row.mappings?.portals?.env ?? null,
  };
}

export async function listRecentJobs(
  client: SupabaseClient,
  limit = 50,
): Promise<JobWithMapping[]> {
  const { data, error } = await client
    .from("jobs")
    .select("*, mappings(name, portal_id, portals(label, env))")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`jobs.list failed: ${error.message}`);
  return (data as JobJoinRow[]).map(toJobWithMapping);
}

export async function getJobById(
  client: SupabaseClient,
  id: string,
): Promise<JobWithMapping | null> {
  const { data, error } = await client
    .from("jobs")
    .select("*, mappings(name, portal_id, portals(label, env))")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`jobs.get failed: ${error.message}`);
  return data ? toJobWithMapping(data as JobJoinRow) : null;
}

type JobErrorDbRow = {
  id: string;
  job_id: string;
  table_name: string;
  source_index: number | null;
  column_name: string | null;
  kind: string;
  detail: string;
  created_at: string;
};

export async function listJobErrors(
  client: SupabaseClient,
  jobId: string,
): Promise<JobErrorRow[]> {
  const { data, error } = await client
    .from("job_errors")
    .select("*")
    .eq("job_id", jobId)
    .order("table_name", { ascending: true })
    .order("source_index", { ascending: true });
  if (error) throw new Error(`job_errors.list failed: ${error.message}`);
  return (data as JobErrorDbRow[]).map((r) => ({
    id: r.id,
    jobId: r.job_id,
    tableName: r.table_name,
    sourceIndex: r.source_index,
    columnName: r.column_name,
    kind: r.kind,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}
