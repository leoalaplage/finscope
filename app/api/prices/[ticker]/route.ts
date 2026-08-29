import { NextResponse } from "next/server";
import { resolveMarketProfile } from "@/lib/market-profile";
import { cachedJson, isToday, SETTLED_SECONDS, TODAY_SECONDS, type Completeness } from "@/lib/market-cache";
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
  const { body, hit } = await cachedJson(
    key,
    seconds,
    async () => ({
      ticker: company.ticker,
      points: await fetchYahooPrices(company, dates, publicationSafe ? 0 : 7, publicationSafe ? 7 : 2),
    }),
    /*
     * An answer nobody could price is not an answer worth keeping.
     *
     * This endpoint never throws: a date Yahoo could not answer comes back as
     * an entry with an `error` rather than as a failed request. So when Yahoo
     * refused the whole batch — a rate limit, a bad minute — the result was a
     * perfectly shaped response full of errors, written to KV and served back
     * for twenty-four hours. Dates that had been on the valuation chart a
     * moment earlier were then missing for the rest of the day, and asking
     * again could not fix it.
     */
    (answer): Completeness => {
      const priced = answer.points.filter((item) => item.point).length;
      if (!priced) return "empty";
      // Some dates are legitimately unpriceable — today on a Saturday, a
      // session before the company listed — so a partial answer is kept, but
      // only for a minute, in case the gap was upstream rather than real.
      return priced === answer.points.length ? "full" : "partial";
    },
  );
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${SETTLED_SECONDS}`,
      "X-FinScope-Cache": hit ? "hit" : "miss",
    },
  });
}
