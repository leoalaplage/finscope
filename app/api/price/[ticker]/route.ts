import { NextResponse } from "next/server";
import { resolveMarketProfile } from "@/lib/market-profile";
import { cachedJson, isToday, SETTLED_SECONDS, TODAY_SECONDS } from "@/lib/market-cache";
import { fetchYahooPrice } from "@/lib/adapters/yahoo";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await context.params;
    const company = resolveMarketProfile(ticker);
    if (!company) return NextResponse.json({ error: "That is not a usable exchange symbol." }, { status: 400 });
    const date = new URL(request.url).searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });

    /*
     * Today's price is a moving figure; a past session's is a settled one.
     *
     * Both used to be answered with a day of edge caching, which is wrong in
     * one direction — a price frozen for a whole trading day — and, because the
     * client asked for `no-store`, wrong in the other too: every company a
     * reader opened paid a cold round trip to Yahoo for the number at the top
     * of the page, over five seconds of it on production.
     */
    const live = isToday(date);
    const seconds = live ? TODAY_SECONDS : SETTLED_SECONDS;
    const { body, hit } = await cachedJson(`price:${company.ticker}:${date}`, seconds, () => fetchYahooPrice(company, date));
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${SETTLED_SECONDS}`,
        "X-FinScope-Cache": hit ? "hit" : "miss",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Price unavailable." }, { status: 502 });
  }
}
