import { NextResponse, type NextRequest } from "next/server";
import { getPortalById, getPortalToken } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { createHubdbClient, deleteTable, HubdbError } from "@/lib/hubdb";

export const runtime = "nodejs";

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; tableId: string }> },
) {
  const { id, tableId } = await ctx.params;
  const supabase = createSupabaseServerClient();

  const portal = await getPortalById(supabase, id);
  if (!portal) return errorResponse(404, `portal ${id} not found`);

  const token = await getPortalToken(supabase, id);
  if (!token) return errorResponse(500, "portal token is missing");
  const client = createHubdbClient({ token });

  try {
    await deleteTable(client, tableId);
  } catch (err) {
    if (err instanceof HubdbError) {
      return errorResponse(err.status === 404 ? 404 : 502, `HubDB delete failed: ${err.message}`, {
        hubspotStatus: err.status,
        hubspotBody: err.responseBody,
      });
    }
    return errorResponse(502, `HubDB delete failed: ${(err as Error).message}`);
  }

  return NextResponse.json({ ok: true, tableId });
}
