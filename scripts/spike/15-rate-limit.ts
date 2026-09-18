import { createHubdbClient, HubdbError, type HubdbClient } from "../../lib/hubdb";
import { log, runSpike } from "./client";

// Rate-limit stress test — Phase-0 open question.
//
// The wrapper retries 429/5xx with exponential backoff + Retry-After, so
// in normal operation callers rarely see a 429. This spike disables
// retries and pounds `/tables?limit=1` in progressively larger bursts to
// measure:
//   1. The 429 threshold — how many concurrent requests before HubSpot
//      throttles us
//   2. The Retry-After distribution — how long the backoff should be
//   3. Whether the wrapper's reactive retry is sufficient or we need a
//      proactive token bucket
//
// Safety: reads only (GET /tables?limit=1). Sandbox portal. No writes.
//
// Between bursts we wait BURST_GAP_MS to let HubSpot's token bucket
// refill. Bursts fire N concurrent requests simultaneously via
// Promise.all, so N is the *concurrency*, not the per-second rate.

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
if (!HUBSPOT_TOKEN) throw new Error("HUBSPOT_TOKEN missing");

const BURSTS = [5, 20, 50, 100];
const BURST_GAP_MS = 15_000;

// Build a client with retries disabled so 429s surface to us instead of
// being silently retried by the wrapper.
const rawClient: HubdbClient = createHubdbClient({
  token: HUBSPOT_TOKEN,
  retry: { maxAttempts: 1 },
});

type Outcome = {
  ok: boolean;
  status: number;
  retryAfterSeconds: number | null;
  ms: number;
};

async function oneRequest(): Promise<Outcome> {
  const started = Date.now();
  try {
    await rawClient.request("/tables", { query: { limit: 1 } });
    return { ok: true, status: 200, retryAfterSeconds: null, ms: Date.now() - started };
  } catch (err) {
    if (err instanceof HubdbError) {
      return {
        ok: false,
        status: err.status,
        retryAfterSeconds: err.rateLimit.retryAfterSeconds,
        ms: Date.now() - started,
      };
    }
    throw err;
  }
}

function summarize(outcomes: Outcome[]) {
  const okCount = outcomes.filter((o) => o.ok).length;
  const throttled = outcomes.filter((o) => o.status === 429);
  const other = outcomes.filter((o) => !o.ok && o.status !== 429);
  const retryAfters = throttled
    .map((o) => o.retryAfterSeconds)
    .filter((v): v is number => v !== null);
  const durations = outcomes.map((o) => o.ms).sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  return {
    total: outcomes.length,
    ok: okCount,
    throttled: throttled.length,
    otherErrors: other.length,
    retryAfterMin: retryAfters.length ? Math.min(...retryAfters) : null,
    retryAfterMax: retryAfters.length ? Math.max(...retryAfters) : null,
    durationsMs: { p50, p95, min: durations[0], max: durations[durations.length - 1] },
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

runSpike(async () => {
  log("mode", { retriesDisabled: true, endpoint: "/tables?limit=1", bursts: BURSTS });

  const perBurst: Array<{ concurrency: number; summary: ReturnType<typeof summarize> }> = [];
  let firstThrottleConcurrency: number | null = null;

  for (const concurrency of BURSTS) {
    log(`burst ${concurrency}`, `firing ${concurrency} concurrent GETs`);
    const started = Date.now();
    const outcomes = await Promise.all(Array.from({ length: concurrency }, () => oneRequest()));
    const wallMs = Date.now() - started;
    const summary = summarize(outcomes);
    perBurst.push({ concurrency, summary });
    log(`burst ${concurrency} result`, { wallMs, ...summary });

    if (firstThrottleConcurrency === null && summary.throttled > 0) {
      firstThrottleConcurrency = concurrency;
    }

    if (concurrency !== BURSTS[BURSTS.length - 1]) {
      log("wait", `sleeping ${BURST_GAP_MS}ms for bucket refill`);
      await sleep(BURST_GAP_MS);
    }
  }

  log("summary", {
    firstThrottleConcurrency,
    perBurst: perBurst.map(({ concurrency, summary }) => ({
      concurrency,
      ok: `${summary.ok}/${summary.total}`,
      throttled: summary.throttled,
      retryAfterRange:
        summary.retryAfterMin !== null
          ? `${summary.retryAfterMin}s..${summary.retryAfterMax}s`
          : "n/a",
    })),
  });

  log("recommendation", buildRecommendation(perBurst, firstThrottleConcurrency));
});

function buildRecommendation(
  bursts: Array<{ concurrency: number; summary: ReturnType<typeof summarize> }>,
  firstThrottle: number | null,
): string {
  if (firstThrottle === null) {
    return [
      `No 429s observed at any tested concurrency (max ${bursts[bursts.length - 1].concurrency}).`,
      "The wrapper's existing reactive retry (5 attempts, Retry-After honored) is sufficient for MVP scale.",
      "If we push beyond 100 concurrent requests per portal we should retest.",
    ].join(" ");
  }
  const worst = bursts.find((b) => b.concurrency === firstThrottle)!;
  const retryHint =
    worst.summary.retryAfterMax !== null
      ? ` Retry-After was ${worst.summary.retryAfterMin}–${worst.summary.retryAfterMax}s.`
      : "";
  return [
    `HubSpot started returning 429 at ${firstThrottle} concurrent requests.${retryHint}`,
    "The wrapper's reactive retry will handle these — no user-facing errors — but wall-clock time grows linearly with the number of throttled requests.",
    "Recommendation: keep reactive retry for now. Add a proactive token bucket (~10 req/s ceiling) only if we see users complain about slow imports, which would show up as high `attempts` counts in HubdbError logs.",
  ].join(" ");
}
