import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPortalById, getPortalToken } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { createHubdbClient, fetchPortalSchema } from "@/lib/hubdb";
import { diffSchema, parseSchema, SchemaValidationError } from "@/lib/schema";

export const runtime = "nodejs";

const Body = z.object({
  schema: z.unknown(),
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
  if (!body.success) return errorResponse(400, "body must include a `schema` field");

  const supabase = createSupabaseServerClient();
  const portal = await getPortalById(supabase, id);
  if (!portal) return errorResponse(404, "portal not found");

  let schema;
  try {
    schema = parseSchema(body.data.schema);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return errorResponse(400, "schema validation failed", { issues: err.issues });
    }
    throw err;
  }

  const token = await getPortalToken(supabase, id);
  if (!token) return errorResponse(500, "portal token is missing");
  const client = createHubdbClient({ token });

  let snapshot;
  try {
    snapshot = await fetchPortalSchema(client);
  } catch (err) {
    return errorResponse(502, `HubSpot introspection failed: ${(err as Error).message}`);
  }

  const plan = diffSchema(schema, snapshot.tables);
  return NextResponse.json({
    portal: { id: portal.id, label: portal.label, env: portal.env },
    fetchedAt: snapshot.fetchedAt,
    schema,
    plan,
  });
}
