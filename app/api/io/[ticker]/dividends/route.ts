import { NextResponse } from "next/server";
import { fetchDividendHistory } from "@/lib/adapters/yahoo-dividends";
import { cachedJson } from "@/lib/market-cache";
import { TICKER_PATTERN } from "@/lib/market-profile";

/** A listing's dividends, twenty-five years of them, kept twelve hours (lib/dividends.ts reads them). */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const symbol = (await context.params).ticker.toUpperCase();
  if (!TICKER_PATTERN.test(symbol)) return NextResponse.json({ error: "That is not a ticker." }, { status: 400 });
  try {
    // Yahoo writes a share class with a dash: BRK-B.
    const { body } = await cachedJson(`dividends:v1:${symbol}`, 12 * 3600, () => fetchDividendHistory(symbol.replace(".", "-")));
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600, s-maxage=21600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dividends are unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
