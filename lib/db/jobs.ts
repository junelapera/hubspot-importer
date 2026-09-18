import type { SupabaseClient } from "@supabase/supabase-js";
import type { RowError } from "../hubdb";

export type JobKind = "dry_run" | "import" | "publish";
export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

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
  kind: JobKind;
  status: JobStatus;
  totals: JobTotals | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

/**
 * `mappingName` / `portalLabel` / `portalEnv` are null when the source
 * profile has been deleted — the job persists (ON DELETE SET NULL) but
 * loses its provenance link. `portalId` mirrors the same behavior.
 */
export type JobWithMapping = JobSummary & {
  mappingName: string | null;
  portalId: string | null;
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
  kind: JobKind;
  status: JobStatus;
  totals: JobTotals | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

function toSummary(row: JobDbRow): JobSummary {
  return {
    id: row.id,
    mappingId: row.mapping_id,
    kind: row.kind,
    status: row.status,
    totals: row.totals,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export async function createJob(
  client: SupabaseClient,
  input: { mappingId: string; kind: JobKind },
): Promise<JobSummary> {
  const { data, error } = await client
    .from("jobs")
    .insert({
      mapping_id: input.mappingId,
      kind: input.kind,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(`jobs.insert failed: ${error.message}`);
  return toSummary(data as JobDbRow);
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
  return {
    ...toSummary(row),
    mappingName: row.mappings?.name ?? null,
    portalId: row.mappings?.portal_id ?? null,
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
