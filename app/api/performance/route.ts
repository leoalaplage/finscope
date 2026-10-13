import { fetchYahooSessions } from "@/lib/adapters/yahoo";
import { cachedJson, TODAY_SECONDS } from "@/lib/market-cache";
import { COVERED_TICKERS } from "@/lib/company-registry";
import { requestedTickers, summaryKey } from "@/lib/dataset-cache";
import { datasetCache } from "@/lib/runtime-env";
import type { WatchlistSummary } from "@/lib/watchlist-summary";
import { resolveMarketProfile } from "@/lib/market-profile";
import { performanceOf, PERFORMANCE_SHAPE, type Performance } from "@/lib/performance";

/**
 * How many companies one request may price.
 *
 * Each is ten years of daily sessions fetched and reduced to four numbers, so
 * a reader following sixty companies must not turn that into one request. The
 * page asks in batches and fills the table in as they arrive.
 */
const BATCH = 8;

/** Ten years and a margin, so the ten-year window has something to anchor on. */
const YEARS = 10;



const headers = {
  "Content-Type": "application/json",
  // The last close moves during a session, and every other window is anchored
  // on it, so the whole row is as live as its most recent point.
  "Cache-Control": `public, s-maxage=${TODAY_SECONDS}, stale-while-revalidate=3600`,
};

export interface PerformanceRow extends Performance {
  ticker: string;
  error?: string;
  sector?: string;
  name?: string;
  marketCap?: number | null;
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
        `performance:${PERFORMANCE_SHAPE}:${symbol}:${end}`,
        TODAY_SECONDS,
        async () => performanceOf((await fetchYahooSessions(symbol, start, end)).sessions),
        // A row with no price in it is an upstream hiccup, not a company with
        // no shares, and keeping it would freeze the gap for everyone.
        (value) => value.price == null ? "empty" : "full",
      );
      const performance = JSON.parse(body) as Performance;
      let summary: WatchlistSummary | null = null;
      try {
        const stored = await datasetCache()?.get(summaryKey(ticker), "text");
        if (stored) summary = JSON.parse(stored) as WatchlistSummary;
      } catch { /* Prices remain usable when the filing summary is unavailable. */ }
      const shares = summary?.qsPrice?.shares ?? summary?.shares;
      const sector = summary?.qs?.["Sector"];
      return {
        ticker, ...performance,
        name: summary?.name ?? company.name,
        sector: typeof sector === "string" && sector.trim() ? sector : company.sector,
        marketCap: performance.price != null && shares != null && Number.isFinite(shares) && shares > 0
          ? performance.price * shares : null,
      };
    } catch (error) {
      return { ticker, price: null, asOf: null, changes: {}, error: error instanceof Error ? error.message : "Prices unavailable" };
    }
  }));

  return new Response(JSON.stringify({ rows }), { headers });
}
