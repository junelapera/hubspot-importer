import { createSupabaseServerClient } from "../../lib/db/supabase";
import { log, runSpike } from "./client";

const TABLES = [
  "portals",
  "mappings",
  "jobs",
  "job_batches",
  "job_errors",
  "key_maps",
] as const;

runSpike(async () => {
  const supabase = createSupabaseServerClient();
  const started = performance.now();

  const results: Array<Record<string, unknown>> = [];
  for (const table of TABLES) {
    const t0 = performance.now();
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    const ms = Math.round(performance.now() - t0);
    if (error) {
      results.push({ table, ok: false, ms, error: { code: error.code, message: error.message } });
    } else {
      results.push({ table, ok: true, ms, count });
    }
  }

  const totalMs = Math.round(performance.now() - started);
  const allGreen = results.every((r) => r.ok);
  log("supabase ping", { totalMs, allGreen, tables: results });

  if (!allGreen) {
    throw new Error("One or more tables not reachable — see errors above");
  }
});
