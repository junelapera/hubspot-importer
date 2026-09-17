import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPortalById, getPortalToken } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import {
  createHubdbClient,
  fetchPortalSchema,
  listAllDraftRows,
  type HubdbRow,
} from "@/lib/hubdb";
import { computeDryRun, type DryRunSource } from "@/lib/dry-run";
import type { MappingState } from "@/lib/mapping";

export const runtime = "nodejs";

// The mapping shape is enforced client-side via the lib types; on the wire
// we accept `unknown` and let the pure planner tolerate whatever it gets.
const SourceZ = z.object({
  name: z.string().min(1),
  headers: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.string())),
});

const Body = z.object({
  sources: z.array(SourceZ).min(1),
  mappings: z.record(z.string(), z.unknown()),
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

  // Fetch existing draft rows only for target tables that a mapping actually points at
  const mappings = body.data.mappings as Record<string, MappingState>;
  const targetNames = new Set<string>();
  for (const m of Object.values(mappings)) {
    if (m?.targetTableName) targetNames.add(m.targetTableName);
  }
  const existingRowsByTarget: Record<string, HubdbRow[]> = {};
  const readErrors: Record<string, string> = {};
  await Promise.all(
    Array.from(targetNames).map(async (name) => {
      const t = snapshot.tables.find((x) => x.name === name);
      if (!t) return;
      try {
        existingRowsByTarget[name] = await listAllDraftRows(client, t.id);
      } catch (err) {
        readErrors[name] = (err as Error).message;
        existingRowsByTarget[name] = [];
      }
    }),
  );

  const sources: DryRunSource[] = body.data.sources;
  const report = computeDryRun({
    sources,
    mappings,
    portalTables: snapshot.tables,
    existingRowsByTarget,
  });

  return NextResponse.json({
    portal: { id: portal.id, label: portal.label, env: portal.env },
    fetchedAt: snapshot.fetchedAt,
    report,
    readErrors: Object.keys(readErrors).length ? readErrors : undefined,
  });
}
