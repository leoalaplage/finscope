import { NextResponse } from "next/server";
import { fetchMarketWindow, MARKET_RANGES, type MarketRange } from "@/lib/adapters/intraday";
import { INDICES } from "@/lib/indices";

/**
 * How long an intraday answer may be reused.
 *
 * Short, because the page it feeds claims to be live, and long enough that a
 * reader watching the market does not turn into one request to Yahoo every
 * time React re-renders. Thirty seconds is finer than the five-minute bars
 * underneath it, so nothing is ever hidden by the cache that the data itself
 * would have shown.
 */
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
  Vary: "Accept-Encoding",
};

/**
 * All three indices in one response.
 *
 * One request rather than three: the page shows them side by side and has no
 * use for a partial answer arriving first, and three parallel requests to the
 * same upstream is the pattern most likely to get this Worker rate-limited.
 *
 * A failed index is returned as an error beside its label rather than taking
 * the other two down with it — one exchange feed going quiet should cost one
 * panel, not the page.
 */
export async function GET(request: Request) {
  // An unknown window is answered with the day rather than an error: the
  // parameter comes from a link a reader may have edited, and a market page
  // that refuses to load is worse than one showing today.
  const asked = new URL(request.url).searchParams.get("range");
  const range: MarketRange = MARKET_RANGES.includes(asked as MarketRange) ? asked as MarketRange : "1D";

  const snapshots = await Promise.all(INDICES.map(async (index) => {
    try {
      return { id: index.id, ...await fetchMarketWindow(index.symbol, index.label, range), description: index.description };
    } catch (error) {
      return { id: index.id, symbol: index.symbol, name: index.label, description: index.description, range, error: error instanceof Error ? error.message : "Unavailable." };
    }
  }));
  const anyUsable = snapshots.some((snapshot) => !("error" in snapshot));
  if (!anyUsable) {
    return NextResponse.json({ indices: snapshots, error: "No index data is available right now." }, { status: 502, headers: { ...headers, "Cache-Control": "no-store" } });
  }
  return new Response(JSON.stringify({ indices: snapshots }), { headers });
}
