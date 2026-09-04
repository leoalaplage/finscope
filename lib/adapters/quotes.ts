import { z } from "zod";

/**
 * Today's move for many tickers at once.
 *
 * The chart endpoint next door answers one symbol per request, which is right
 * for a page showing one line and hopeless for a heat map of fifty. This uses
 * the multi-symbol endpoint instead: it returns a session's meta for a batch,
 * which is all a tile needs — the last price and the close before it.
 *
 * It is deliberately *not* the quote endpoint, which is the obvious choice and
 * answers 401 without a crumb obtained from a cookie handshake. Faking that
 * handshake would be a second thing to keep working and a clearer statement
 * that we are not a client Yahoo invited; this endpoint answers plainly.
 */

const SparkSchema = z.object({
  spark: z.object({
    result: z.array(z.object({
      symbol: z.string(),
      response: z.array(z.object({
        meta: z.object({
          symbol: z.string(),
          currency: z.string().optional(),
          shortName: z.string().optional(),
          longName: z.string().optional(),
          regularMarketPrice: z.number().nullable().optional(),
          chartPreviousClose: z.number().nullable().optional(),
          regularMarketVolume: z.number().nullable().optional(),
          regularMarketTime: z.number().nullable().optional(),
        }),
      })),
    })).nullable(),
    error: z.unknown().nullable(),
  }),
});

export interface Quote {
  symbol: string;
  name: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string;
  asOf: string | null;
}

const BASE_URLS = () => [process.env.YAHOO_FINANCE_BASE_URL || "https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

/**
 * How many symbols one request may carry.
 *
 * Twenty is the endpoint's own ceiling — twenty-one is refused outright with
 * "Number of symbols…", not truncated — so this is a measured limit rather
 * than a chosen one. Fifty companies is therefore three requests, which is the
 * difference between a heat map that loads and one that gets us rate-limited.
 */
export const QUOTE_BATCH = 20;

export function batched<T>(items: T[], size = QUOTE_BATCH): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

async function fetchBatch(symbols: string[]): Promise<Quote[]> {
  const query = `/v7/finance/spark?symbols=${symbols.map(encodeURIComponent).join(",")}&range=1d&interval=1d`;
  let lastStatus = 0;
  for (const base of BASE_URLS()) {
    const response = await fetch(`${base}${query}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 FinScope/1.0" },
    });
    lastStatus = response.status;
    if (!response.ok) continue;
    const parsed = SparkSchema.parse(await response.json());
    const results = parsed.spark.result;
    if (!results) continue;
    return results.flatMap((item) => {
      const meta = item.response[0]?.meta;
      if (!meta) return [];
      const price = meta.regularMarketPrice ?? null;
      // Over a one-day range this is the close of the session before it, which
      // is what "up today" is measured against.
      const previousClose = meta.chartPreviousClose ?? null;
      return [{
        symbol: item.symbol,
        name: meta.shortName ?? meta.longName ?? item.symbol,
        price,
        previousClose,
        change: price != null && previousClose != null ? price - previousClose : null,
        changePercent: price != null && previousClose != null && previousClose !== 0 ? (price - previousClose) / previousClose : null,
        currency: meta.currency ?? "USD",
        asOf: meta.regularMarketTime == null ? null : new Date(meta.regularMarketTime * 1000).toISOString(),
      }];
    });
  }
  throw new Error(`Yahoo Finance returned ${lastStatus || "no response"}.`);
}

/**
 * Every symbol's session, in as few requests as the endpoint allows.
 *
 * Batches run one after another rather than all at once: three parallel
 * requests to the same upstream from one Worker is the pattern most likely to
 * be refused, and the whole set still lands well inside a second.
 *
 * A batch that fails is skipped rather than thrown, because a heat map missing
 * a corner is worth far more than one missing entirely — the caller can see
 * which symbols came back and say so.
 */
export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const quotes: Quote[] = [];
  for (const batch of batched(symbols)) {
    try {
      quotes.push(...await fetchBatch(batch));
    } catch {
      // Left out of the answer; the caller reports the gap.
    }
  }
  return quotes;
}
