import { NextResponse } from "next/server";
import { frequencyOf, latestReading, type Frequency } from "@/lib/adapters/daily-yields";
import { fetchMarketWindow } from "@/lib/adapters/intraday";
import { BOND_SETS, BONDS, type BondSet } from "@/lib/bonds";
import { dailyYields } from "@/lib/daily-yield-store";
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
 * One set of six at a time, because the page shows one at a time: the second
 * is asked for only when a reader turns to it, and seven banks' files are not
 * read on a first paint that will never look at them.
 *
 * Most of these are published once a business day, so the answer carries the
 * date each figure was struck on. A reading dated yesterday in a row of live
 * ones is only a lie if nobody says so.
 */
const TTL_SECONDS = 300;
/**
 * The stored answer's shape, versioned as every stored shape here is.
 *
 * v2 is one answer per set rather than one for the page; v3 carries each
 * figure's frequency, so a monthly average is dated as a month.
 */
const SHAPE = "v3";

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
  /**
   * How often the figure is published. A monthly one is an average of the
   * month and is dated by it — "Aug avg." — rather than by a day it does not
   * belong to.
   */
  frequency: Frequency;
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

export async function GET(request: Request) {
  // An unknown set is answered with the first rather than an error: the
  // parameter comes from a page a reader may have edited.
  const asked = new URL(request.url).searchParams.get("set");
  const set: BondSet = BOND_SETS.includes(asked as BondSet) ? asked as BondSet : "core";

  const { body } = await cachedJson<{ bonds: BondQuote[] }>(
    `bonds:${SHAPE}:${set}`,
    TTL_SECONDS,
    async () => {
      const quotes: BondQuote[] = [];
      for (const bond of BONDS.filter((each) => each.set === set)) {
        const base = {
          id: bond.id, label: bond.label, description: bond.description, live: bond.live,
          frequency: bond.feed.kind === "yahoo" ? "daily" as const : frequencyOf(bond.feed),
        };
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
            const latest = latestReading(await dailyYields(bond.id, bond.feed));
            if (!latest) throw new Error("The publisher returned no readings for this series.");
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
