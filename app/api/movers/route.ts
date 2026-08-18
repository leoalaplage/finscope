import { NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/adapters/quotes";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { SP500_REVIEWED, SP500_TOP_50 } from "@/lib/sp500";

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

    const index = SP500_TOP_50.flatMap((member) => {
      const quote = read(member.symbol);
      return quote?.changePercent == null ? [] : [{
        symbol: member.symbol, label: member.label, sector: member.sector,
        price: quote.price, changePercent: quote.changePercent,
      }];
    });
    const held = watchlist.flatMap((company) => {
      const quote = read(company.yahooTicker ?? company.ticker);
      return quote?.changePercent == null ? [] : [{
        symbol: company.ticker, label: company.ticker, sector: company.sector,
        price: quote.price, changePercent: quote.changePercent,
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
