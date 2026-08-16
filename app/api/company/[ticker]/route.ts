import { NextResponse } from "next/server";
import { fetchSecCompany } from "@/lib/adapters/sec";
import { CACHE_SECONDS, datasetKey, summaryKey } from "@/lib/dataset-cache";
import { summariseDataset } from "@/lib/watchlist-summary";
import { datasetCache } from "@/lib/runtime-env";


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
export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const symbol = ticker.toUpperCase();
  const cache = datasetCache();
  const key = datasetKey(symbol);
  const warming = request.headers.get("X-FinScope-Warm") === "1";

  try {
    // Backfilling a missing digest costs a parse, so only the timer pays it,
    // and only for a company cached before digests existed. A reader asking for
    // this company gets the stream and no extra work.
    if (warming && cache && !(await cache.get(summaryKey(symbol), "text"))) {
      const stored = await cache.get(key, "text");
      if (stored) {
        const summary = summariseDataset(JSON.parse(stored) as Parameters<typeof summariseDataset>[0]);
        if (summary) await cache.put(summaryKey(symbol), JSON.stringify(summary), { expirationTtl: CACHE_SECONDS });
        return new Response(stored, { headers: { ...headers, "X-FinScope-Cache": "hit" } });
      }
    }
    const warm = await cache?.get(key, "stream");
    if (warm) return new Response(warm, { headers: { ...headers, "X-FinScope-Cache": "hit" } });
  } catch {
    // A cache that misbehaves must never take the endpoint down with it.
  }

  try {
    const dataset = await fetchSecCompany(symbol);
    const body = JSON.stringify(dataset);
    try {
      // The digest is written from the same object in the same breath, so the
      // watchlist can never show a figure the company page disagrees with.
      const summary = summariseDataset(dataset);
      await Promise.all([
        cache?.put(key, body, { expirationTtl: CACHE_SECONDS }),
        summary ? cache?.put(summaryKey(symbol), JSON.stringify(summary), { expirationTtl: CACHE_SECONDS }) : undefined,
      ]);
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
