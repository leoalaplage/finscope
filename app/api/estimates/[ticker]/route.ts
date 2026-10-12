import { NextResponse } from "next/server";
import { getEstimates, readHistory } from "@/lib/estimates-store";
import { TICKER_PATTERN } from "@/lib/market-profile";

/**
 * A company's analyst estimates and the history of its consensus
 * (lib/estimates-store.ts). The consensus is kept twelve hours; the history
 * is read as it stands.
 */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await context.params).ticker).toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) return NextResponse.json({ error: "That is not a ticker." }, { status: 400 });
  try {
    const [{ body }, history] = await Promise.all([getEstimates(ticker), readHistory(ticker)]);
    return new Response(`{"estimates":${body},"history":${JSON.stringify(history)}}`, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600, s-maxage=1800" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Estimates are unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
