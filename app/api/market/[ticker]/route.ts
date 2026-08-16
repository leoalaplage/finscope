import { NextResponse } from "next/server";
import { COMPANIES } from "@/lib/company-registry";
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
    : COMPANIES.find((item) => item.ticker === symbol);
  if (!company) return NextResponse.json({ error: "Ticker not supported." }, { status: 404 });
  const params = new URL(request.url).searchParams;
  const frequency = params.get("frequency") as MarketFrequency;
  const start = params.get("start") ?? "2016-01-01";
  const end = params.get("end") ?? new Date().toISOString().slice(0, 10);
  if (!frequencies.has(frequency) || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return NextResponse.json({ error: "Valid start, end and frequency (daily, weekly, monthly, quarterly or annual) are required." }, { status: 400 });
  }
  try {
    const bars = await fetchYahooMarketHistory(company, start, end, frequency);
    return NextResponse.json({ ticker: company.ticker, frequency, bars }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Market history unavailable." }, { status: 502 });
  }
}
