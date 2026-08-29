import { NextResponse } from "next/server";
import { resolveMarketProfile } from "@/lib/market-profile";
import { cachedJson, isToday, SETTLED_SECONDS, TODAY_SECONDS } from "@/lib/market-cache";
import { fetchYahooPrices } from "@/lib/adapters/yahoo";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const company = resolveMarketProfile(ticker);
  if (!company) return NextResponse.json({ error: "That is not a usable exchange symbol." }, { status: 400 });
  const params = new URL(request.url).searchParams;
  // Sorted, so two callers asking for the same dates in a different order share
  // one cache entry rather than each building their own.
  const dates = [...new Set((params.get("dates") ?? "").split(",").filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort().slice(0, 120);
  if (!dates.length) return NextResponse.json({ error: "At least one valid date is required." }, { status: 400 });
  const publicationSafe = params.get("published") === "1";

  // A set that includes today moves; one made only of past sessions does not.
  const live = dates.some(isToday);
  const seconds = live ? TODAY_SECONDS : SETTLED_SECONDS;
  const key = `prices:${company.ticker}:${publicationSafe ? "pub" : "std"}:${dates.join(",")}`;
  const { body, hit } = await cachedJson(key, seconds, async () => ({
    ticker: company.ticker,
    points: await fetchYahooPrices(company, dates, publicationSafe ? 0 : 7, publicationSafe ? 7 : 2),
  }));
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${SETTLED_SECONDS}`,
      "X-FinScope-Cache": hit ? "hit" : "miss",
    },
  });
}
