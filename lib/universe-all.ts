import { fetchQuotes } from "./adapters/spark";
import { KEY_VERSION, SUMMARY_SHAPE } from "./data-version";
import { requestCompany, summaryKey } from "./dataset-cache";
import { largest, listedCompanies, marketValues, type Scope } from "./listed-universe";
import { qsValuationColumns } from "./qs-export";
import { datasetCache } from "./runtime-env";
import { UNIVERSE, UNIVERSE_AS_OF, type UniverseMember } from "./universe";
import { readServedUniverse, universeRow, type UniverseRow, type UniverseTable } from "./universe-build";
import type { WatchlistSummary } from "./watchlist-summary";
import { US1000_EXTRA_KEY } from "./covered-universe";

/**
 * The listed companies beyond the S&P 500, as rows of the same table.
 *
 * Built forty a run on the half-hourly timer, largest first, digest only — the
 * company is normalized from its filings and only its two-kilobyte digest is
 * kept (requestCompany's `digestOnly`) — so five thousand companies cost the
 * store ten megabytes, not twenty-five gigabytes. A company that cannot be
 * built (a foreign filer without US GAAP figures, a shell) is asked again
 * after a day, then two, four and so on, never every run. Rows older than five
 * weeks are rebuilt in turn; prices are refreshed a quarter of the table a run.
 */

export interface AllUniverseStore {
  builtAt: string;
  rows: Record<string, UniverseRow>;
  prices: UniverseTable["prices"];
  failed: Record<string, { at: string; tries: number }>;
  /** Where the price rotation and the absorbing of stored digests have got to. */
  cursor: number;
}

export const ALL_UNIVERSE_KEY = () => `universe-all:v1:${KEY_VERSION}.${SUMMARY_SHAPE}`;
const BUILD_PER_RUN = 40;
const ABSORB_PER_RUN = 120;
const REFRESH_AFTER_DAYS = 35;
const DAY = 86_400_000;

export async function readAllUniverse(): Promise<AllUniverseStore | null> {
  try {
    return (await datasetCache()?.get<AllUniverseStore>(ALL_UNIVERSE_KEY(), "json")) ?? null;
  } catch {
    return null;
  }
}

/** Whether a company that failed to build may be asked again: a day after the first failure, doubling each time, a month at most. */
export const retryDue = (failure: { at: string; tries: number } | undefined, now: Date) =>
  !failure || now.getTime() - Date.parse(failure.at) >= Math.min(30, 2 ** (failure.tries - 1)) * DAY;

