import { NextResponse } from "next/server";
import { fetchSecCompany } from "@/lib/adapters/sec";
import { datasetCache } from "@/lib/runtime-env";

/** Companies are refiled quarterly, so a day-old normalization is still current. */
const CACHE_SECONDS = 86_400;
const KEY_VERSION = "v1";
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": `public, s-maxage=21600, stale-while-revalidate=86400`,
};

/**
 * Serves a normalized company, from KV whenever one has been built before.
 *
 * Building one is the most expensive thing this application does: the SEC
 * companyfacts document is around 12 MB, `JSON.parse` expands it into a far
 * larger object graph, and normalization runs while that graph is still alive.
 * Peak memory approaches the 128 MB Worker isolate limit, so two of these at
 * once could end the isolate outright — which is what made "Load all" fail
 * most of its batch.
 *
 * The cache hit path never parses anything. KV hands back a byte stream and it
 * goes straight out as the response body, so a warm company costs no more than
 * copying it. Only a genuine miss pays the parse, once per company per day.
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
