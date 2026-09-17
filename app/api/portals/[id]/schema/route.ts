import { NextResponse, type NextRequest } from "next/server";
import { getPortalById, getPortalToken } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { createHubdbClient, fetchPortalSchema } from "@/lib/hubdb";

export const runtime = "nodejs";

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const portal = await getPortalById(supabase, id);
  if (!portal) return errorResponse(404, "portal not found");

  const token = await getPortalToken(supabase, id);
  if (!token) return errorResponse(500, "portal token is missing");

  try {
    const client = createHubdbClient({ token });
    const snapshot = await fetchPortalSchema(client);
    return NextResponse.json({
      portal: { id: portal.id, label: portal.label, env: portal.env },
      fetchedAt: snapshot.fetchedAt,
      tables: snapshot.tables,
    });
  } catch (err) {
    return errorResponse(502, `HubSpot introspection failed: ${(err as Error).message}`);
  }
}
