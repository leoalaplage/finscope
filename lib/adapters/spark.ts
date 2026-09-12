import { z } from "zod";

/**
 * Many quotes in one request, for the one screen that needs hundreds.
 *
 * Every price on this site is fetched one company at a time, which is right
 * for a page about one company and impossible for a screener over five
 * hundred: five hundred requests from a browser is not a design, it is a
 * denial of service against ourselves and against Yahoo.
 *
 * Yahoo's own batch quote endpoint answers 401 without a session token, and
 * getting one would mean holding somebody's credentials. The spark endpoint
 * needs nothing and answers in one round trip — twenty symbols at a time,
 * measured: twenty returns in about eighty milliseconds and fifty is refused.
 * Five hundred prices is twenty-five requests and about two seconds, which is
 * a thing a scheduled job can do and a browser should not.
 *
 * The last close and the currency it is quoted in, and nothing else. The
 * valuation columns need a price and need to refuse one quoted in a currency
 * the statements are not kept in; neither needs a chart.
 */

const SparkSchema = z.object({
  spark: z.object({
    result: z.array(z.object({
      symbol: z.string(),
      response: z.array(z.object({
        meta: z.object({
          currency: z.string().nullable().optional(),
          regularMarketPrice: z.number().nullable().optional(),
          regularMarketTime: z.number().nullable().optional(),
        }),
      })).min(1),
    })).nullable(),
  }),
});

/** What the endpoint will answer for in one request, measured rather than guessed. */
export const SPARK_BATCH = 20;

export interface SparkQuote {
  /** The symbol as Yahoo returned it, which is not always the one asked for. */
  symbol: string;
  price: number | null;
  currency: string | null;
  /** The session the price belongs to, in exchange-agnostic UTC. */
  asOf: string | null;
}

const BASE_URLS = () => ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

/** A ticker as Yahoo writes it: this application's dot is Yahoo's dash. */
export const yahooSymbol = (ticker: string) => ticker.toUpperCase().replace(/\./g, "-");

async function batch(symbols: string[]): Promise<SparkQuote[]> {
  const path = `/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(","))}&range=1d&interval=1d`;
  let lastStatus = 0;
  for (const base of BASE_URLS()) {
    const response = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 FinScope/1.0" },
    });
    lastStatus = response.status;
    if (!response.ok) continue;
    const parsed = SparkSchema.parse(await response.json()).spark.result;
    if (!parsed) continue;
    return parsed.map((entry) => {
      const meta = entry.response[0].meta;
      return {
        symbol: entry.symbol,
        price: meta.regularMarketPrice ?? null,
        currency: meta.currency ?? null,
        asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1_000).toISOString().slice(0, 10) : null,
      };
    });
  }
  throw new Error(`Yahoo Finance returned ${lastStatus || "no response"}.`);
}

/**
 * Quotes for as many symbols as asked, keyed by the ticker that was asked for.
 *
 * Keyed by the *asked* ticker rather than the answered symbol, because the two
 * differ exactly where it would hurt: a reader looking for BRK.B gets an answer
 * labelled BRK-B, and a table that quietly held neither would lose the company
 * with no error anywhere.
 *
 * One failed batch costs its twenty symbols and not the other four hundred and
 * eighty: a screener over most of the index is worth having, and a screener
 * that refuses to load because one request timed out is not.
 */
export async function fetchQuotes(tickers: string[]): Promise<Map<string, SparkQuote>> {
  const found = new Map<string, SparkQuote>();
  for (let at = 0; at < tickers.length; at += SPARK_BATCH) {
    const slice = tickers.slice(at, at + SPARK_BATCH);
    const asked = new Map(slice.map((ticker) => [yahooSymbol(ticker), ticker]));
    try {
      for (const quote of await batch([...asked.keys()])) {
        const ticker = asked.get(quote.symbol.toUpperCase());
        if (ticker) found.set(ticker, quote);
      }
    } catch {
      // Left out of the map, which every reader of it already treats as "no
      // price" — the one state the valuation columns are built to refuse.
    }
  }
  return found;
}
