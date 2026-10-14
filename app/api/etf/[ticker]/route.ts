import { NextResponse } from "next/server";
import { TICKER_PATTERN } from "@/lib/market-profile";
import { getEtfProfile } from "@/lib/etf-profile";

/** A fund, from its own N-PORT and prospectus filings (lib/etf-profile.ts). */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await context.params).ticker).toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) return NextResponse.json({ error: "That is not a ticker." }, { status: 400 });
  try {
    const body = await getEtfProfile(ticker);
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800, s-maxage=3600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The fund could not be read." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
