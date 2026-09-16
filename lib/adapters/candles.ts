import { z } from "zod";

/**
 * Open, high, low and close, by day, week or month, for the chart page.
 *
 * The daily adapter answers dated sessions for statements and the window
 * adapter answers a line of closes; a candle chart needs all four figures, and
 * more history than it shows, so its averages are warmed up before the first
 * candle a reader looks at.
 *
 * Columns rather than rows: eleven thousand daily bars written as objects are
 * five field names eleven thousand times.
 */

export const CANDLE_INTERVALS = ["1d", "1wk", "1mo"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

/**
 * How much history each interval is asked for, in days.
 *
 * The chart shows a year of days, three years of weeks and ten years of
 * months; the rest is there so a 200-period average is already settled on the
 * first candle shown. Asked for by dates, never as `range=max`, which Yahoo
 * quietly answers with quarterly bars whatever interval was requested.
 */
const LOOKBACK_DAYS: Record<CandleInterval, number | null> = {
  "1d": 3 * 366,
  "1wk": 10 * 366,
  "1mo": null,
};

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
   * Bar times in seconds, at UTC midnight of the session date at the exchange,
   * so a date read from one is the exchange's date wherever the reader is.
   */
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  last: number | null;
  previousClose: number | null;
}

const DAY = 86_400;

/** Four places: Yahoo's floats carry noise in the tenth, which is a third of the payload. */
const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** Midnight UTC of the session date, moved back to the Monday or the first of the month for weeks and months. */
export function periodStart(localSeconds: number, interval: CandleInterval): number {
  const day = localSeconds - (((localSeconds % DAY) + DAY) % DAY);
  if (interval === "1d") return day;
  const date = new Date(day * 1000);
  if (interval === "1mo") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
  return day - (((date.getUTCDay() + 6) % 7) * DAY);
}

/** A response as columns, with bars that did not trade dropped rather than drawn at zero. */
export function candlesFromChart(payload: unknown, interval: CandleInterval): Candles | null {
  const result = ChartSchema.parse(payload).chart.result?.[0];
  if (!result) return null;
  const quote = result.indicators.quote[0] ?? {};
  const offset = result.meta.gmtoffset ?? 0;
  const out: Candles = {
    symbol: result.meta.symbol,
    name: result.meta.longName ?? result.meta.shortName ?? result.meta.symbol,
    currency: result.meta.currency ?? null,
    exchange: result.meta.exchangeName ?? null,
    timezone: result.meta.exchangeTimezoneName ?? null,
    interval,
    t: [], o: [], h: [], l: [], c: [],
    last: result.meta.regularMarketPrice ?? null,
    previousClose: result.meta.previousClose ?? result.meta.chartPreviousClose ?? null,
  };
  const stamps = result.timestamp ?? [];
  for (let index = 0; index < stamps.length; index++) {
    const open = quote.open?.[index], high = quote.high?.[index], low = quote.low?.[index], close = quote.close?.[index];
    if (open == null || high == null || low == null || close == null) continue;
    const time = periodStart(stamps[index] + offset, interval);
    const previous = out.t.length - 1;
    // Yahoo answers the running week or month twice — once at the period's
    // start and once at today's session — so rows of one period are merged
    // into one candle rather than drawn as a second, one-day candle.
    if (previous >= 0 && time <= out.t[previous]) {
      if (time < out.t[previous]) continue;
      out.h[previous] = round(Math.max(out.h[previous], high, open, close));
      out.l[previous] = round(Math.min(out.l[previous], low, open, close));
      out.c[previous] = round(close);
      continue;
    }
    out.t.push(time);
    out.o.push(round(open));
    out.h.push(round(Math.max(high, open, close)));
    out.l.push(round(Math.min(low, open, close)));
    out.c.push(round(close));
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
