import { NextResponse } from "next/server";
import { CANDLE_INTERVALS, fetchCandles, isIntraday, type CandleInterval } from "@/lib/adapters/candles";
import { cachedJson, TODAY_SECONDS } from "@/lib/market-cache";
import { resolveMarketProfile } from "@/lib/market-profile";

/**
 * One symbol's candles at one interval, for the chart page.
 *
 * Only today's candle moves, so an answer is kept for five minutes, one cache
 * entry per symbol and interval.
 */

/** Index symbols are not companies but are charted all the same. */
const INDEX = /^\^[A-Z0-9]{1,10}$/;

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const requested = decodeURIComponent(ticker).toUpperCase();
  const company = INDEX.test(requested) ? null : resolveMarketProfile(requested);
  if (!company && !INDEX.test(requested)) return NextResponse.json({ error: "That is not a usable exchange symbol." }, { status: 400 });
  const symbol = company ? company.yahooTicker ?? company.ticker : requested;
  const interval = new URL(request.url).searchParams.get("interval") as CandleInterval;
  if (!CANDLE_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: `The interval must be one of ${CANDLE_INTERVALS.join(", ")}.` }, { status: 400 });
  }
  /*
   * A minute for bars inside the session, five for the rest; an hour for a
   * long history, which is asked for by a backtest and moves by one bar a day.
   */
  const long = new URL(request.url).searchParams.get("span") === "max" && !isIntraday(interval);
  const seconds = isIntraday(interval) ? 60 : long ? 3600 : TODAY_SECONDS;
  try {
    const { body, hit } = await cachedJson(
      `candles:v6:${symbol}:${interval}${long ? ":max" : ""}`,
      seconds,
      async () => ({ ...(await fetchCandles(symbol, interval, long)), ticker: company?.ticker ?? requested }),
      (answer) => (answer.t.length ? "full" : "empty"),
    );
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=30, s-maxage=${seconds}, stale-while-revalidate=600`,
        "X-FinScope-Cache": hit ? "hit" : "miss",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Candles unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