export async function buildAllUniverseSlice(origin: string, now = new Date()): Promise<{ rows: number; built: string[]; failed: number; priced: number } | null> {
  const cache = datasetCache();
  if (!cache) return null;
  const sp500 = new Set(UNIVERSE.map((member) => member.cik));
  const listed = (await listedCompanies()).filter((member) => !sp500.has(member.cik));
  const store: AllUniverseStore = (await readAllUniverse()) ?? { builtAt: "", rows: {}, prices: {}, failed: {}, cursor: 0 };
  const byTicker = new Map(listed.map((member) => [member.ticker, member]));

  // Digests already in the store (a reader opened the company), a hundred-odd reads a run: the timer has a budget of subrequests.
  const missing = listed.filter((member) => !store.rows[member.ticker]);
  const start = missing.length ? (store.cursor * ABSORB_PER_RUN) % missing.length : 0;
  for (const member of [...missing.slice(start), ...missing.slice(0, start)].slice(0, ABSORB_PER_RUN)) {
    const digest = await cache.get<WatchlistSummary>(summaryKey(member.ticker), "json").catch(() => null);
    if (digest?.qs) { store.rows[member.ticker] = universeRow(member, digest); delete store.failed[member.ticker]; }
  }

  // Then build: the missing first, then the oldest rows.
  const stale = Object.values(store.rows).filter((row) => now.getTime() - Date.parse(row.retrievedAt) > REFRESH_AFTER_DAYS * DAY)
    .sort((left, right) => left.retrievedAt.localeCompare(right.retrievedAt)).map((row) => row.ticker);
  // The largest first, so the thousand largest are whole within a day; the order only, never a figure shown.
  const size = await marketValues().catch(() => ({} as Record<string, number>));
  const queue = [
    ...listed.filter((member) => !store.rows[member.ticker] && retryDue(store.failed[member.ticker], now))
      .sort((left, right) => (size[right.ticker] ?? 0) - (size[left.ticker] ?? 0)).map((member) => member.ticker),
    ...stale,
  ].slice(0, BUILD_PER_RUN);
  const built: string[] = [];
  let failures = 0;
  const work = [...queue];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (work.length) {
      const ticker = work.shift()!;
      const member: UniverseMember | undefined = byTicker.get(ticker);
      if (!member) continue;
      try {
        const response = await requestCompany(origin, ticker, store.rows[ticker] != null, true);
        await response.body?.cancel();
        const digest = await cache.get<WatchlistSummary>(summaryKey(ticker), "json").catch(() => null);
        if (response.ok && digest?.qs) {
          store.rows[ticker] = universeRow(member, digest);
          delete store.failed[ticker];
          built.push(ticker);
          continue;
        }
      } catch { /* Counted below. */ }
      failures++;
      const previous = store.failed[ticker];
      store.failed[ticker] = { at: now.toISOString(), tries: (previous?.tries ?? 0) + 1 };
    }
  }));

  // A company no longer listed leaves the table.
  for (const ticker of Object.keys(store.rows)) if (!byTicker.has(ticker)) delete store.rows[ticker];

  // A quarter of the prices a run: every one within two hours.
  const tickers = Object.keys(store.rows).sort();
  const quarter = Math.ceil(tickers.length / 4);
  const slice = tickers.slice((store.cursor % 4) * quarter, (store.cursor % 4 + 1) * quarter);
  const quotes = slice.length ? await fetchQuotes(slice) : new Map();
  for (const [ticker, quote] of quotes) {
    store.prices[ticker] = { price: quote.price, currency: quote.currency, asOf: quote.asOf, changePercent: quote.changePercent };
  }
  store.cursor = (store.cursor + 1) % 1_000_000;
  store.builtAt = now.toISOString();
  await cache.put(ALL_UNIVERSE_KEY(), JSON.stringify(store));
  // The thousand largest beyond the index: the consensus and the technicals are kept for them too (lib/covered-universe.ts).
  const { members } = await scopeTable("us1000", store);
  const sp500Tickers = new Set(UNIVERSE.map((member) => member.ticker));
  await cache.put(US1000_EXTRA_KEY, JSON.stringify(members.filter((member) => !sp500Tickers.has(member.ticker)))).catch(() => undefined);
  return { rows: tickers.length, built, failed: failures, priced: quotes.size };
}

/**
 * The table a scope is screened on: the S&P 500's own, or it joined with the
 * rest of the listed companies, cut to the thousand largest by market value
 * for "US 1000". Members are the scope's companies whether built yet or not,
 * so the screener can say how far along it is.
 */
export async function scopeTable(scope: Scope, held?: AllUniverseStore): Promise<{ table: UniverseTable | null; members: UniverseMember[] }> {
  const sp = await readServedUniverse();
  if (scope === "sp500") return { table: sp, members: UNIVERSE };
  const [all, listed] = await Promise.all([held ?? readAllUniverse(), listedCompanies().catch(() => [] as UniverseMember[])]);
  const sp500 = new Set(UNIVERSE.map((member) => member.cik));
  const everyone = [...UNIVERSE, ...listed.filter((member) => !sp500.has(member.cik))];
  const rows = [...(sp?.rows ?? []), ...Object.values(all?.rows ?? {})];
  const built = new Set(rows.map((row) => row.ticker));
  const prices = { ...(all?.prices ?? {}), ...(sp?.prices ?? {}) };
  const table: UniverseTable = {
    name: scope === "all" ? "All US" : "US 1000",
    asOf: UNIVERSE_AS_OF,
    builtAt: all?.builtAt ?? sp?.builtAt ?? new Date().toISOString(),
    members: everyone.length,
    rows,
    prices,
    pending: everyone.filter((member) => !built.has(member.ticker)).map((member) => member.ticker),
  };
  if (scope === "all") return { table, members: everyone };
  // The thousand largest of the companies with a price and a share count.
  const top = largest(rows, (row) => {
    const quote = prices[row.ticker];
    return qsValuationColumns(row.qsPrice, quote?.price ?? null, quote?.currency)["Market Cap"];
  });
  const members = everyone.filter((member) => top.has(member.ticker));
  return { table: { ...table, members: members.length, rows: rows.filter((row) => top.has(row.ticker)), pending: [] }, members };
}
