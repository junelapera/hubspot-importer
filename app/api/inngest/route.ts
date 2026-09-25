import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { executeImport } from "@/lib/inngest/functions/execute-import";

// The Inngest webhook endpoint. Inngest Cloud POSTs to /api/inngest for
// each step of a registered function; GET is used by the dashboard to
// introspect the registered function list; PUT is the register call the
// Inngest CLI + Cloud use to sync function metadata.
//
// This runs as a Node runtime function (not Edge) — Inngest's serve
// adapter needs Node crypto for HMAC signing verification.
export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [executeImport],
});
