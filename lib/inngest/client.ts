import { Inngest } from "inngest";

// Single app-wide Inngest client. `id` becomes the app slug in the
// Inngest Cloud dashboard. Event keys / signing keys are picked up from
// INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY env vars in production; dev
// mode (npx inngest-cli dev) doesn't need either.
//
// `isDev` defaults to true outside of production so the /api/inngest
// route accepts unsigned pings from the CLI dev server without the
// operator having to remember INNGEST_DEV=1. In production, the signing
// key is required — Inngest raises if it's missing.
export const inngest = new Inngest({
  id: "hubspot-importer",
  isDev: process.env.NODE_ENV !== "production",
});

// The one event the API route emits — carries just the jobId; the
// Inngest handler reads all input off the jobs row.
export type ExecuteImportEvent = {
  name: "import.execute.requested";
  data: { jobId: string };
};
