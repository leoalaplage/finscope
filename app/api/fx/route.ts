import { NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/adapters/quotes";
import { cachedJson, TODAY_SECONDS, type Completeness } from "@/lib/market-cache";

/**
 * Today's exchange rate between two currencies: how many `to` one `from` buys.
 *
 * Used to put a price quoted in one currency against statements filed in
 * another — ASML's New York price in dollars against its accounts in euros —
 * and nowhere else: no filed figure is ever converted. The rate is Yahoo's last
 * print for the pair, cached for the trading day like any other quote.
 */
const CODE = /^[A-Z]{3}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = (url.searchParams.get("from") ?? "").toUpperCase();
  const to = (url.searchParams.get("to") ?? "").toUpperCase();
  if (!CODE.test(from) || !CODE.test(to)) {
    return NextResponse.json({ error: "Two three-letter currency codes are needed." }, { status: 400 });
  }
  if (from === to) {
    return NextResponse.json({ from, to, rate: 1, asOf: null });
  }
  try {
    const symbol = `${from}${to}=X`;
    const { body } = await cachedJson(
      `fx:${symbol}`,
      TODAY_SECONDS,
      async () => {
        const [quote] = await fetchQuotes([symbol]);
        if (!quote?.price) throw new Error("No rate is available for this pair.");
        // The feed states the last print, not its time; the rate is today's.
        return { from, to, rate: quote.price, asOf: new Date().toISOString().slice(0, 10) };
      },
      (answer): Completeness => (answer.rate ? "full" : "empty"),
    );
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `public, s-maxage=${TODAY_SECONDS}` } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rate unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
