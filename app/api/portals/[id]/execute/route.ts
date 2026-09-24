import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPortalById, getPortalToken } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import {
  createHubdbClient,
  fetchPortalSchema,
  importRows,
  opsFromClientForImport,
  pushLive,
  ImportCancelledError,
  ImportFailFastError,
  ImportPreflightError,
  type ImportEvent,
  type ImportResult,
} from "@/lib/hubdb";
import { computeExecutionSignature, synthesizeExecution } from "@/lib/execution";
import type { MappingState } from "@/lib/mapping";
import { createMapping, getMappingById } from "@/lib/db/mappings";
import {
  completeJob,
  createJob,
  getJobById,
  insertJobErrors,
  type JobTableTotals,
  type JobTotals,
} from "@/lib/db/jobs";
import {
  recordBatchComplete,
  recordBatchStart,
} from "@/lib/db/job-batches";
import { upsertKeyMap } from "@/lib/db/key-maps";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SourceZ = z.object({
  name: z.string().min(1),
  rows: z.array(z.record(z.string(), z.string())),
});

const Body = z.object({
  sources: z.array(SourceZ).min(1),
  mappings: z.record(z.string(), z.unknown()),
  publish: z.enum(["none", "foreign-only", "all"]).optional().default("none"),
  profileId: z.string().uuid().optional(),
  // When set, this run resumes a previously-failed job — reuses its
  // jobId + mapping instead of creating new ones so /jobs history + the
  // job_batches audit trail continue on the same row.
  resumeJobId: z.string().uuid().optional(),
  // PRD F7 — client must complete a dry run first and echo the returned
  // signature. Prevents an execute against sources/mappings that were
  // never previewed.
  dryRunSignature: z.string().min(1),
});

type PublishMode = "none" | "foreign-only" | "all";

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

