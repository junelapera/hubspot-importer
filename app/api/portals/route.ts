import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createPortal, listPortals } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { validateHubdbToken } from "@/lib/hubdb";

// This handler decrypts and stores HubSpot tokens. Force the Node runtime so
// `lib/crypto.ts` (uses `node:crypto`) and the `ws` polyfill both work.
export const runtime = "nodejs";

const CreateBody = z.object({
  label: z.string().trim().min(1).max(100),
  env: z.enum(["sandbox", "production"]),
  hubId: z.string().trim().min(1).nullable().optional(),
  token: z.string().trim().min(10),
});

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function GET() {
  try {
    const supabase = createSupabaseServerClient();
    const portals = await listPortals(supabase);
    return NextResponse.json({ portals });
  } catch (err) {
    return errorResponse(500, (err as Error).message);
  }
}

export async function POST(req: NextRequest) {
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

  const introspection = await validateHubdbToken(parsed.data.token);
  if (!introspection.ok) {
    return errorResponse(400, `token validation failed: ${introspection.error}`, {
      hubspotStatus: introspection.status,
    });
  }

  try {
    const supabase = createSupabaseServerClient();
    const portal = await createPortal(supabase, {
      label: parsed.data.label,
      env: parsed.data.env,
      hubId: parsed.data.hubId ?? null,
      token: parsed.data.token,
      scopes: introspection.scopes,
    });
    return NextResponse.json({ portal }, { status: 201 });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("portals_label_env_uniq")) {
      return errorResponse(409, `A portal with that label already exists for env "${parsed.data.env}"`);
    }
    return errorResponse(500, message);
  }
}
