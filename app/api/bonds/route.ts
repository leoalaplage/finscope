import { NextResponse } from "next/server";
import { fetchEcbLatest } from "@/lib/adapters/ecb";
import { fetchMarketWindow } from "@/lib/adapters/intraday";
import { BONDS } from "@/lib/bonds";
import { cachedJson } from "@/lib/market-cache";

/**
 * Six government yields, fetched once for everybody rather than once per reader.
 *
 * The same arrangement as the commodities beside them and for the same reason:
 * the indices above are read every thirty seconds because three symbols is a
 * request this Worker can afford at that pace, and a dozen more on every cold
 * render is the shape most likely to get it refused. A ten-year yield does not
 * move enough in five minutes to be worth that.
 *
 * Two of the six are published once a business day, so the answer carries the
 * date each figure was struck on. A reading dated two days ago in a row of live
 * ones is only a lie if nobody says so.
 */
const TTL_SECONDS = 300;
/** The stored answer's shape, versioned as every stored shape here is. */
const SHAPE = "v1";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": `public, max-age=60, s-maxage=${TTL_SECONDS}, stale-while-revalidate=900`,
};

export interface BondQuote {
  id: string;
  label: string;
  description: string;
  /** Whether the figure moves during the session, or is struck once a day. */
  live: boolean;
  /** The yield, in per cent a year, as the source quotes it. */
  rate: number | null;
  /**
   * The move since the previous reading, in basis points.
   *
   * Yields are quoted and discussed in hundredths of a point, never as a
   * percentage of themselves: four per cent going to four and a tenth is "ten
   * basis points", and calling it "+2.5%" would be arithmetic nobody uses.
   */
  changeBp: number | null;
  /** The session or publication date the figure belongs to. */
  asOf: string | null;
  error?: string;
}

export async function GET() {
  const { body } = await cachedJson<{ bonds: BondQuote[] }>(
    `bonds:${SHAPE}`,
    TTL_SECONDS,
    async () => {
      const quotes: BondQuote[] = [];
      for (const bond of BONDS) {
        const base = { id: bond.id, label: bond.label, description: bond.description, live: bond.live };
        try {
          if (bond.feed.kind === "yahoo") {
            const window = await fetchMarketWindow(bond.feed.symbol, bond.label, "1D");
            quotes.push({
              ...base,
              rate: window.last ?? null,
              changeBp: window.change == null ? null : window.change * 100,
              asOf: window.sessionDate || null,
            });
          } else {
            const latest = await fetchEcbLatest(bond.feed.key);
            quotes.push({
              ...base,
              rate: latest.rate,
              changeBp: latest.previous == null ? null : (latest.rate - latest.previous) * 100,
              asOf: latest.date,
            });
          }
        } catch (error) {
          // One curve going quiet costs one line, not the row.
          quotes.push({ ...base, rate: null, changeBp: null, asOf: null, error: error instanceof Error ? error.message : "Unavailable." });
        }
      }
      return { bonds: quotes };
    },
    // A row where nothing priced is not worth keeping for five minutes.
    (value) => value.bonds.some((quote) => quote.rate != null) ? "full" : "empty",
  );

  const parsed = JSON.parse(body) as { bonds: BondQuote[] };
  if (!parsed.bonds.some((quote) => quote.rate != null)) {
    return NextResponse.json(parsed, { status: 502, headers: { ...headers, "Cache-Control": "no-store" } });
  }
  return new Response(body, { headers });
}
