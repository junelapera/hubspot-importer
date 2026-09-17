import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseJson, SOURCE_PREVIEW_ROWS, validateSource } from "@/lib/source";

export const runtime = "nodejs";

const Body = z.object({
  payload: z.string().min(1, "payload is required"),
});

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function POST(req: NextRequest) {
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

  const outcome = parseJson(body.data.payload);
  if (!outcome.ok) {
    if (outcome.error.kind === "nested-value") {
      return errorResponse(400, outcome.error.message, {
        kind: outcome.error.kind,
        path: outcome.error.path,
      });
    }
    if (outcome.error.kind === "empty") {
      return errorResponse(400, "payload is empty", { kind: "empty" });
    }
    return errorResponse(400, outcome.error.message, { kind: outcome.error.kind });
  }

  const tables = outcome.result.tables.map((t) => ({
    name: t.name,
    filename: null,
    headers: t.headers,
    preview: t.rows.slice(0, SOURCE_PREVIEW_ROWS),
    rows: t.rows,
    totalRows: t.rows.length,
    detected: null,
    parseWarnings: [],
    validationWarnings: validateSource({ table: t.name, rows: t.rows }),
  }));

  return NextResponse.json({
    tables,
    warnings: outcome.result.warnings,
  });
}
