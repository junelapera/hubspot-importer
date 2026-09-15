import { createHubdbClient, HubdbError, type HubdbClientOptions } from "./client";
import type { HubdbPage, HubdbTable } from "./types";

export type IntrospectionResult =
  | { ok: true; scopes: string[] }
  | { ok: false; error: string; status?: number };

export type IntrospectionOptions = Pick<HubdbClientOptions, "fetch" | "origin">;

/**
 * Best-effort token check for `POST /api/portals` (F1). Hits
 * `/cms/v3/hubdb/tables?limit=1` — the smallest read that requires the
 * `hubdb` scope. A 200 means the token is valid AND has read access; a 401
 * means one of those is missing.
 *
 * We can't introspect a private-app token's scope list via the API (HubSpot
 * only exposes that for OAuth tokens), so `scopes` is inferred as
 * `["hubdb"]` on success. Hub ID is left to the caller to gather / paste.
 */
export async function validateHubdbToken(
  token: string,
  opts: IntrospectionOptions = {},
): Promise<IntrospectionResult> {
  const client = createHubdbClient({
    token,
    fetch: opts.fetch,
    origin: opts.origin,
    retry: { maxAttempts: 1 },
  });
  try {
    await client.request<HubdbPage<HubdbTable>>("/tables", { query: { limit: 1 } });
    return { ok: true, scopes: ["hubdb"] };
  } catch (err) {
    if (err instanceof HubdbError) {
      if (err.status === 401) {
        return {
          ok: false,
          status: 401,
          error: "Token is invalid or missing the required `hubdb` scope",
        };
      }
      const detail =
        typeof err.responseBody === "string"
          ? err.responseBody.slice(0, 200)
          : JSON.stringify(err.responseBody).slice(0, 200);
      return { ok: false, status: err.status, error: `HubSpot returned ${err.status}: ${detail}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}
