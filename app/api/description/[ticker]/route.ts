import { NextResponse } from "next/server";
import { TICKER_PATTERN } from "@/lib/market-profile";
import { companyByTicker } from "@/lib/company-registry";
import { KNOWN_SUCCESSORS, universeMember } from "@/lib/universe";
import { sameListing, searchSecCompanies } from "@/lib/adapters/sec";
import { describe } from "@/lib/description";

/** A company's or a fund's description, with its source (lib/description.ts). */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await context.params).ticker).toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) return NextResponse.json({ error: "That is not a ticker." }, { status: 400 });
  try {
    // The filer whose reports hold the company's history, as the statements are read (KNOWN_SUCCESSORS).
    const cik = KNOWN_SUCCESSORS[ticker]?.reads ?? companyByTicker(ticker)?.cik ?? universeMember(ticker)?.cik
      ?? (await searchSecCompanies(ticker)).find((entry) => sameListing(entry.ticker, ticker))?.cik;
    if (!cik) return NextResponse.json(null, { headers: { "Cache-Control": "public, max-age=86400" } });
    const body = await describe(cik);
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400, s-maxage=86400" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No description." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
