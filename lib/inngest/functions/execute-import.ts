import {
  createHubdbClient,
  fetchPortalSchema,
  HubdbError,
  importRows,
  opsFromClientForImport,
  pushLive,
  ImportCancelledError,
  ImportFailFastError,
  ImportPreflightError,
  type ImportEvent,
  type ImportResult,
} from "@/lib/hubdb";
import { synthesizeExecution } from "@/lib/execution";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { getPortalById, getPortalToken } from "@/lib/db/portals";
import {
  completeJob,
  getJobById,
  insertJobErrors,
  isCancelRequested,
  markJobRunning,
  setJobResponse,
  type JobResponsePayload,
  type JobTableTotals,
  type JobTotals,
  type PublishedEntry,
} from "@/lib/db/jobs";
import { recordBatchComplete, recordBatchStart } from "@/lib/db/job-batches";
import { upsertKeyMap } from "@/lib/db/key-maps";
import { inngest } from "@/lib/inngest/client";

// Runs the whole import out-of-band. The API route enqueues one
// "import.execute.requested" event; this function does the work with
// automatic retries + observability via Inngest.
//
// Design notes:
// - Every step reads state fresh from Supabase — Inngest steps run as
//   independent HTTP invocations, so closure state doesn't cross the
//   boundary. The jobs row is the single source of truth.
// - The `import-rows` step still has the Vercel 300s cap per attempt.
//   Inngest retries on timeout / crash — upserts are idempotent by
//   natural key, so a retry re-runs safely.
// - Cancellation: the `import-rows` step spins up a background poller
//   that watches the jobs.cancel_requested flag; when it flips, we
//   abort the import via its existing AbortSignal contract.
export const executeImport = inngest.createFunction(
  {
    id: "execute-import",
    name: "Execute HubDB import",
    // Retry the whole run twice on unhandled failure. Anything the app
    // knows how to classify (preflight/fail-fast/cancel) is caught
    // inside and finalizes the job cleanly — those don't retry.
    retries: 2,
    triggers: [{ event: "import.execute.requested" }],
  },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: string };

    // ─── Step 1: preflight ─────────────────────────────────────────
    // Load the job row, resolve portal + token, mark running.
    const preflight = await step.run("preflight", async () => {
      const supabase = createSupabaseServerClient();
      const job = await getJobById(supabase, jobId);
      if (!job) throw new Error(`job ${jobId} not found`);
      if (!job.portalId) throw new Error(`job ${jobId} has no portal_id`);
      if (!job.inputSources) throw new Error(`job ${jobId} has no input_sources`);
      if (!job.inputMappings) throw new Error(`job ${jobId} has no input_mappings`);

      const portal = await getPortalById(supabase, job.portalId);
      if (!portal) throw new Error(`portal ${job.portalId} not found`);
      const token = await getPortalToken(supabase, job.portalId);
      if (!token) throw new Error(`portal ${job.portalId} token missing`);

      await markJobRunning(supabase, jobId);

      return {
        portalId: job.portalId,
        portalLabel: portal.label,
        portalEnv: portal.env,
        publish: (job.inputPublish ?? "none") as "none" | "foreign-only" | "all",
      };
    });

    // The importRows step + all publish steps below all need a fresh
    // Supabase + HubDB client (function-local — no closure over the
    // preflight step). We rebuild them inside each step's callback.

    // ─── Step 2: import-rows ───────────────────────────────────────
    // The long one. Runs the whole importRows synchronously inside a
    // single step — durability comes from Inngest's automatic retry on
    // step failure / timeout. Upserts are idempotent by natural key,
    // so a retry safely re-runs.
    type ImportStepOk = {
      kind: "ok";
      result: ImportResult;
      events: ImportEvent[];
    };
    type ImportStepFailFast = {
      kind: "fail-fast";
      message: string;
      partial: ImportResult;
      row: unknown;
      events: ImportEvent[];
    };
    type ImportStepCancelled = {
      kind: "cancelled";
      message: string;
      partial: ImportResult;
      events: ImportEvent[];
    };
    type ImportStepPreflightError = {
      kind: "preflight";
      table: string;
      message: string;
      events: ImportEvent[];
    };
    type ImportStepHubspotError = {
      kind: "hubspot";
      message: string;
      hubspot: { status: number; path: string; method: string; body?: unknown };
      events: ImportEvent[];
    };
    type ImportStepUnknownError = {
      kind: "unknown";
      message: string;
      events: ImportEvent[];
    };
    type ImportStepOutput =
      | ImportStepOk
      | ImportStepFailFast
      | ImportStepCancelled
      | ImportStepPreflightError
      | ImportStepHubspotError
      | ImportStepUnknownError;

    const importOutput: ImportStepOutput = await step.run("import-rows", async () => {
      const supabase = createSupabaseServerClient();
      const job = await getJobById(supabase, jobId);
      if (!job) throw new Error(`job ${jobId} disappeared`);
      const token = await getPortalToken(supabase, preflight.portalId);
      if (!token) throw new Error(`portal token missing`);
      const client = createHubdbClient({ token });

      const snapshot = await fetchPortalSchema(client);
      const synth = synthesizeExecution({
        sources: job.inputSources!,
        mappings: job.inputMappings!,
        portalTables: snapshot.tables,
      });
      if (!synth.schema || synth.issues.length > 0) {
        return {
          kind: "unknown",
          message: `synthesis failed: ${JSON.stringify(synth.issues)}`,
          events: [],
        } as ImportStepUnknownError;
      }

      const events: ImportEvent[] = [];
      const controller = new AbortController();

      // Poll cancel_requested every ~1s. AbortController.abort() is a
      // no-op after the first call, so racing with a natural finish is
      // safe.
      const cancelPoll = setInterval(() => {
        isCancelRequested(supabase, jobId)
          .then((flag) => {
            if (flag) controller.abort();
          })
          .catch(() => {
            // Poll failure is best-effort — a transient DB blip
            // shouldn't crash the import. Cancel will be re-checked on
            // the next tick.
          });
      }, 1000);

      try {
        const result = await importRows(
          opsFromClientForImport(client),
          {
            schema: synth.schema,
            tableIds: synth.tableIds,
            source: synth.source,
            fkOptions: synth.fkOptions,
          },
          {
            onEvent: (e) => events.push(e),
            signal: controller.signal,
            hooks: {
              onBatchStart: async (info) =>
                recordBatchStart(supabase, {
                  jobId,
                  tableName: info.table,
                  batchIndex: info.batchIndex,
                  kind: info.kind,
                  size: info.size,
                }),
              onBatchComplete: async (info) =>
                recordBatchComplete(supabase, {
                  jobId,
                  tableName: info.table,
                  batchIndex: info.batchIndex,
                  status: info.status,
                }),
              onKeyMapReady: async (table, entries) =>
                upsertKeyMap(supabase, jobId, table, entries),
            },
          },
        );
        return { kind: "ok", result, events } as ImportStepOk;
      } catch (err) {
        if (err instanceof ImportPreflightError) {
          return {
            kind: "preflight",
            table: err.table,
            message: err.message,
            events,
          } as ImportStepPreflightError;
        }
        if (err instanceof ImportFailFastError) {
          return {
            kind: "fail-fast",
            message: err.message,
            partial: err.partial,
            row: err.row,
            events,
          } as ImportStepFailFast;
        }
        if (err instanceof ImportCancelledError) {
          return {
            kind: "cancelled",
            message: err.message,
            partial: err.partial,
            events,
          } as ImportStepCancelled;
        }
        if (err instanceof HubdbError) {
          console.error(
            `[inngest execute-import] HubDB error ${err.method} ${err.path} → ${err.status}:`,
            JSON.stringify(err.responseBody, null, 2),
          );
          return {
            kind: "hubspot",
            message: `HubSpot rejected: ${err.method} ${err.path} → ${err.status}`,
            hubspot: {
              status: err.status,
              path: err.path,
              method: err.method,
              body: err.responseBody,
            },
            events,
          } as ImportStepHubspotError;
        }
        return {
          kind: "unknown",
          message: `import failed: ${(err as Error).message}`,
          events,
        } as ImportStepUnknownError;
      } finally {
        clearInterval(cancelPoll);
      }
    });

    // ─── Step 3: publish (per table, only on ok import) ────────────
    // Publish list mirrors the current synchronous route: "foreign-only"
    // publishes everything except the last table in dependency order.
    const published: PublishedEntry[] = [];
    if (importOutput.kind === "ok" && preflight.publish !== "none") {
      const order = importOutput.result.order;
      const targets =
        preflight.publish === "all"
          ? order
          : order.slice(0, Math.max(0, order.length - 1));

      // One step per table so a publish failure retries just that
      // table, not the whole publish sweep.
      for (const name of targets) {
        const p = await step.run(`publish:${name}`, async () => {
          const supabase = createSupabaseServerClient();
          const job = await getJobById(supabase, jobId);
          if (!job) throw new Error(`job ${jobId} disappeared`);
          const token = await getPortalToken(supabase, preflight.portalId);
          if (!token) throw new Error(`portal token missing`);
          const client = createHubdbClient({ token });

          // Look the table id up fresh in the portal snapshot so a
          // schema-planner add between enqueue and publish doesn't
          // trip us.
          const snapshot = await fetchPortalSchema(client);
          const target = snapshot.tables.find((t) => t.name === name);
          if (!target) {
            return { table: name, error: `table ${name} not found in portal` };
          }
          try {
            const t = await pushLive(client, target.id);
            return { table: name, publishedAt: t.publishedAt };
          } catch (err) {
            return { table: name, error: (err as Error).message };
          }
        });
        published.push(p as PublishedEntry);
      }
    }

    // ─── Step 4: finalize ──────────────────────────────────────────
    // One consolidated write: status + totals + response payload + row
    // errors. Idempotent — Inngest retry of finalize is safe.
    await step.run("finalize", async () => {
      const supabase = createSupabaseServerClient();

      // Build the final response payload — mirrors what the old
      // synchronous execute route returned to ExecutePanel.
      const response: JobResponsePayload =
        importOutput.kind === "ok"
          ? {
              result: importOutput.result,
              events: importOutput.events,
              published,
            }
          : importOutput.kind === "fail-fast"
            ? {
                result: importOutput.partial,
                events: importOutput.events,
                published,
                row: importOutput.row as JobResponsePayload["row"],
                fail: { kind: "fail-fast", message: importOutput.message },
              }
            : importOutput.kind === "cancelled"
              ? {
                  result: importOutput.partial,
                  events: importOutput.events,
                  published,
                  fail: { kind: "cancelled", message: importOutput.message },
                }
              : {
                  // preflight / hubspot / unknown — no ImportResult,
                  // just the error shape.
                  result: {
                    order: [],
                    tables: [],
                    ok: false,
                  } as unknown as ImportResult,
                  events: importOutput.events,
                  published,
                  hubspot:
                    importOutput.kind === "hubspot"
                      ? importOutput.hubspot
                      : undefined,
                };

      await setJobResponse(supabase, jobId, response);

      // Row errors → job_errors table for /jobs UI querying.
      const rowErrors =
        importOutput.kind === "ok"
          ? importOutput.result.tables.flatMap((t) => t.errors)
          : importOutput.kind === "fail-fast" || importOutput.kind === "cancelled"
            ? importOutput.partial.tables.flatMap((t) => t.errors)
            : [];
      if (rowErrors.length > 0) {
        await insertJobErrors(supabase, jobId, rowErrors);
      }

      // Compute totals for the /jobs list card.
      const result =
        importOutput.kind === "ok"
          ? importOutput.result
          : importOutput.kind === "fail-fast" || importOutput.kind === "cancelled"
            ? importOutput.partial
            : null;
      let totals: JobTotals | null = null;
      if (result) {
        const tables: JobTableTotals[] = result.tables.map((t) => ({
          name: t.name,
          created: t.created,
          updated: t.updated,
          skipped: t.skipped,
          errors: t.errors.length,
        }));
        totals = {
          order: result.order,
          tables,
          ok: result.ok,
          publish: preflight.publish,
          publishedTables: published.filter((p) => !p.error).map((p) => p.table),
        };
      }

      // Determine the terminal status.
      const status: "succeeded" | "failed" | "cancelled" =
        importOutput.kind === "cancelled"
          ? "cancelled"
          : importOutput.kind === "ok" &&
              result?.ok &&
              published.every((p) => !p.error)
            ? "succeeded"
            : "failed";

      const errorMsg =
        importOutput.kind === "ok"
          ? result?.ok
            ? published.every((p) => !p.error)
              ? null
              : `publish had errors: ${published
                  .filter((p) => p.error)
                  .map((p) => `${p.table}: ${p.error}`)
                  .join("; ")}`
            : `${rowErrors.length} row error(s)`
          : importOutput.message;

      await completeJob(supabase, jobId, {
        status,
        totals,
        error: errorMsg,
      });
    });

    return {
      jobId,
      importKind: importOutput.kind,
      publishedCount: published.length,
    };
  },
);
