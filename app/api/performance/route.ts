import { fetchYahooSessions } from "@/lib/adapters/yahoo";
import { cachedJson, TODAY_SECONDS } from "@/lib/market-cache";
import { COVERED_TICKERS } from "@/lib/company-registry";
import { requestedTickers } from "@/lib/dataset-cache";
import { resolveMarketProfile } from "@/lib/market-profile";
import { performanceOf, type Performance } from "@/lib/performance";

/**
 * How many companies one request may price.
 *
 * Each is five years of daily sessions fetched and reduced to seven numbers, so
 * a reader following sixty companies must not turn that into one request. The
 * page asks in batches and fills the table in as they arrive.
 */
const BATCH = 8;

/** Five years and a margin, so the five-year window has something to anchor on. */
const YEARS = 5;

const headers = {
  "Content-Type": "application/json",
  // The last close moves during a session, and every other window is anchored
  // on it, so the whole row is as live as its most recent point.
  "Cache-Control": `public, s-maxage=${TODAY_SECONDS}, stale-while-revalidate=3600`,
};

export interface PerformanceRow extends Performance {
  ticker: string;
  error?: string;
}

/**
 * Every window's return for the companies a reader follows.
 *
 * One request per company rather than one per cell: the seven windows come out
 * of a single pass over one set of daily closes, which is the whole reason a
 * table like this is cheap enough to draw at all.
 */
export async function GET(request: Request) {
  const asked = requestedTickers(new URL(request.url).searchParams.get("tickers"), COVERED_TICKERS).slice(0, BATCH);
  const end = new Date().toISOString().slice(0, 10);
  const start = `${Number(end.slice(0, 4)) - YEARS - 1}${end.slice(4)}`;

  const rows = await Promise.all(asked.map(async (ticker): Promise<PerformanceRow> => {
    const company = resolveMarketProfile(ticker);
    if (!company) return { ticker, price: null, asOf: null, changes: {}, error: "Not a usable exchange symbol" };
    const symbol = company.yahooTicker ?? company.ticker;
    try {
      const { body } = await cachedJson(
        `performance:${symbol}:${end}`,
        TODAY_SECONDS,
        async () => performanceOf((await fetchYahooSessions(symbol, start, end)).sessions),
        // A row with no price in it is an upstream hiccup, not a company with
        // no shares, and keeping it would freeze the gap for everyone.
        (value) => value.price == null ? "empty" : "full",
      );
      return { ticker, ...JSON.parse(body) as Performance };
    } catch (error) {
      return { ticker, price: null, asOf: null, changes: {}, error: error instanceof Error ? error.message : "Prices unavailable" };
    }
  }));

  return new Response(JSON.stringify({ rows }), { headers });
}
