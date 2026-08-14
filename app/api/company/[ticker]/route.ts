import { NextResponse } from "next/server";
import { fetchSecCompany } from "@/lib/adapters/sec";
import { datasetCache } from "@/lib/runtime-env";

/** Companies are refiled quarterly, so a day-old normalization is still current. */
const CACHE_SECONDS = 86_400;
// Bump whenever normalization changes what a cached company contains, so warm
// entries built by the previous mapping are retired instead of being served.
// v2: capital expenditures gained fallback concepts, restoring free cash flow
// for filers that stopped tagging property purchases.
const KEY_VERSION = "v2";
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": `public, s-maxage=21600, stale-while-revalidate=86400`,
};

/**
 * Serves a normalized company, from KV whenever one has been built before.
 *
 * Building one is by far the most expensive thing this application does. The
 * SEC companyfacts document is around 12 MB, and parsing and normalizing it
 * cost a median of 186 ms of CPU and up to 548 ms — measured from Worker
 * telemetry, not estimated. That is enormous for a Worker, and under load the
 * platform started refusing invocations outright with `exceededCpu`, which is
 * what made "Load all" fail most of its batch.
 *
 * The cache hit path never parses anything. KV hands back a byte stream and it
 * goes straight out as the response body, so a warm company costs no more than
 * copying it: the same telemetry puts a warm request at 1-6 ms of CPU, around
 * sixty times cheaper. Only a genuine miss pays the parse, once per day.
 */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const symbol = ticker.toUpperCase();
  const cache = datasetCache();
  const key = `company:${KEY_VERSION}:${symbol}`;

  try {
    const warm = await cache?.get(key, "stream");
    if (warm) return new Response(warm, { headers: { ...headers, "X-FinScope-Cache": "hit" } });
  } catch {
    // A cache that misbehaves must never take the endpoint down with it.
  }

  try {
    const dataset = await fetchSecCompany(symbol);
    const body = JSON.stringify(dataset);
    try {
      await cache?.put(key, body, { expirationTtl: CACHE_SECONDS });
    } catch {
      // Storing is best-effort; the reader still gets their answer.
    }
    return new Response(body, { headers: { ...headers, "X-FinScope-Cache": "miss" } });
  } catch (error) {
    const message = error instanceof Error && error.name === "ZodError"
      ? "The SEC response did not match the expected schema."
      : error instanceof Error ? error.message : "Unable to load company.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
