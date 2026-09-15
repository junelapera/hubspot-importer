import { describe, expect, it, vi } from "vitest";
import { validateHubdbToken } from "./introspection";

function fakeFetch(status: number, body: unknown): typeof fetch {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return vi.fn(async () =>
    new Response(bodyStr, {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("validateHubdbToken", () => {
  it("returns ok with inferred hubdb scope on 200", async () => {
    const res = await validateHubdbToken("pat-good", {
      fetch: fakeFetch(200, { results: [], paging: null }),
    });
    expect(res).toEqual({ ok: true, scopes: ["hubdb"] });
  });

  it("returns a specific error for 401", async () => {
    const res = await validateHubdbToken("pat-bad", {
      fetch: fakeFetch(401, { status: "error", message: "unauthorized" }),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(401);
    expect(res.error).toMatch(/hubdb/);
  });

  it("returns a generic error with status + body preview for other 4xx/5xx", async () => {
    const res = await validateHubdbToken("pat-500", {
      fetch: fakeFetch(500, { status: "error", message: "boom" }),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(500);
    expect(res.error).toContain("500");
  });
});
