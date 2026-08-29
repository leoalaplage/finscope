import { NextResponse } from "next/server";
import { fetchSecCompany } from "@/lib/adapters/sec";
import { CACHE_SECONDS, datasetKey, digestIsCurrent, summaryKey } from "@/lib/dataset-cache";
import { summariseDataset } from "@/lib/watchlist-summary";
import { datasetCache } from "@/lib/runtime-env";


/**
 * An hour at the edge, not six.
 *
 * Six hours of edge cache sat on top of a KV copy that was itself allowed to
 * age, and the two delays added up: a company rebuilt at 07:00 could still be
 * served from yesterday until early afternoon. The KV hit costs a few
 * milliseconds of CPU, so an hour buys nearly all of the protection and none of
 * the staleness, and `stale-while-revalidate` still absorbs a burst.
 */
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": `public, s-maxage=3600, stale-while-revalidate=86400`,
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
  /*
   * A request for this company to be built again, not served again.
   *
   * Every other caller wants whatever is cached, which is the entire point of
   * the cache. The scheduled refresh wants the opposite: it has already decided
   * this copy is out of date, and answering it from KV would hand it the very
   * bytes it was sent to replace — the refresh would report success and change
   * nothing, which is how a published quarter stayed invisible for a week.
   *
   * The header is not a credential and cannot be one: this endpoint is public
   * and anyone may set it. What bounds it is the condition below — a rebuild
   * happens only where the stored copy is genuinely old enough to be due one,
   * so asking for it can at most bring forward work that was going to happen
   * anyway, once per company per refresh window. Normalizing a filer is the
   * most expensive thing this application does, and an unbounded "parse this
   * again" that any caller could repeat would be a way to exhaust the Worker.
   */
  const asksRebuild = warming && request.headers.get("X-FinScope-Rebuild") === "1";
  const rebuilding = asksRebuild && cache != null && !digestIsCurrent(await cache.get(summaryKey(symbol), "text").catch(() => null));

  if (!rebuilding) {
    try {
      // Backfilling a missing digest costs a parse, so only the timer pays it,
      // and only for a company cached before digests existed. A reader asking
      // for this company gets the stream and no extra work.
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
