import { NextResponse, type NextRequest } from "next/server";
import {
  duplicateMapping,
  DuplicateMappingNameError,
  MappingNotFoundError,
} from "@/lib/db/mappings";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export const runtime = "nodejs";

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const supabase = createSupabaseServerClient();
    const profile = await duplicateMapping(supabase, id);
    return NextResponse.json({ profile }, { status: 201 });
  } catch (err) {
    if (err instanceof MappingNotFoundError) return errorResponse(404, err.message);
    if (err instanceof DuplicateMappingNameError) return errorResponse(409, err.message);
    return errorResponse(500, (err as Error).message);
  }
}
