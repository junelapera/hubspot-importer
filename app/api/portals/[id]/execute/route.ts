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
  ImportPreflightError,
  type ImportEvent,
  type ImportResult,
} from "@/lib/hubdb";
import { synthesizeExecution } from "@/lib/execution";
import type { MappingState } from "@/lib/mapping";

export const runtime = "nodejs";

const SourceZ = z.object({
  name: z.string().min(1),
  rows: z.array(z.record(z.string(), z.string())),
});

const Body = z.object({
  sources: z.array(SourceZ).min(1),
  mappings: z.record(z.string(), z.unknown()),
  publish: z.enum(["none", "foreign-only", "all"]).optional().default("none"),
});

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
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

  const events: ImportEvent[] = [];
  let result: ImportResult;
  try {
    result = await importRows(
      opsFromClientForImport(client),
      { schema: synth.schema, tableIds: synth.tableIds, source: synth.source },
      { onEvent: (e) => events.push(e) },
    );
  } catch (err) {
    if (err instanceof ImportPreflightError) {
      return errorResponse(409, `preflight failed on "${err.table}": ${err.message}`, {
        table: err.table,
        events,
      });
    }
    return errorResponse(502, `import failed: ${(err as Error).message}`, { events });
  }

  const published: { table: string; publishedAt?: string; error?: string }[] = [];
  const publish = body.data.publish;
  if (publish !== "none") {
    // Determine which tables to publish. "foreign-only" = everything
    // except the last table in dep order (the main table). This is a
    // rough heuristic that fits the products→brands+categories case;
    // richer selection is F9 territory.
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

  return NextResponse.json({
    portal: { id: portal.id, label: portal.label, env: portal.env },
    result,
    events,
    published,
  });
}
