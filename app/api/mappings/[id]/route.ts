import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { MappingState } from "@/lib/mapping";
import {
  deleteMapping,
  DuplicateMappingNameError,
  getMappingById,
  updateMapping,
} from "@/lib/db/mappings";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export const runtime = "nodejs";

const UpdateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    state: z
      .record(z.string(), z.unknown())
      .refine((v) => Object.keys(v).length > 0, {
        message: "state must contain at least one source-table mapping",
      })
      .optional(),
  })
  .refine((v) => v.name !== undefined || v.state !== undefined, {
    message: "at least one of name / state must be present",
  });

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const supabase = createSupabaseServerClient();
    const profile = await getMappingById(supabase, id);
    if (!profile) return errorResponse(404, `profile ${id} not found`);
    return NextResponse.json({ profile });
  } catch (err) {
    return errorResponse(500, (err as Error).message);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(400, "invalid JSON body");
  }
  const parsed = UpdateBody.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(400, "invalid body", {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  try {
    const supabase = createSupabaseServerClient();
    const profile = await updateMapping(supabase, id, {
      name: parsed.data.name,
      state: parsed.data.state as Record<string, MappingState> | undefined,
    });
    return NextResponse.json({ profile });
  } catch (err) {
    if (err instanceof DuplicateMappingNameError) return errorResponse(409, err.message);
    return errorResponse(500, (err as Error).message);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const supabase = createSupabaseServerClient();
    await deleteMapping(supabase, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(500, (err as Error).message);
  }
}
