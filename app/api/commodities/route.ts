import { NextResponse } from "next/server";
import { fetchMarketWindow } from "@/lib/adapters/intraday";
import { COMMODITIES } from "@/lib/commodities";
import { cachedJson } from "@/lib/market-cache";

/**
 * Six prices, fetched once for everybody rather than once per reader.
 *
 * The indices beside these are read every thirty seconds because the page they
 * are on claims to be live and three symbols is a request this Worker can
 * afford at that pace. Six more at the same pace is nine calls to one upstream
 * on every cold render, which is the shape most likely to get this Worker
 * refused — and a barrel of oil does not move enough in five minutes to be
 * worth that. So the answer is built once and kept in the store, where every
 * edge reads the same copy.
 *
 * Fetched one after another rather than all at once, for the same reason. A
 * cold build takes about two seconds; it happens once per interval, and the
 * rest of the page does not wait on it.
 */
const TTL_SECONDS = 300;
/**
 * The stored answer's shape, versioned as every stored shape here is.
 *
 * v2 carries how finely each contract is quoted. A copy written under v1 has
 * no such field, and a page reading one printed gas to the cent — a digit
 * short of how it trades.
 */
const SHAPE = "v2";

/*
 * How long each cache may hold this, said rather than left to a heuristic.
 *
 * `s-maxage` alone tells the edge and says nothing to the browser, which then
 * decides for itself — and a browser holding yesterday's shape is how a field
 * added to this answer went unread while the endpoint returned it correctly.
 * A minute in the reader's own cache, five at the edge, and the shape version
 * in the stored key for the case where neither is the problem.
 */
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": `public, max-age=60, s-maxage=${TTL_SECONDS}, stale-while-revalidate=900`,
};

export interface CommodityQuote {
  id: string;
  label: string;
  group: "energy" | "metal";
  unit: string;
  places: number;
  /** What the contract Yahoo answered with is called, so a roll is visible. */
  contract: string | null;
  price: number | null;
  currency: string | null;
  change: number | null;
  changePercent: number | null;
  error?: string;
}

export async function GET() {
  const { body } = await cachedJson<{ commodities: CommodityQuote[] }>(
    `commodities:${SHAPE}`,
    TTL_SECONDS,
    async () => {
      const quotes: CommodityQuote[] = [];
      for (const item of COMMODITIES) {
        const base = { id: item.id, label: item.label, group: item.group, unit: item.unit, places: item.places };
        try {
          const window = await fetchMarketWindow(item.symbol, item.label, "1D");
          quotes.push({
            ...base,
            contract: window.name === item.label ? null : window.name,
            price: window.last ?? null,
            currency: window.currency ?? null,
            change: window.change ?? null,
            changePercent: window.changePercent ?? null,
          });
        } catch (error) {
          // One contract going quiet costs one line, not the row.
          quotes.push({ ...base, contract: null, price: null, currency: null, change: null, changePercent: null, error: error instanceof Error ? error.message : "Unavailable." });
        }
      }
      return { commodities: quotes };
    },
    // A row where nothing priced is not worth keeping for five minutes.
    (value) => value.commodities.some((quote) => quote.price != null) ? "full" : "empty",
  );

  const parsed = JSON.parse(body) as { commodities: CommodityQuote[] };
  if (!parsed.commodities.some((quote) => quote.price != null)) {
    return NextResponse.json(parsed, { status: 502, headers: { ...headers, "Cache-Control": "no-store" } });
  }
  return new Response(body, { headers });
}
