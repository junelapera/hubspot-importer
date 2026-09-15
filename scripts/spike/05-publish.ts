import { client, HubdbError, log, runSpike } from "./client";
import { pushLive } from "../../lib/hubdb";

const ORDER = ["brands", "categories", "products"] as const;

async function publish(tableName: string) {
  const started = performance.now();
  try {
    const res = await pushLive(client, tableName);
    const ms = Math.round(performance.now() - started);
    return {
      table: tableName,
      ok: true as const,
      ms,
      published: res.published,
      publishedAt: res.publishedAt,
    };
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    if (err instanceof HubdbError) {
      return { table: tableName, ok: false as const, ms, status: err.status, body: err.responseBody };
    }
    throw err;
  }
}

runSpike(async () => {
  for (const name of ORDER) {
    const result = await publish(name);
    log(`publish ${name}`, result);
    if (!result.ok) {
      throw new Error(`publish failed for ${name} — stopping dependency chain`);
    }
  }
});
