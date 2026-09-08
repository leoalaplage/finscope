import { NextResponse } from "next/server";
import { fetchInsiderTransactions, INSIDER_FILING_LIMIT, INSIDER_SHAPE } from "@/lib/adapters/insiders";
import { cachedJson, type Completeness } from "@/lib/market-cache";
import { resolveMarketProfile } from "@/lib/market-profile";

/**
 * What the people who run this company did with their own shares.
 *
 * Form 4 is due within two business days of the trade, so the answer changes
 * on a filing's clock rather than a market's: a day is the right lifetime, and
 * it is the same day the digests behind the rest of the page are kept for.
 *
 * Forty filings, because a large company files hundreds and this is a section
 * of a page rather than a register. How many were read and how many exist both
 * travel with the answer, so the page can say which it is showing.
 */
const CACHE_SECONDS = 86_400;

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const company = resolveMarketProfile(ticker);
  if (!company) return NextResponse.json({ error: "That is not a usable exchange symbol." }, { status: 400 });
  if (!company.cik) {
    return NextResponse.json(
      { error: `No regulatory identifier is on file for ${company.ticker}, so its Form 4 filings cannot be located.` },
      { status: 404 },
    );
  }

  try {
    const { body, hit } = await cachedJson(
      `insiders:${INSIDER_SHAPE}:${company.ticker}:${INSIDER_FILING_LIMIT}`,
      CACHE_SECONDS,
      () => fetchInsiderTransactions(company.ticker, company.cik, new Date().toISOString()),
      /*
       * A company whose insiders genuinely filed nothing is a fact worth
       * keeping. A read that returned no filings *and* saw none in the index is
       * indistinguishable from EDGAR having a bad minute, so only the second is
       * stored — the first is asked again.
       */
      (answer): Completeness => (answer.filingsAvailable === 0 && answer.filingsRead === 0 ? "empty" : "full"),
    );
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
        "X-FinScope-Cache": hit ? "hit" : "miss",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Form 4 filings are unavailable." },
      { status: 502 },
    );
  }
}
