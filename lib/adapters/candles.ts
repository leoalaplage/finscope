import { z } from "zod";

/**
 * Open, high, low, close and volume, at any interval the chart page offers.
 *
 * The daily adapter answers dated sessions for statements and the window
 * adapter answers a line of closes; a candle chart needs every one of the five
 * figures at every interval from five minutes to a month, and as much history
 * as Yahoo keeps at that interval, so the indicators drawn on it are warmed up
 * before the first bar a reader looks at.
 *
 * Columns rather than rows: eleven thousand daily bars written as objects are
 * five field names eleven thousand times.
 */

export const CANDLE_INTERVALS = ["5m", "15m", "1h", "1d", "1wk", "1mo"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

/**
 * How far back each interval can be asked for, in days.
 *
 * Yahoo keeps five- and fifteen-minute bars for sixty days and hourly bars for
 * two years, and refuses a window a day longer. Daily and longer bars go back
 * to the listing — asked for by dates, never as `range=max`, which Yahoo
 * quietly answers with quarterly bars whatever interval was requested.
 */
const LOOKBACK_DAYS: Record<CandleInterval, number | null> = {
  "5m": 59,
  "15m": 59,
  "1h": 729,
  "1d": null,
  "1wk": null,
  "1mo": null,
};

export const INTRADAY_INTERVALS: ReadonlySet<CandleInterval> = new Set(["5m", "15m", "1h"]);

const ChartSchema = z.object({
  chart: z.object({
    result: z.array(z.object({
      meta: z.object({
        currency: z.string().nullable().optional(),
        symbol: z.string(),
        shortName: z.string().nullable().optional(),
        longName: z.string().nullable().optional(),
        exchangeName: z.string().nullable().optional(),
        exchangeTimezoneName: z.string().nullable().optional(),
        gmtoffset: z.number().nullable().optional(),
        regularMarketPrice: z.number().nullable().optional(),
        previousClose: z.number().nullable().optional(),
        chartPreviousClose: z.number().nullable().optional(),
      }),
      timestamp: z.array(z.number()).optional(),
      indicators: z.object({
        quote: z.array(z.object({
          open: z.array(z.number().nullable()).optional(),
          high: z.array(z.number().nullable()).optional(),
          low: z.array(z.number().nullable()).optional(),
          close: z.array(z.number().nullable()).optional(),
          volume: z.array(z.number().nullable()).optional(),
        })),
      }),
    })).nullable(),
    error: z.unknown().nullable(),
  }),
});

export interface Candles {
  symbol: string;
  name: string;
  currency: string | null;
  exchange: string | null;
  timezone: string | null;
  interval: CandleInterval;
  /**
   * Bar times in seconds, already moved to the exchange's wall clock.
   *
   * The chart draws UTC, so a New York bar stamped 14:30 UTC would read as
   * 14:30; shifting it by the exchange's offset makes it read 09:30, which is
   * what anybody trading it calls it. Daily and longer bars are stamped at
   * midnight of their session date.
   */
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: Array<number | null>;
  last: number | null;
  previousClose: number | null;
}

const DAY = 86_400;

/** Four places: Yahoo's floats carry noise in the tenth, which is a third of the payload. */
const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** A response as columns, with bars that did not trade dropped rather than drawn at zero. */
export function candlesFromChart(payload: unknown, interval: CandleInterval): Candles | null {
  const result = ChartSchema.parse(payload).chart.result?.[0];
  if (!result) return null;
  const quote = result.indicators.quote[0] ?? {};
  const offset = result.meta.gmtoffset ?? 0;
  const intraday = INTRADAY_INTERVALS.has(interval);
  const out: Candles = {
    symbol: result.meta.symbol,
    name: result.meta.longName ?? result.meta.shortName ?? result.meta.symbol,
    currency: result.meta.currency ?? null,
    exchange: result.meta.exchangeName ?? null,
    timezone: result.meta.exchangeTimezoneName ?? null,
    interval,
    t: [], o: [], h: [], l: [], c: [], v: [],
    last: result.meta.regularMarketPrice ?? null,
    previousClose: result.meta.previousClose ?? result.meta.chartPreviousClose ?? null,
  };
  const stamps = result.timestamp ?? [];
  for (let index = 0; index < stamps.length; index++) {
    const open = quote.open?.[index], high = quote.high?.[index], low = quote.low?.[index], close = quote.close?.[index];
    if (open == null || high == null || low == null || close == null) continue;
    const local = stamps[index] + offset;
    const time = intraday ? local : local - (((local % DAY) + DAY) % DAY);
    // Yahoo repeats the running bar of the current period at its own
    // timestamp; the later print of the same period is the one to keep.
    if (out.t.length && time <= out.t[out.t.length - 1]) {
      if (time < out.t[out.t.length - 1]) continue;
      out.t.pop(); out.o.pop(); out.h.pop(); out.l.pop(); out.c.pop(); out.v.pop();
    }
    out.t.push(time);
    out.o.push(round(open));
    out.h.push(round(Math.max(high, open, close)));
    out.l.push(round(Math.min(low, open, close)));
    out.c.push(round(close));
    out.v.push(quote.volume?.[index] ?? null);
  }
  return out;
}

const BASE_URLS = () => [process.env.YAHOO_FINANCE_BASE_URL || "https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

export async function fetchCandles(symbol: string, interval: CandleInterval): Promise<Candles> {
  const now = Math.floor(Date.now() / 1000);
  const days = LOOKBACK_DAYS[interval];
  const start = days == null ? 0 : now - days * DAY;
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${now}&interval=${interval}&includePrePost=false`;
  let lastStatus = 0;
  for (const base of BASE_URLS()) {
    const response = await fetch(`${base}${path}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 FinScope/1.0" } });
    lastStatus = response.status;
    if (!response.ok) continue;
    const candles = candlesFromChart(await response.json(), interval);
    if (candles) return candles;
  }
  throw new Error(`Yahoo Finance returned ${lastStatus || "no response"}.`);
}
