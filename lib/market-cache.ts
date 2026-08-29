import { datasetCache } from "./runtime-env";

/**
 * The market-data cache version. Bump it when the shape of a cached answer
 * changes, or when entries stored under it can no longer be trusted.
 *
 * m2: an incomplete answer is no longer stored for a day. Under m1, a batch of
 *     prices in which Yahoo had answered nothing was written to KV and served
 *     back for twenty-four hours, so one bad minute upstream removed dates
 *     that had been there a moment earlier and kept them missing all day.
 *     Bumping the version evicts every entry written under that behaviour.
 */
const VERSION = "m2";

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

/**
 * A short, stable stand-in for a long key.
 *
 * FNV-1a, because this needs to be deterministic and cheap and does not need to
 * be unforgeable — it names a cache entry. Written as an unsigned 32-bit value
 * in base 36 so it stays a handful of characters.
 */
function fingerprint(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The KV key for a market answer, kept inside the length KV will accept.
 *
 * KV refuses a key longer than 512 bytes, and refuses it in a way this code
 * could not see: the `put` throws, the catch around it swallows the failure as
 * "storing is best effort", and the endpoint is simply never cached again. A
 * batch of sixty-four fiscal dates makes a 718-byte key, which is exactly the
 * request the valuation history sends — so the one endpoint that most needed
 * the cache was the one that never used it.
 *
 * The readable head is kept for anyone reading keys with `wrangler kv key
 * list`; the fingerprint carries the rest.
 */
const MAX_KEY = 400;

export function marketKey(parts: string) {
  const key = `market:${VERSION}:${parts}`;
  if (key.length <= MAX_KEY) return key;
  return `market:${VERSION}:${parts.slice(0, 64)}:h${fingerprint(parts)}`;
}

/**
 * How complete an answer is, which decides whether and for how long it is kept.
 *
 * "full" is stored for its natural lifetime. "partial" is stored briefly: a
 * missing date may be perfectly legitimate — today on a Saturday, a session
 * before the company listed — but it may also be an upstream hiccup, and a few
 * minutes is long enough to be useful and short enough to heal. "empty" is not
 * stored at all: an answer with nothing in it is never worth serving back.
 */
export type Completeness = "full" | "partial" | "empty";

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
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  build: () => Promise<T>,
  completeness: (value: T) => Completeness = () => "full",
): Promise<{ body: string; hit: boolean }> {
  const cache = datasetCache();
  try {
    const stored = await cache?.get(marketKey(key), "text");
    if (stored) return { body: stored, hit: true };
  } catch {
    // Fall through and build it.
  }
  const value = await build();
  const body = JSON.stringify(value);
  const state = completeness(value);
  if (state !== "empty") {
    try {
      // KV's own floor is sixty seconds, so a partial answer is kept for that
      // rather than for the day a full one earns.
      await cache?.put(marketKey(key), body, { expirationTtl: state === "full" ? Math.max(60, ttlSeconds) : 60 });
    } catch {
      // Storing is best-effort; the reader still gets their answer.
    }
  }
  return { body, hit: false };
}
