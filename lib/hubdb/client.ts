const DEFAULT_ORIGIN = "https://api.hubapi.com";

const BASE_PATHS = {
  v3: "/cms/v3/hubdb",
  dated: "/cms/hubdb/2026-03",
} as const;

export type HubdbApiBase = keyof typeof BASE_PATHS;

export type HubdbRateLimit = {
  remaining: number | null;
  retryAfterSeconds: number | null;
};

export class HubdbError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly responseBody: unknown;
  readonly rateLimit: HubdbRateLimit;
  readonly attempts: number;

  constructor(args: {
    status: number;
    method: string;
    path: string;
    responseBody: unknown;
    rateLimit: HubdbRateLimit;
    attempts: number;
  }) {
    super(`HubDB ${args.method} ${args.path} → ${args.status}`);
    this.name = "HubdbError";
    this.status = args.status;
    this.method = args.method;
    this.path = args.path;
    this.responseBody = args.responseBody;
    this.rateLimit = args.rateLimit;
    this.attempts = args.attempts;
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  get isServerError(): boolean {
    return this.status >= 500 && this.status < 600;
  }
}

export type HubdbRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  base?: HubdbApiBase;
  signal?: AbortSignal;
  retry?: Partial<HubdbRetryOptions>;
};

export type HubdbRetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOn: (status: number) => boolean;
};

export type HubdbClientOptions = {
  token: string;
  origin?: string;
  base?: HubdbApiBase;
  retry?: Partial<HubdbRetryOptions>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type HubdbClient = {
  request: <T = unknown>(path: string, opts?: HubdbRequestOptions) => Promise<T>;
};

const DEFAULT_RETRY: HubdbRetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  retryOn: (status) => status === 429 || (status >= 500 && status < 600),
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function readRateLimit(headers: Headers): HubdbRateLimit {
  const remainingRaw = headers.get("x-hubspot-ratelimit-remaining");
  const retryAfterRaw = headers.get("retry-after");
  const remaining = remainingRaw != null ? Number(remainingRaw) : NaN;
  const retryAfter = retryAfterRaw != null ? Number(retryAfterRaw) : NaN;
  return {
    remaining: Number.isFinite(remaining) ? remaining : null,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
  };
}

function buildQuery(query: HubdbRequestOptions["query"]): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function backoffDelay(attempt: number, retry: HubdbRetryOptions, rateLimit: HubdbRateLimit): number {
  if (rateLimit.retryAfterSeconds != null && rateLimit.retryAfterSeconds > 0) {
    return Math.min(rateLimit.retryAfterSeconds * 1000, retry.maxDelayMs);
  }
  const exp = retry.baseDelayMs * 2 ** (attempt - 1);
  const jitter = exp * 0.25 * Math.random();
  return Math.min(exp + jitter, retry.maxDelayMs);
}

export function createHubdbClient(opts: HubdbClientOptions): HubdbClient {
  if (!opts.token) throw new Error("createHubdbClient: token is required");
  const origin = opts.origin ?? DEFAULT_ORIGIN;
  const defaultBase = opts.base ?? "v3";
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const clientRetry: HubdbRetryOptions = { ...DEFAULT_RETRY, ...opts.retry };

  async function request<T>(path: string, req: HubdbRequestOptions = {}): Promise<T> {
    const base = BASE_PATHS[req.base ?? defaultBase];
    const method = req.method ?? "GET";
    const url = `${origin}${base}${path}${buildQuery(req.query)}`;
    const retry: HubdbRetryOptions = { ...clientRetry, ...req.retry };

    let attempt = 0;
    let lastRateLimit: HubdbRateLimit = { remaining: null, retryAfterSeconds: null };
    let lastStatus = 0;
    let lastBody: unknown = null;

    while (attempt < retry.maxAttempts) {
      attempt++;
      const res = await doFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: req.signal,
      });
      const text = await res.text();
      const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
      const parsed: unknown = isJson && text ? JSON.parse(text) : text;
      lastStatus = res.status;
      lastBody = parsed;
      lastRateLimit = readRateLimit(res.headers);

      if (res.ok) return parsed as T;

      if (attempt < retry.maxAttempts && retry.retryOn(res.status)) {
        await sleep(backoffDelay(attempt, retry, lastRateLimit));
        continue;
      }

      throw new HubdbError({
        status: res.status,
        method,
        path,
        responseBody: parsed,
        rateLimit: lastRateLimit,
        attempts: attempt,
      });
    }

    throw new HubdbError({
      status: lastStatus,
      method,
      path,
      responseBody: lastBody,
      rateLimit: lastRateLimit,
      attempts: attempt,
    });
  }

  return { request };
}
