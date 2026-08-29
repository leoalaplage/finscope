import { datasetCache } from "./runtime-env";

/**
 * The market-data cache version. Bump it when the shape of a cached answer
 * changes, so a new client never reads an old body back.
 */
const VERSION = "m1";

/**
 * How long a market answer may be reused, by what it is about.
 *
 * A closing price for a past session is a settled fact and changes only when a
 * corporate action restates it, so a day is generous and still safe. Today's
 * price is not settled at all, and five minutes is the compromise between a
 * page that feels live and one request to Yahoo per React render.
 */
export const TODAY_SECONDS = 300;
export const SETTLED_SECONDS = 86_400;

/** Whether a date is today in UTC, which is what the endpoints compare against. */
export function isToday(date: string) {
  return date === new Date().toISOString().slice(0, 10);
}

export function marketKey(parts: string) {
  return `market:${VERSION}:${parts}`;
}

/**
 * A JSON answer, from KV where one has been built before.
 *
 * Prices had no cache of any kind. Every reader opening a company paid a cold
 * round trip to Yahoo for the one figure at the top of the page — measured at
 * over five seconds on production, during which the headline statistic read
 * "Loading…" and the market capitalisation read nothing at all. The `next:
 * { revalidate }` on the fetch underneath does not apply in a Worker; only the
 * edge cache did anything, and the client asked for `no-store`.
 *
 * The stored value is the response body verbatim, so a hit costs a small read
 * and no work. A cache that misbehaves is ignored rather than allowed to take
 * the endpoint down: the upstream is still there.
 */
export async function cachedJson(key: string, ttlSeconds: number, build: () => Promise<unknown>): Promise<{ body: string; hit: boolean }> {
  const cache = datasetCache();
  try {
    const stored = await cache?.get(marketKey(key), "text");
    if (stored) return { body: stored, hit: true };
  } catch {
    // Fall through and build it.
  }
  const body = JSON.stringify(await build());
  try {
    await cache?.put(marketKey(key), body, { expirationTtl: Math.max(60, ttlSeconds) });
  } catch {
    // Storing is best-effort; the reader still gets their answer.
  }
  return { body, hit: false };
}
