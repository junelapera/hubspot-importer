import type { SupabaseClient } from "@supabase/supabase-js";

// Persisted natural-key → row-id maps per (job, table). Written at the
// end of each table's pass-1 so a resume run doesn't have to re-fetch
// foreign tables to rebuild the maps.

export async function upsertKeyMap(
  client: SupabaseClient,
  jobId: string,
  tableName: string,
  entries: Record<string, string>,
): Promise<void> {
  const { error } = await client.from("key_maps").upsert(
    {
      job_id: jobId,
      table_name: tableName,
      entries,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "job_id,table_name" },
  );
  if (error) throw new Error(`key_maps.upsert failed: ${error.message}`);
}

// Returns { tableName → Map<normalizedKey, rowId> } for every persisted
// key map on the job. Resume preloads this into importRows so foreign
// tables don't need to be listed again.
export async function loadKeyMaps(
  client: SupabaseClient,
  jobId: string,
): Promise<Record<string, Map<string, string>>> {
  const { data, error } = await client
    .from("key_maps")
    .select("table_name, entries")
    .eq("job_id", jobId);
  if (error) throw new Error(`key_maps.list failed: ${error.message}`);
  const out: Record<string, Map<string, string>> = {};
  for (const row of (data ?? []) as { table_name: string; entries: Record<string, string> }[]) {
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(row.entries)) map.set(k, String(v));
    out[row.table_name] = map;
  }
  return out;
}
