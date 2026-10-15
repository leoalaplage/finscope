import { NextResponse } from "next/server";
import { curveAndMonthAgo, parseTreasuryCurves, type TreasuryCurve } from "@/lib/macro";
import { cachedJson } from "@/lib/market-cache";

/**
 * The US Treasury's par yield curve today and a month earlier, every maturity
 * from one month to thirty years, from the Treasury's own daily feed. Kept
 * three hours: the Treasury publishes once a day.
 */
const feed = (year: number) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;

export async function GET() {
  try {
    const { body } = await cachedJson("yield-curve:v1", 3 * 3600, async () => {
      const year = new Date().getUTCFullYear();
      const curves: TreasuryCurve[] = [];
      // January needs December's curves for its month ago.
      for (const each of new Date().getUTCMonth() < 2 ? [year - 1, year] : [year]) {
        const response = await fetch(feed(each), { headers: { Accept: "application/xml", "User-Agent": "Mozilla/5.0 Tenkay/1.0" } });
        if (!response.ok) throw new Error(`The Treasury returned ${response.status}.`);
        curves.push(...parseTreasuryCurves(await response.text()));
      }
      return curveAndMonthAgo(curves.sort((a, b) => a.date.localeCompare(b.date)));
    }, (value) => (value?.monthAgo ? "full" : value ? "partial" : "empty"));
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800, s-maxage=3600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The Treasury feed is unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
