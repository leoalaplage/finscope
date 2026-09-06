import { z } from "zod";

/**
 * Today's session, minute by minute.
 *
 * Separate from the daily adapter next door because almost nothing is shared:
 * that one asks for calendar days and hands back sessions keyed by date, and
 * every figure here belongs to a moment inside one day. Mixing the two would
 * mean a `date` field that sometimes means a day and sometimes an instant.
 */

const IntradaySchema = z.object({
  chart: z.object({
    result: z.array(z.object({
      meta: z.object({
        currency: z.string(),
        symbol: z.string(),
        shortName: z.string().optional(),
        exchangeTimezoneName: z.string(),
        gmtoffset: z.number(),
        regularMarketPrice: z.number().nullable().optional(),
        chartPreviousClose: z.number().nullable().optional(),
        previousClose: z.number().nullable().optional(),
        regularMarketTime: z.number().nullable().optional(),
        regularMarketDayHigh: z.number().nullable().optional(),
        regularMarketDayLow: z.number().nullable().optional(),
        currentTradingPeriod: z.object({
          regular: z.object({ start: z.number(), end: z.number() }),
        }).optional(),
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

/** One interval of the session. Bars with no trade in them are dropped. */
export interface IntradayBar {
  /** Epoch seconds at the start of the interval. */
  time: number;
  /** Local wall-clock at the exchange, "HH:MM", which is what an axis wants. */
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface IntradaySnapshot {
  symbol: string;
  name: string;
  currency: string;
  /** The exchange's own timezone, so the client never re-times the axis. */
  timezone: string;
  /** The session the bars belong to, as a date at the exchange. */
  sessionDate: string;
  last: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  high: number | null;
  low: number | null;
  /** When the last trade printed, epoch seconds. */
  asOf: number | null;
  open: boolean;
  bars: IntradayBar[];
  /**
   * Volume so far against what this time of day usually brings.
   *
   * Null rather than 1 when there is no baseline to compare with. See
   * relativeVolume for why it is measured at the same point in the session.
   */
  relativeVolume: number | null;
}

const BASE_URLS = () => [process.env.YAHOO_FINANCE_BASE_URL || "https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

/** The exchange-local date of an instant, without pulling in a timezone library. */
function localDate(epochSeconds: number, gmtOffsetSeconds: number) {
  return new Date((epochSeconds + gmtOffsetSeconds) * 1000).toISOString().slice(0, 10);
}

function localTime(epochSeconds: number, gmtOffsetSeconds: number) {
  return new Date((epochSeconds + gmtOffsetSeconds) * 1000).toISOString().slice(11, 16);
}

/**
 * How busy today is, measured at the same point in the session.
 *
 * Comparing today's volume so far against a whole average day would call every
 * morning quiet and every afternoon busy, which says more about the clock than
 * about the market. This compares the running total at bar *n* with the running
 * total at bar *n* on each of the previous sessions, so ten o'clock is only
 * ever compared with ten o'clock.
 *
 * Null when no earlier session reached this point — the honest answer when
 * there is nothing to compare against.
 */
export function relativeVolume(today: Array<number | null>, previousDays: Array<Array<number | null>>): number | null {
  const cumulative = (bars: Array<number | null>, upTo: number) =>
    bars.slice(0, upTo).reduce((sum: number, value) => sum + (value ?? 0), 0);
  if (!today.length) return null;

  // Compare over the stretch every session being compared actually covers. A
  // day is one bar longer or shorter than its neighbours often enough — a
  // closing auction printing its own interval, a half day — that demanding an
  // exact match threw away every baseline and answered "no idea" every time.
  // Days far shorter than today are dropped rather than stretched: half a
  // session is not a baseline for a whole one.
  const usable = previousDays.filter((day) => day.length >= today.length * 0.8);
  if (!usable.length) return null;
  const point = Math.min(today.length, ...usable.map((day) => day.length));
  if (!point) return null;

  const soFar = cumulative(today, point);
  if (!(soFar > 0)) return null;
  const baselines = usable.map((day) => cumulative(day, point)).filter((total) => total > 0);
  if (!baselines.length) return null;
  const average = baselines.reduce((sum, total) => sum + total, 0) / baselines.length;
  return average > 0 ? soFar / average : null;
}

/**
 * One index or ticker's session, plus the days behind it that scale its volume.
 *
 * Five days are requested rather than one because the extra four cost the same
 * round trip and are the only way to say whether today is busy. The session
 * shown is always the last day present, so a request made before the opening
 * bell shows yesterday rather than an empty chart.
 */
export async function fetchIntraday(symbol: string, name: string): Promise<IntradaySnapshot> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=5m`;
  let lastStatus = 0;
  for (const base of BASE_URLS()) {
    const response = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 FinScope/1.0" },
    });
    lastStatus = response.status;
    if (!response.ok) continue;
    const result = IntradaySchema.parse(await response.json()).chart.result?.[0];
    if (!result) continue;

    const offset = result.meta.gmtoffset;
    const quote = result.indicators.quote[0] ?? {};
    const stamps = result.timestamp ?? [];

    // Group every interval by the day it belongs to at the exchange, so the
    // session boundary is the market's midnight and not the reader's.
    const byDay = new Map<string, number[]>();
    for (let index = 0; index < stamps.length; index++) {
      const day = localDate(stamps[index], offset);
      const bucket = byDay.get(day);
      if (bucket) bucket.push(index); else byDay.set(day, [index]);
    }
    const days = [...byDay.keys()].sort();
    const sessionDate = days.at(-1) ?? localDate(Math.floor(Date.now() / 1000), offset);
    const todayIndices = byDay.get(sessionDate) ?? [];

    const bars: IntradayBar[] = [];
    for (const index of todayIndices) {
      const open = quote.open?.[index], high = quote.high?.[index], low = quote.low?.[index], close = quote.close?.[index];
      // An interval with no trade in it is a gap in the data, not a bar at
      // zero, and drawing it as one would put a spike through every chart.
      if (open == null || high == null || low == null || close == null) continue;
      bars.push({ time: stamps[index], label: localTime(stamps[index], offset), open, high, low, close, volume: quote.volume?.[index] ?? null });
    }

    const volumesFor = (day: string) => (byDay.get(day) ?? []).map((index) => quote.volume?.[index] ?? null);
    const previous = days.slice(0, -1).map(volumesFor);

    // Yesterday's official close — `previousClose`, never `chartPreviousClose`.
    // Over a five-day range the latter is the close before the whole window,
    // five sessions back, so trusting it reported the S&P down eight points on
    // a day it was down forty. The fallback derives it from the last print of
    // the previous session here, which is within a fraction of a percent but
    // not identical: the official close comes out of the closing auction and
    // the last five-minute bar does not contain it.
    const previousDay = days.at(-2);
    const derivedPreviousClose = previousDay
      ? (byDay.get(previousDay) ?? []).map((index) => quote.close?.[index]).filter((close): close is number => close != null).at(-1)
      : undefined;
    const previousClose = result.meta.previousClose ?? derivedPreviousClose ?? null;
    const last = result.meta.regularMarketPrice ?? bars.at(-1)?.close ?? null;
    const regular = result.meta.currentTradingPeriod?.regular;
    const now = Math.floor(Date.now() / 1000);

    return {
      symbol: result.meta.symbol,
      name,
      currency: result.meta.currency,
      timezone: result.meta.exchangeTimezoneName,
      sessionDate,
      last,
      previousClose,
      change: last != null && previousClose != null ? last - previousClose : null,
      changePercent: last != null && previousClose != null && previousClose !== 0 ? (last - previousClose) / previousClose : null,
      high: result.meta.regularMarketDayHigh ?? null,
      low: result.meta.regularMarketDayLow ?? null,
      asOf: result.meta.regularMarketTime ?? null,
      open: regular ? now >= regular.start && now < regular.end : false,
      bars,
      relativeVolume: relativeVolume(volumesFor(sessionDate), previous),
    };
  }
  throw new Error(`Yahoo Finance returned ${lastStatus || "no response"}.`);
}

/* ---- Longer windows ----------------------------------------------------
   The session above answers "what is the market doing right now". Everything
   below answers "and what has it done since", which is a different question
   with a different baseline: a day is measured from yesterday's close, and a
   month is measured from where it started. */

export type MarketRange = "1D" | "5D" | "1M" | "6M" | "1Y" | "5Y";

/**
 * What to ask Yahoo for, per window.
 *
 * The interval is chosen so every window comes back as roughly one to three
 * hundred points: enough that the shape of the period is honest, few enough
 * that the line is not drawing several pixels per point. A five-year chart at
 * daily resolution would be 1,250 points across 400 pixels, which is three
 * points per pixel and a fatter line, not a more accurate one.
 */
const RANGE_QUERY: Record<MarketRange, { range: string; interval: string }> = {
  "1D": { range: "5d", interval: "5m" },
  "5D": { range: "5d", interval: "15m" },
  "1M": { range: "1mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
};

export const MARKET_RANGES = Object.keys(RANGE_QUERY) as MarketRange[];

export interface MarketPoint {
  /** Epoch seconds. */
  time: number;
  /** Exchange-local, "HH:MM" within a day and "YYYY-MM-DD" across days. */
  label: string;
  close: number;
}

export interface MarketWindow {
  symbol: string;
  name: string;
  currency: string;
  timezone: string;
  range: MarketRange;
  points: MarketPoint[];
  /**
   * The level the window is measured from.
   *
   * Yesterday's official close for a single day, because that is what "up
   * today" means; the first point of the window for anything longer, because
   * that is what "up this month" means. Naming it once here is what keeps the
   * chart's dashed line and the headline percentage from disagreeing.
   */
  baseline: number | null;
  last: number | null;
  change: number | null;
  changePercent: number | null;
  /** Whether the exchange is trading right now. Only meaningful intraday. */
  open: boolean;
  asOf: number | null;
  /** The session a single-day window covers. */
  sessionDate: string;
}

/**
 * One index over a chosen window, as a line.
 *
 * Deliberately close/only: the high and low of a five-minute bar were never
 * legible at panel width, and across a year they are noise around a shape the
 * closes already describe. Bars with no trade are dropped rather than drawn at
 * zero, which would put a spike through every chart.
 */
export async function fetchMarketWindow(symbol: string, name: string, range: MarketRange = "1D"): Promise<MarketWindow> {
  const query = RANGE_QUERY[range] ?? RANGE_QUERY["1D"];
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${query.range}&interval=${query.interval}`;
  let lastStatus = 0;
  for (const base of BASE_URLS()) {
    const response = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 FinScope/1.0" },
    });
    lastStatus = response.status;
    if (!response.ok) continue;
    const result = IntradaySchema.parse(await response.json()).chart.result?.[0];
    if (!result) continue;

    const offset = result.meta.gmtoffset;
    const quote = result.indicators.quote[0] ?? {};
    const stamps = result.timestamp ?? [];
    // Only a single session wants clock labels. A five-session chart used to
    // stamp every point as 09:30, 09:45… again and again, so its date axis had
    // no dates to print even though all five sessions were present.
    const intraday = range === "1D";

    const all: MarketPoint[] = [];
    for (let index = 0; index < stamps.length; index++) {
      const close = quote.close?.[index];
      if (close == null) continue;
      all.push({
        time: stamps[index],
        label: intraday ? localTime(stamps[index], offset) : localDate(stamps[index], offset),
        close,
      });
    }

    const sessionDate = all.length
      ? localDate(all[all.length - 1].time, offset)
      : localDate(Math.floor(Date.now() / 1000), offset);

    // A single day keeps only that day, and measures from the official close
    // before it. Anything longer keeps the whole window and measures from where
    // the window opened.
    const points = range === "1D"
      ? all.filter((point) => localDate(point.time, offset) === sessionDate)
      : all;

    let baseline: number | null;
    if (range === "1D") {
      const previous = all.filter((point) => localDate(point.time, offset) < sessionDate).at(-1)?.close;
      baseline = result.meta.previousClose ?? previous ?? null;
    } else if (range === "5D") {
      // Across Yahoo's five-day response, chartPreviousClose is the official
      // close immediately before the entire window. The first point is a
      // fifteen-minute close inside session one, not "five sessions ago".
      baseline = result.meta.chartPreviousClose ?? points[0]?.close ?? null;
    } else {
      baseline = points[0]?.close ?? null;
    }

    const last = (range === "1D" ? result.meta.regularMarketPrice : null) ?? points.at(-1)?.close ?? null;
    const regular = result.meta.currentTradingPeriod?.regular;
    const now = Math.floor(Date.now() / 1000);

    return {
      symbol: result.meta.symbol,
      name,
      currency: result.meta.currency,
      timezone: result.meta.exchangeTimezoneName,
      range,
      points,
      baseline,
      last,
      change: last != null && baseline != null ? last - baseline : null,
      changePercent: last != null && baseline != null && baseline !== 0 ? (last - baseline) / baseline : null,
      open: regular ? now >= regular.start && now < regular.end : false,
      asOf: result.meta.regularMarketTime ?? null,
      sessionDate,
    };
  }
  throw new Error(`Yahoo Finance returned ${lastStatus || "no response"}.`);
}
