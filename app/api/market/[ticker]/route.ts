import { NextResponse } from "next/server";
import { resolveMarketProfile } from "@/lib/market-profile";
import { cachedJson, isToday, SETTLED_SECONDS, TODAY_SECONDS, type Completeness } from "@/lib/market-cache";
import { fetchYahooMarketHistory } from "@/lib/adapters/yahoo";
import type { MarketFrequency } from "@/lib/types";

const frequencies = new Set<MarketFrequency>(["daily", "weekly", "monthly", "quarterly", "annual"]);

/**
 * Indices a portfolio may be measured against.
 *
 * Held here rather than in the company registry: an index has no filings, no
 * CIK and no financial statements, and putting one in the list of companies
 * would offer the reader a Statistics page for something that has none. It has
 * a price history and nothing else, which is exactly what a benchmark is.
 */
const BENCHMARKS: Record<string, { name: string; yahooTicker: string; currency: string }> = {
  "^GSPC": { name: "S&P 500", yahooTicker: "^GSPC", currency: "USD" },
  "^NDX": { name: "Nasdaq 100", yahooTicker: "^NDX", currency: "USD" },
};

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const symbol = ticker.toUpperCase();
  const benchmark = BENCHMARKS[symbol];
  const company = benchmark
    ? { ticker: symbol, name: benchmark.name, yahooTicker: benchmark.yahooTicker, currency: benchmark.currency, cik: "", exchange: "Index", sector: "Index", description: benchmark.name, businessType: "operating" } as Parameters<typeof fetchYahooMarketHistory>[0]
    : resolveMarketProfile(symbol);
  if (!company) return NextResponse.json({ error: "That is not a usable exchange symbol." }, { status: 400 });
  const params = new URL(request.url).searchParams;
  const frequency = params.get("frequency") as MarketFrequency;
  const start = params.get("start") ?? "2016-01-01";
  const end = params.get("end") ?? new Date().toISOString().slice(0, 10);
  if (!frequencies.has(frequency) || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return NextResponse.json({ error: "Valid start, end and frequency (daily, weekly, monthly, quarterly or annual) are required." }, { status: 400 });
  }
  try {
    // A window ending today keeps moving; one that ended yesterday is settled.
    // Every overview chart and every price series asks through here, and each
    // one used to be a cold round trip to Yahoo.
    const seconds = isToday(end) ? TODAY_SECONDS : SETTLED_SECONDS;
    const { body, hit } = await cachedJson(
      `market:${company.ticker}:${frequency}:${start}:${end}`,
      seconds,
      async () => ({ ticker: company.ticker, frequency, bars: await fetchYahooMarketHistory(company, start, end, frequency) }),
      // A history with no bars in it is not a history. Yahoo answering 200 with
      // an empty chart looks exactly like a company that has never traded, and
      // storing that for a day empties every price series on the page.
      (answer): Completeness => answer.bars.length ? "full" : "empty",
    );
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${SETTLED_SECONDS}`,
        "X-FinScope-Cache": hit ? "hit" : "miss",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Market history unavailable." }, { status: 502 });
  }
}
