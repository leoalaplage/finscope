import { fetchQuotes } from "./adapters/spark";
import { KEY_VERSION, SUMMARY_SHAPE } from "./data-version";
import { requestCompany, summaryKey } from "./dataset-cache";
import { datasetCache } from "./runtime-env";
import { UNIVERSE, UNIVERSE_AS_OF, UNIVERSE_NAME, type UniverseMember } from "./universe";
import type { WatchlistSummary } from "./watchlist-summary";

/**
 * The index, scored, as one object a browser can fetch in a single request.
 *
 * Five hundred digests is nine hundred kilobytes and five hundred KV reads;
 * five hundred prices from a browser is five hundred requests. Neither belongs
 * on a reader's critical path, so both happen on a timer and the answer is one
 * value in the store: the reader pays one request and the engine runs in their
 * browser over the whole table, exactly as it does over a watchlist today.
 *
 * Built a slice at a time rather than all at once. A company costs about a
 * quarter of a second of processor time to normalize — measured, not
 * estimated — so the whole index is about two minutes of it, and a scheduled
 * invocation is allowed thirty seconds. Forty a run against a half-hourly
 * schedule fills the table in an afternoon and keeps it filled for ever after,
 * which is the right shape for a thing nobody is waiting on.
 *
 * Staying filled is nearly free: the filing watcher already reads the whole of
 * EDGAR's recent-filings feed in one request, so noticing that one of five
 * hundred companies has reported costs the same as noticing it for one of
 * twenty-seven.
 */

/**
 * The stored table's shape, versioned as every stored shape here is.
 *
 * It carries the dataset version and the digest shape too: a table built from
 * digests under older semantics must never be read back as though it were
 * built under these.
 */
export const UNIVERSE_SHAPE = "u1";
export const universeKey = () => `universe:${UNIVERSE_SHAPE}.${KEY_VERSION}.${SUMMARY_SHAPE}`;

/** How many companies one scheduled run may normalize. */
export const BUILD_PER_RUN = 40;

export interface UniverseRow {
  ticker: string;
  /** The index's own name for it, which is there before anything is built. */
  name: string;
  /** The engine's input columns, exactly as a watchlist row carries them. */
  qs: WatchlistSummary["qs"];
  /** What a price has to be multiplied by, and the currency it must be in. */
  qsPrice: WatchlistSummary["qsPrice"];
  /** When the filings behind this row were read. */
  retrievedAt: string;
}

export interface UniverseTable {
  /** The index this is, and when its membership was taken. */
  name: string;
  asOf: string;
  /** When the table was last written, and what it holds. */
  builtAt: string;
  members: number;
  rows: UniverseRow[];
  /** Prices, kept beside the rows so one request carries both. */
  prices: Record<string, { price: number | null; currency: string | null; asOf: string | null }>;
  /** Companies the index lists that have no digest yet, named rather than hidden. */
  pending: string[];
}

const row = (member: UniverseMember, digest: WatchlistSummary): UniverseRow => ({
  ticker: member.ticker,
  name: member.name,
  qs: digest.qs,
  qsPrice: digest.qsPrice,
  retrievedAt: digest.retrievedAt,
});

export async function readUniverse(): Promise<UniverseTable | null> {
  try {
    return (await datasetCache()?.get(universeKey(), "json")) as UniverseTable | null;
  } catch {
    return null;
  }
}

/**
 * Which companies the next run should read.
 *
 * Anything with no row at all first, in the order the index lists them, so the
 * table fills predictably rather than at random; then the rows whose filings
 * were read longest ago, which is what keeps a full table from ageing. A
 * company whose digest is already the newest thing in the store is never asked
 * for again by this path — that is the filing watcher's job, and it does it
 * within half an hour of a report rather than whenever the rotation comes
 * round.
 */
export function nextToBuild(table: UniverseTable | null, limit = BUILD_PER_RUN): string[] {
  const held = new Map((table?.rows ?? []).map((each) => [each.ticker, each.retrievedAt]));
  const missing = UNIVERSE.filter((member) => !held.has(member.ticker)).map((member) => member.ticker);
  if (missing.length >= limit) return missing.slice(0, limit);
  const oldest = [...held.entries()]
    .sort((left, right) => left[1].localeCompare(right[1]))
    .map(([ticker]) => ticker);
  return [...missing, ...oldest].slice(0, limit);
}

/**
 * One run: read some companies, price the whole index, write the table.
 *
 * The digests are read back from the store rather than from the build's own
 * answer, because the build's answer is a six-megabyte dataset and the digest
 * beside it is two kilobytes. A company that fails to build is left out of the
 * table and named in `pending`, which is what the screener shows: a grade over
 * four hundred of five hundred companies is a different statement from a grade
 * over all of them, and the reader is told which they are looking at.
 */
export async function buildUniverseSlice(origin: string, limit = BUILD_PER_RUN): Promise<UniverseTable | null> {
  const cache = datasetCache();
  if (!cache) return null;

  const table = await readUniverse();
  const rows = new Map((table?.rows ?? []).map((each) => [each.ticker, each]));
  const byTicker = new Map(UNIVERSE.map((member) => [member.ticker, member]));

  for (const ticker of nextToBuild(table, limit)) {
    const member = byTicker.get(ticker);
    if (!member) continue;
    try {
      // Warm rather than rebuild: this asks for the company to exist in the
      // store, and the endpoint decides whether anything has to be normalized.
      const response = await requestCompany(origin, ticker);
      await response.body?.cancel();
      const digest = (await cache.get(summaryKey(ticker), "json")) as WatchlistSummary | null;
      if (digest?.qs) rows.set(ticker, row(member, digest));
    } catch {
      // Left where it was: an unbuilt company stays pending, and a built one
      // keeps the row it had rather than being dropped for one bad minute.
    }
  }

  const quotes = await fetchQuotes(UNIVERSE.map((member) => member.ticker));
  const prices: UniverseTable["prices"] = {};
  for (const [ticker, quote] of quotes) {
    prices[ticker] = { price: quote.price, currency: quote.currency, asOf: quote.asOf };
  }

  const next: UniverseTable = {
    name: UNIVERSE_NAME,
    asOf: UNIVERSE_AS_OF,
    builtAt: new Date().toISOString(),
    members: UNIVERSE.length,
    rows: UNIVERSE.map((member) => rows.get(member.ticker)).filter((each): each is UniverseRow => each != null),
    prices,
    pending: UNIVERSE.filter((member) => !rows.has(member.ticker)).map((member) => member.ticker),
  };

  try {
    await cache.put(universeKey(), JSON.stringify(next));
  } catch {
    // The slice is lost and the next run reads the same companies again, which
    // is slower and not wrong. Failing the run here would lose the prices too.
  }
  return next;
}
