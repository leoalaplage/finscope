import { NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/adapters/quotes";
import { cachedJson, TODAY_SECONDS, type Completeness } from "@/lib/market-cache";
import { resolveMarketProfile } from "@/lib/market-profile";

/**
 * One symbol's last print, kept apart from its filings.
 *
 * The two move on completely different clocks: a filed statement is settled for
 * a quarter, a price is not settled at all. Answering them in one response
 * would mean either serving a stale price or throwing away a cached company
 * every five minutes, so the page asks twice and the caches can disagree about
 * how long each answer is worth.
 */
export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const company = resolveMarketProfile(ticker);
  if (!company) return NextResponse.json({ error: "That is not a usable exchange symbol." }, { status: 400 });
  const symbol = company.yahooTicker ?? company.ticker;

  try {
    const { body, hit } = await cachedJson(
      `quote:${symbol}`,
      TODAY_SECONDS,
      async () => {
        const [quote] = await fetchQuotes([symbol]);
        if (!quote) throw new Error("No quote is available for this symbol.");
        return { ...quote, ticker: company.ticker };
      },
      // A quote with no price in it is not a quote. Storing one would mean an
      // empty headline for five minutes after a single bad minute upstream.
      (answer): Completeness => (answer.price == null ? "empty" : "full"),
    );
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${TODAY_SECONDS}, stale-while-revalidate=900`,
        "X-FinScope-Cache": hit ? "hit" : "miss",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Quote unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
