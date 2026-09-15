import { client, HubdbError, log, runSpike } from "./client";
import type { HubdbApiBase, HubdbPage, HubdbTable } from "../../lib/hubdb";

async function ping(base: HubdbApiBase) {
  const started = performance.now();
  try {
    const res = await client.request<HubdbPage<HubdbTable>>("/tables", { base });
    const ms = Math.round(performance.now() - started);
    return {
      base,
      ok: true as const,
      ms,
      count: res.results?.length ?? 0,
      sample: res.results?.slice(0, 5).map((t) => ({ id: t.id, name: t.name, published: t.published })),
    };
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    if (err instanceof HubdbError) {
      return { base, ok: false as const, ms, status: err.status, body: err.responseBody };
    }
    throw err;
  }
}

runSpike(async () => {
  const [v3, dated] = await Promise.all([ping("v3"), ping("dated")]);
  log("v3 /tables", v3);
  log("dated /tables", dated);
});
