import { NextResponse } from "next/server";
import { readUniverse } from "@/lib/universe-build";

/**
 * What five hundred companies did today, rather than what yours did.
 *
 * The market page could show three indices and the reader's own watchlist, and
 * nothing in between. An index level says the market rose; it does not say
 * whether it rose because four hundred companies rose or because five did, nor
 * which industry carried it. That is what a market page is for, and until
 * there was a whole index in the store it could not be asked.
 *
 * Free, in the sense that matters: the scheduled run already prices every
 * company in the index every half hour, and the quote it reads states the
 * day's move. This endpoint is a read and a sort over that table — no request
 * to anyone, and a few kilobytes instead of the six hundred the table weighs.
 */
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
};

export interface SectorMove {
  sector: string;
  companies: number;
  /** The middle company's day, which is the sector's day. */
  median: number;
  up: number;
  down: number;
}

export interface Mover { ticker: string; name: string; sector: string; changePercent: number }

export interface InternalsAnswer {
  index: string;
  asOf: string;
  builtAt: string;
  /** How many of the index priced at all, which is what the rest is out of. */
  priced: number;
  members: number;
  breadth: { up: number; down: number; flat: number; median: number };
  sectors: SectorMove[];
  risers: Mover[];
  fallers: Mover[];
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export async function GET() {
  const table = await readUniverse();
  if (!table) {
    return NextResponse.json({ building: true }, { status: 202, headers: { ...headers, "Cache-Control": "no-store" } });
  }

  const moved = table.rows.flatMap((row) => {
    const change = table.prices[row.ticker]?.changePercent;
    if (change == null || !Number.isFinite(change)) return [];
    return [{
      ticker: row.ticker,
      name: row.name,
      sector: typeof row.qs?.["Sector"] === "string" ? row.qs["Sector"] as string : "Unclassified",
      changePercent: change,
    }];
  });

  /*
   * Three fifths of the index, or nothing at all.
   *
   * The table fills a hundred companies at a time and empties whenever its
   * shape changes, so a partly filled one is a normal state rather than a
   * failure — and a hundred companies called "what the market did" is a
   * sentence about a quarter of the index wearing the whole one's name.
   * Breadth is the reading most damaged by a partial table: the missing four
   * hundred are missing from both sides and from the middle.
   */
  if (moved.length < table.members * 0.6) {
    return NextResponse.json({ building: true, priced: moved.length, members: table.members }, { status: 202, headers: { ...headers, "Cache-Control": "no-store" } });
  }

  const bySector = new Map<string, Mover[]>();
  for (const company of moved) bySector.set(company.sector, [...(bySector.get(company.sector) ?? []), company]);

  const sectors: SectorMove[] = [...bySector.entries()]
    /*
     * The median rather than the average, and the count beside it.
     *
     * One company at plus forty per cent drags an average sector into the
     * green while every other company in it fell; the middle company cannot do
     * that. And a sector of three is not a reading, so the count is shown
     * rather than buried — the reader decides what to trust.
     */
    .map(([sector, companies]) => ({
      sector,
      companies: companies.length,
      median: median(companies.map((company) => company.changePercent)),
      up: companies.filter((company) => company.changePercent > 0).length,
      down: companies.filter((company) => company.changePercent < 0).length,
    }))
    .filter((sector) => sector.companies >= 3)
    .sort((left, right) => right.median - left.median);

  const ranked = [...moved].sort((left, right) => right.changePercent - left.changePercent);
  const answer: InternalsAnswer = {
    index: table.name,
    asOf: table.asOf,
    builtAt: table.builtAt,
    priced: moved.length,
    members: table.members,
    breadth: {
      up: moved.filter((company) => company.changePercent > 0).length,
      down: moved.filter((company) => company.changePercent < 0).length,
      flat: moved.filter((company) => company.changePercent === 0).length,
      median: median(moved.map((company) => company.changePercent)),
    },
    sectors,
    risers: ranked.slice(0, 5),
    fallers: ranked.slice(-5).reverse(),
  };
  return new Response(JSON.stringify(answer), { headers });
}
