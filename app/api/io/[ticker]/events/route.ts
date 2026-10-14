import { NextResponse } from "next/server";
import { companyEvents } from "@/lib/company-events";
import { TICKER_PATTERN } from "@/lib/market-profile";

/**
 * A company's events: its 8-Ks by item, and the reports, proxies,
 * registrations and activist stakes around them (lib/adapters/filing-events.ts),
 * two years of them, from one read of its SEC index kept a quarter of an hour.
 */
const CIK_PATTERN = /^\d{1,10}$/;

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const symbol = (await context.params).ticker.toUpperCase();
  const cik = new URL(request.url).searchParams.get("cik") ?? "";
  if (!TICKER_PATTERN.test(symbol) || !CIK_PATTERN.test(cik)) return NextResponse.json({ error: "A valid exchange symbol and SEC CIK are required." }, { status: 400 });
  try {
    const body = JSON.stringify(await companyEvents(cik));
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300, s-maxage=600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The SEC index is unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
