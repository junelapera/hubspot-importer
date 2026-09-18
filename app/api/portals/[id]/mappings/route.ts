import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { MappingState } from "@/lib/mapping";
import {
  createMapping,
  DuplicateMappingNameError,
  listMappingsForPortal,
} from "@/lib/db/mappings";
import { getPortalById } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export const runtime = "nodejs";

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  state: z.record(z.string(), z.unknown()).refine((v) => Object.keys(v).length > 0, {
    message: "state must contain at least one source-table mapping",
  }),
});

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: portalId } = await ctx.params;
  try {
    const supabase = createSupabaseServerClient();
    const portal = await getPortalById(supabase, portalId);
    if (!portal) return errorResponse(404, `portal ${portalId} not found`);
    const profiles = await listMappingsForPortal(supabase, portalId);
    return NextResponse.json({ profiles });
  } catch (err) {
    return errorResponse(500, (err as Error).message);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: portalId } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(400, "invalid JSON body");
  }
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(400, "invalid body", {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }

  try {
    const supabase = createSupabaseServerClient();
    const portal = await getPortalById(supabase, portalId);
    if (!portal) return errorResponse(404, `portal ${portalId} not found`);
    const profile = await createMapping(supabase, {
      portalId,
      name: parsed.data.name,
      state: parsed.data.state as Record<string, MappingState>,
    });
    return NextResponse.json({ profile }, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateMappingNameError) {
      return errorResponse(409, err.message);
    }
    return errorResponse(500, (err as Error).message);
  }
}
