const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
if (!HUBSPOT_TOKEN) {
  throw new Error("HUBSPOT_TOKEN missing. Copy .env.example → .env.local and fill in your private-app token.");
}

const BASE = "https://api.hubapi.com";

const BASE_PATHS = {
  v3: "/cms/v3/hubdb",
  dated: "/cms/hubdb/2026-03",
} as const;

export type ApiBase = keyof typeof BASE_PATHS;

export type HubdbApiOpts = {
  base?: ApiBase;
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

export class HubdbError extends Error {
  status: number;
  responseBody: unknown;
  rateLimit: { remaining?: string; retryAfter?: string };
  constructor(status: number, method: string, path: string, body: unknown, headers: Headers) {
    super(`HubDB ${method} ${path} → ${status}`);
    this.status = status;
    this.responseBody = body;
    this.rateLimit = {
      remaining: headers.get("x-hubspot-ratelimit-remaining") ?? undefined,
      retryAfter: headers.get("retry-after") ?? undefined,
    };
  }
}

export async function hubdb<T = unknown>(path: string, opts: HubdbApiOpts = {}): Promise<T> {
  const basePath = BASE_PATHS[opts.base ?? "v3"];
  const qs = opts.query
    ? "?" +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const url = `${BASE}${basePath}${path}${qs}`;
  const method = opts.method ?? "GET";
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  const parsed: unknown = isJson && text ? JSON.parse(text) : text;
  if (!res.ok) throw new HubdbError(res.status, method, path, parsed, res.headers);
  return parsed as T;
}

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
        rateLimit: err.rateLimit,
        body: err.responseBody,
      });
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
