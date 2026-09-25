import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPortalById, getPortalToken } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { createHubdbClient, fetchPortalSchema } from "@/lib/hubdb";
import { computeExecutionSignature, synthesizeExecution } from "@/lib/execution";
import type { MappingState } from "@/lib/mapping";
import { createMapping, getMappingById } from "@/lib/db/mappings";
import {
  createJob,
  getJobById,
  requeueJob,
  type PublishMode,
} from "@/lib/db/jobs";
import { inngest } from "@/lib/inngest/client";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// The route now enqueues an Inngest event and returns 202 immediately.
// The Inngest handler (lib/inngest/functions/execute-import.ts) runs
// the actual import out-of-band; the client polls GET /api/jobs/[id]
// for status + final response.
//
// All up-front validation (dry-run signature, portal reachability,
// synthesis) still runs on the request thread so bad input gets a
// synchronous 4xx instead of a "queued" row that will fail later.

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  // Synthesize now so mapping-shape errors surface as a synchronous
  // 400 (not a queued job that fails later). The Inngest handler
  // re-synthesizes at run-time against a fresh portal snapshot in case
  // the schema shifted between enqueue and processing.
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

  const publish = body.data.publish as PublishMode;

  // Resume path — reuse the existing job row instead of creating one.
  if (body.data.resumeJobId) {
    let existing;
    try {
      existing = await getJobById(supabase, body.data.resumeJobId);
    } catch (err) {
      return errorResponse(500, `resume lookup failed: ${(err as Error).message}`);
    }
    if (!existing) {
      return errorResponse(404, `job ${body.data.resumeJobId} not found`);
    }
    try {
      await requeueJob(supabase, existing.id, {
        inputSources: body.data.sources,
        inputMappings: mappings,
        inputPublish: publish,
        dryRunSignature: body.data.dryRunSignature,
      });
    } catch (err) {
      return errorResponse(500, `resume requeue failed: ${(err as Error).message}`);
    }
    try {
      await inngest.send({
        name: "import.execute.requested",
        data: { jobId: existing.id },
      });
    } catch (err) {
      return errorResponse(502, `enqueue failed: ${(err as Error).message}`);
    }
    return NextResponse.json(
      { jobId: existing.id, status: "queued", resumed: true },
      { status: 202 },
    );
  }

  // Fresh run — resolve profile, create the job row in queued state.
  const resolved = await resolveMappingId(supabase, id, body.data.profileId, mappings);
  if (!resolved) {
    return errorResponse(
      500,
      "could not resolve or create a mapping row (has the F11 migration been applied?)",
    );
  }

  let jobId: string;
  try {
    const job = await createJob(supabase, {
      mappingId: resolved.mappingId,
      kind: "import",
      status: "queued",
      portalId: id,
      inputSources: body.data.sources,
      inputMappings: mappings,
      inputPublish: publish,
      dryRunSignature: body.data.dryRunSignature,
    });
    jobId = job.id;
  } catch (err) {
    return errorResponse(500, `job create failed: ${(err as Error).message}`);
  }

  try {
    await inngest.send({
      name: "import.execute.requested",
      data: { jobId },
    });
  } catch (err) {
    // We already created the job row; the client will see it in /jobs
    // as queued forever. Still return the jobId so the UI can render
    // a "stuck queued" state; the user can nudge by retriggering
    // execute (which currently creates a new job — a follow-up could
    // let us re-emit the event against the same jobId).
    return errorResponse(502, `enqueue failed: ${(err as Error).message}`, { jobId });
  }

  return NextResponse.json(
    {
      jobId,
      status: "queued",
      autoSavedProfile: resolved.autoSaved,
      portal: { id: portal.id, label: portal.label, env: portal.env },
    },
    { status: 202 },
  );
}
