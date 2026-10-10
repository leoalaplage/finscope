import { NextResponse } from "next/server";
import { fetchLatestEarningsRelease } from "@/lib/adapters/earnings";
import { TICKER_PATTERN } from "@/lib/market-profile";

/**
 * Earnings announcements change on the filing clock, independently of the
 * normalized statements. Keep this separate from the 24-hour company view so
 * a fresh 8-K can be visible while Company Facts still holds the prior quarter.
 */
const CACHE_SECONDS = 900;
const CIK_PATTERN = /^\d{1,10}$/;

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const symbol = ticker.toUpperCase();
  const cik = new URL(request.url).searchParams.get("cik") ?? "";
  if (!TICKER_PATTERN.test(symbol) || !CIK_PATTERN.test(cik)) {
    return NextResponse.json({ error: "A valid exchange symbol and SEC CIK are required." }, { status: 400 });
  }

  try {
    const filing = await fetchLatestEarningsRelease(cik);
    return NextResponse.json({ ticker: symbol, cik: cik.padStart(10, "0"), filing }, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The SEC filing index is unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