async function resolveMappingId(
  supabase: SupabaseClient,
  portalId: string,
  profileId: string | undefined,
  mappings: Record<string, MappingState>,
): Promise<{ mappingId: string; autoSaved: boolean } | null> {
  try {
    if (profileId) {
      const profile = await getMappingById(supabase, profileId);
      if (profile && profile.portalId === portalId) {
        return { mappingId: profile.id, autoSaved: false };
      }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const created = await createMapping(supabase, {
      portalId,
      name: `run-${stamp}`,
      state: mappings,
    });
    return { mappingId: created.id, autoSaved: true };
  } catch {
    return null;
  }
}

function summarize(
  result: ImportResult,
  publish: PublishMode,
  publishedTables: string[],
  durationMs: number,
): JobTotals {
  const tables: JobTableTotals[] = result.tables.map((t) => ({
    name: t.name,
    created: t.created,
    updated: t.updated,
    skipped: t.skipped,
    errors: t.errors.length,
  }));
  return { order: result.order, tables, ok: result.ok, publish, publishedTables, durationMs };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(400, "invalid JSON body");
  }
  const body = Body.safeParse(raw);
  if (!body.success) {
    return errorResponse(400, "invalid body", {
      issues: body.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }

  const supabase = createSupabaseServerClient();
  const portal = await getPortalById(supabase, id);
  if (!portal) return errorResponse(404, "portal not found");

  const token = await getPortalToken(supabase, id);
  if (!token) return errorResponse(500, "portal token is missing");
  const client = createHubdbClient({ token });

  let snapshot;
  try {
    snapshot = await fetchPortalSchema(client);
  } catch (err) {
    return errorResponse(502, `HubSpot introspection failed: ${(err as Error).message}`);
  }

  const mappings = body.data.mappings as Record<string, MappingState>;

  // PRD F7 — verify the client ran a dry run against these exact inputs.
  const expectedSignature = computeExecutionSignature(body.data.sources, mappings);
  if (expectedSignature !== body.data.dryRunSignature) {
    return errorResponse(
      400,
      "dry-run signature mismatch — sources or mappings changed since the last dry run; re-run it before executing",
      { expected: expectedSignature, received: body.data.dryRunSignature },
    );
  }

  const synth = synthesizeExecution({
    sources: body.data.sources,
    mappings,
    portalTables: snapshot.tables,
  });
  if (!synth.schema || synth.issues.length > 0) {
    return errorResponse(400, "cannot execute — mapping is incomplete", {
      issues: synth.issues,
    });
  }

  // Best-effort job persistence. If the F11 migration isn't applied yet, or
  // the DB is transiently unreachable, we still run the import and return
  // the result; the response echoes any persistence error so the UI can
  // surface it.
  let jobId: string | null = null;
  let persistenceError: string | null = null;
  let resolved: { mappingId: string; autoSaved: boolean } | null = null;
  if (body.data.resumeJobId) {
    // Resume path: reuse the existing job row + its mapping. Skip
    // createMapping / createJob entirely so /jobs history stays coherent.
    try {
      const existing = await getJobById(supabase, body.data.resumeJobId);
      if (!existing) {
        return errorResponse(404, `job ${body.data.resumeJobId} not found`);
      }
      jobId = existing.id;
    } catch (err) {
      persistenceError = `resume lookup failed: ${(err as Error).message}`;
    }
  } else {
    resolved = await resolveMappingId(supabase, id, body.data.profileId, mappings);
    if (resolved) {
      try {
        const job = await createJob(supabase, { mappingId: resolved.mappingId, kind: "import" });
        jobId = job.id;
      } catch (err) {
        persistenceError = `job create failed: ${(err as Error).message}`;
      }
    } else {
      persistenceError = "could not resolve or create a mapping row (has the F11 migration been applied?)";
    }
  }

  const events: ImportEvent[] = [];
  // Hooks persist per-batch cursors + per-table key maps to Supabase so
  // a future resume can (a) audit which batches succeeded and (b) skip
  // re-listing foreign tables. Hooks are best-effort inside importRows;
  // failures land on stderr via `fireHook` and never abort the run. We
  // additionally short-circuit if we already know jobId is null.
  const persistHooks = jobId
    ? {
        onBatchStart: async (info: { table: string; batchIndex: number; kind: "create" | "update"; size: number }) =>
          recordBatchStart(supabase, {
            jobId: jobId!,
            tableName: info.table,
            batchIndex: info.batchIndex,
            kind: info.kind,
            size: info.size,
          }),
        onBatchComplete: async (info: { table: string; batchIndex: number; kind: "create" | "update"; status: "succeeded" | "failed" }) =>
          recordBatchComplete(supabase, {
            jobId: jobId!,
            tableName: info.table,
            batchIndex: info.batchIndex,
            status: info.status,
          }),
        onKeyMapReady: async (table: string, entries: Record<string, string>) =>
          upsertKeyMap(supabase, jobId!, table, entries),
      }
    : undefined;
  let result: ImportResult;
  try {
    result = await importRows(
      opsFromClientForImport(client),
      {
        schema: synth.schema,
        tableIds: synth.tableIds,
        source: synth.source,
        fkOptions: synth.fkOptions,
      },
      { onEvent: (e) => events.push(e), signal: req.signal, hooks: persistHooks },
    );
  } catch (err) {
    const message =
      err instanceof ImportPreflightError
        ? `preflight failed on "${err.table}": ${err.message}`
        : err instanceof ImportFailFastError
          ? err.message
          : err instanceof ImportCancelledError
            ? err.message
            : `import failed: ${(err as Error).message}`;
    if (jobId) {
      try {
        if (err instanceof ImportFailFastError || err instanceof ImportCancelledError) {
          const allErrors = err.partial.tables.flatMap((t) => t.errors);
          await insertJobErrors(supabase, jobId, allErrors);
        }
        const status = err instanceof ImportCancelledError ? "cancelled" : "failed";
        await completeJob(supabase, jobId, { status, error: message });
      } catch (persistErr) {
        persistenceError = (persistenceError ?? "") + ` · job complete failed: ${(persistErr as Error).message}`;
      }
    }
    if (err instanceof ImportPreflightError) {
      return errorResponse(409, message, { table: err.table, events, jobId, persistenceError });
    }
    if (err instanceof ImportFailFastError) {
      // 422 — request is well-formed but the data triggered fail-fast
      // policy. Echo the failing row + the partial result so the UI can
      // render per-table totals up to the abort point.
      return errorResponse(422, message, {
        row: err.row,
        result: err.partial,
        events,
        jobId,
        persistenceError,
      });
    }
    if (err instanceof ImportCancelledError) {
      // 499 — non-standard but widely-recognized "client closed request".
      // If the client aborted the fetch (likely), they won't see this
      // response; the job row records the cancel so /jobs still tells the
      // story after the fact.
      return errorResponse(499, message, {
        cancelled: true,
        result: err.partial,
        events,
        jobId,
        persistenceError,
      });
    }
    return errorResponse(502, message, { events, jobId, persistenceError });
  }

  const published: { table: string; publishedAt?: string; error?: string }[] = [];
  const publish = body.data.publish;
  if (publish !== "none") {
    const targets =
      publish === "all"
        ? result.order
        : result.order.slice(0, Math.max(0, result.order.length - 1));

    for (const name of targets) {
      const tableId = synth.tableIds[name];
      if (!tableId) continue;
      try {
        const t = await pushLive(client, tableId);
        published.push({ table: name, publishedAt: t.publishedAt });
      } catch (err) {
        published.push({ table: name, error: (err as Error).message });
      }
    }
  }

  if (jobId) {
    const durationMs = Date.now() - startedAt;
    const publishedTables = published.filter((p) => !p.error).map((p) => p.table);
    const totals = summarize(result, publish, publishedTables, durationMs);
    const allErrors = result.tables.flatMap((t) => t.errors);
    try {
      await insertJobErrors(supabase, jobId, allErrors);
      await completeJob(supabase, jobId, {
        status: result.ok && published.every((p) => !p.error) ? "succeeded" : "failed",
        totals,
        error: result.ok ? null : `${allErrors.length} row error(s)`,
      });
    } catch (err) {
      persistenceError =
        (persistenceError ? persistenceError + " · " : "") +
        `job finalize failed: ${(err as Error).message}`;
    }
  }

  return NextResponse.json({
    portal: { id: portal.id, label: portal.label, env: portal.env },
    result,
    events,
    published,
    jobId,
    persistenceError,
    autoSavedProfile: resolved?.autoSaved ?? false,
  });
}
