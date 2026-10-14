import { NextResponse } from "next/server";
import { operatingKpis } from "@/lib/operating-kpis";
import { TICKER_PATTERN } from "@/lib/market-profile";

/**
 * The company's operating figures, quarter by quarter, from its releases and
 * its 10-Qs (lib/operating-kpis.ts). Rebuilt when it files; a new release is
 * read within half an hour of being filed.
 */
export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const symbol = (await context.params).ticker.toUpperCase();
  const cik = new URL(request.url).searchParams.get("cik") ?? "";
  if (!TICKER_PATTERN.test(symbol) || !/^\d{1,10}$/.test(cik)) return NextResponse.json({ error: "A valid exchange symbol and SEC CIK are required." }, { status: 400 });
  try {
    return NextResponse.json(await operatingKpis(cik), { headers: { "Cache-Control": "public, max-age=600, s-maxage=1800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The filings could not be read." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
