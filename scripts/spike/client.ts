import { createHubdbClient, HubdbError, type HubdbClient } from "../../lib/hubdb";

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
if (!HUBSPOT_TOKEN) {
  throw new Error("HUBSPOT_TOKEN missing. Copy .env.example → .env.local and fill in your private-app token.");
}

export const client: HubdbClient = createHubdbClient({ token: HUBSPOT_TOKEN });

export { HubdbError };
export type { HubdbClient };

export function log(label: string, value: unknown) {
  process.stdout.write(`\n=== ${label} ===\n`);
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  process.stdout.write("\n");
}

export function runSpike(fn: () => Promise<void>) {
  fn().catch((err) => {
    if (err instanceof HubdbError) {
      log(`ERROR ${err.message}`, {
        status: err.status,
        attempts: err.attempts,
        rateLimit: err.rateLimit,
        body: err.responseBody,
      });
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
