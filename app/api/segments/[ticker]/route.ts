import { NextResponse } from "next/server";
import { TICKER_PATTERN } from "@/lib/market-profile";
import { getSegments } from "@/lib/segments/store";

/**
 * A company's segments as its filings break them out (lib/segments). Built on
 * first request and kept; the timer rebuilds them with `X-FinScope-Warm` and `X-FinScope-Rebuild`.
 */
export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await context.params).ticker).toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) return NextResponse.json({ error: "That is not a ticker." }, { status: 400 });
  try {
    const rebuild = request.headers.get("X-FinScope-Warm") === "1" && request.headers.get("X-FinScope-Rebuild") === "1";
    const data = await getSegments(ticker, rebuild);
    if (!data) return NextResponse.json({ error: "No SEC filer under that ticker." }, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
    return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=1800, s-maxage=3600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Segments are unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
