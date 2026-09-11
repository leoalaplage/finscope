import { NextResponse } from "next/server";
import { dailyWindow, frequencyOf, refusalFor } from "@/lib/adapters/daily-yields";
import { fetchMarketWindow, MARKET_RANGES, type MarketRange, type MarketWindow } from "@/lib/adapters/intraday";
import { bondById } from "@/lib/bonds";
import { commodityById } from "@/lib/commodities";
import { dailyYields } from "@/lib/daily-yield-store";
import { cachedJson } from "@/lib/market-cache";

/**
 * One commodity or one government yield, over one window, as a line.
 *
 * The strips on the market page are figures, because six charts under three
 * charts is a page with no subject. But a figure is where a question starts —
 * a reader who sees Brent down two per cent wants to know whether that is the
 * end of a month of falling or the first day of it — so any cell can be opened
 * into the same panel the indices are drawn in.
 *
 * One route for both registries rather than one each: the two answer the same
 * question in the same shape, and the panel that draws them does not care which
 * list an id came from. What it does care about is how to read the number, so
 * the answer says: a yield is quoted in per cent and moves in basis points, a
 * price is read as a distance from where the window opened.
 */

/**
 * Five minutes for a window that includes today, a day for one that cannot
 * change.
 *
 * Every window here includes today, so the short life is the only one that
 * applies — but a five-year weekly chart being rebuilt every five minutes is
 * still cheaper than the alternative of holding a stale one, and it is one
 * upstream call for every reader who opens the same panel.
 */
const TTL_SECONDS = 300;
const SHAPE = "v1";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": `public, max-age=60, s-maxage=${TTL_SECONDS}, stale-while-revalidate=900`,
};

export interface QuoteWindow extends MarketWindow {
  id: string;
  description: string;
  /**
   * How the panel should read the figure.
   *
   * A price is read as a distance from the baseline, which is what "+2.1% this
   * month" means. A yield is read as a level: nobody says a ten-year yield rose
   * two and a half per cent, they say it rose eleven basis points, and an axis
   * labelled in per-cent-of-itself would be a chart of the wrong quantity.
   */
  measure: "level" | "yield";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const asked = new URL(request.url).searchParams.get("range");
  const range: MarketRange = MARKET_RANGES.includes(asked as MarketRange) ? asked as MarketRange : "1M";

  const bond = bondById(id);
  const commodity = bond ? null : commodityById(id);
  if (!bond && !commodity) {
    return NextResponse.json({ error: `Nothing on this site is quoted under “${id}”.` }, { status: 404, headers: { ...headers, "Cache-Control": "no-store" } });
  }

  const named = bond ?? commodity!;
  /*
   * A window this series does not exist at is refused before it is fetched.
   *
   * Nothing has gone wrong upstream, so this is not a bad gateway: every
   * yield outside the US is struck once a business day or once a month, and a
   * single session of the one, or a single month of the other, is one point
   * rather than a line. Saying so costs no request and gives the panel a
   * sentence a reader can act on.
   */
  const refused = bond && bond.feed.kind !== "yahoo" ? refusalFor(frequencyOf(bond.feed), range) : null;
  if (bond && refused) {
    return NextResponse.json(
      { id: bond.id, name: bond.label, range, error: refused },
      { status: 422, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }

  try {
    const { body } = await cachedJson<QuoteWindow>(
      `quote:${SHAPE}:${named.id}:${range}`,
      TTL_SECONDS,
      async () => {
        const window = bond
          ? bond.feed.kind === "yahoo"
            ? await fetchMarketWindow(bond.feed.symbol, bond.label, range)
            : dailyWindow(await dailyYields(bond.id, bond.feed), bond.label, range, bond.id, frequencyOf(bond.feed))
          : await fetchMarketWindow(commodity!.symbol, commodity!.label, range);
        return {
          ...window,
          // The label this site chose, not the contract month Yahoo answered
          // with: "Brent crude" is the subject, "BZ=F Nov 26" is the roll.
          // A monthly figure says so in the panel's own title, where the
          // reader looks, rather than only in the axis dates.
          name: bond && bond.feed.kind !== "yahoo" && frequencyOf(bond.feed) === "monthly" ? `${named.label} · monthly avg.` : named.label,
          id: named.id,
          description: bond ? bond.description : `${commodity!.label}, front-month futures, quoted for ${commodity!.unit}.`,
          measure: bond ? "yield" : "level",
        };
      },
      // A window with no points is a failed fetch wearing a valid shape.
      (value) => value.points.length ? "full" : "empty",
    );
    return new Response(body, { headers });
  } catch (error) {
    // The reason travels: "the ECB publishes this once a day" is an answer a
    // reader can act on, and "unavailable" is not.
    return NextResponse.json(
      { id: named.id, name: named.label, range, error: error instanceof Error ? error.message : "This series is unavailable right now." },
      { status: 502, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
}
