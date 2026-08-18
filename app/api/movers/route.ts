import { NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/adapters/quotes";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { datasetCache } from "@/lib/runtime-env";
import { summaryKey } from "@/lib/dataset-cache";
import { SP500_REVIEWED, SP500_TOP_50 } from "@/lib/sp500";
import type { WatchlistSummary } from "@/lib/watchlist-summary";

/**
 * A minute, which is as often as a grid of tiles is worth redrawing.
 *
 * Longer than the index page's thirty seconds because nothing here is a line
 * being watched tick by tick: fifty tiles all move a fraction of a percent in a
 * minute, and the reader is looking for which corner of the market is red, not
 * for the last print.
 */
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};

/**
 * Today's move for the index's largest members and for the watchlist.
 *
 * Both groups in one response: they are drawn one above the other and a partial
 * answer arriving first would only make the page rearrange itself. The
 * watchlist's unresolved entries are left out — a company with no resolvable
 * market symbol has no move to show, and a permanently grey tile in the middle
 * of a heat map reads as a market signal rather than as a missing feed.
 */
export async function GET() {
  const watchlist = DEFAULT_WATCHLIST.filter((company) => company.resolutionStatus !== "unresolved");
  const symbols = [
    ...SP500_TOP_50.map((member) => member.symbol),
    ...watchlist.map((company) => company.yahooTicker ?? company.ticker),
  ];

  try {
    const quotes = await fetchQuotes([...new Set(symbols)]);
    const bySymbol = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
    const read = (symbol: string) => bySymbol.get(symbol.toUpperCase()) ?? null;

    /*
     * Market capitalisation, computed rather than fetched.
     *
     * No free Yahoo endpoint carries it — the ones that do answer 401 without a
     * crumb — so it is price times share count, which is what a market cap is.
     * The two sides get their share count from different places on purpose: the
     * watchlist's comes from the SEC filings this application already
     * normalises, so it is as current as the last 10-Q, while the index list's
     * is static and dated. Both are only ever multiplied by a live price, and
     * both are used only to size a rectangle.
     */
    const cache = datasetCache();
    const sharesOf = async (ticker: string): Promise<number | null> => {
      try {
        const stored = await cache?.get(summaryKey(ticker), "text");
        if (!stored) return null;
        const summary = JSON.parse(stored) as WatchlistSummary;
        return summary.qsPrice?.shares ?? summary.shares ?? null;
      } catch { return null; }
    };

    const index = SP500_TOP_50.flatMap((member) => {
      const quote = read(member.symbol);
      return quote?.changePercent == null ? [] : [{
        symbol: member.symbol, label: member.label, sector: member.sector,
        price: quote.price, changePercent: quote.changePercent,
        marketCap: quote.price == null ? null : quote.price * member.shares * 1e9,
      }];
    });

    const heldShares = await Promise.all(watchlist.map((company) => sharesOf(company.ticker)));
    const held = watchlist.flatMap((company, position) => {
      const quote = read(company.yahooTicker ?? company.ticker);
      if (quote?.changePercent == null) return [];
      const shares = heldShares[position];
      return [{
        symbol: company.ticker, label: company.ticker, sector: company.sector,
        price: quote.price, changePercent: quote.changePercent,
        marketCap: quote.price != null && shares != null ? quote.price * shares : null,
      }];
    });

    if (!index.length && !held.length) {
      return NextResponse.json({ error: "No quotes are available right now." }, { status: 502, headers: { ...headers, "Cache-Control": "no-store" } });
    }
    return new Response(JSON.stringify({
      index, watchlist: held,
      // What was asked for against what came back, so the page can say a corner
      // is missing rather than quietly drawing a smaller grid.
      requested: { index: SP500_TOP_50.length, watchlist: watchlist.length },
      reviewed: SP500_REVIEWED,
    }), { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Quotes are unavailable." },
      { status: 502, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
}
