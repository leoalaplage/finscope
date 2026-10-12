import type { CandleInterval } from "@/lib/adapters/candles";

/**
 * Periods for a chart, as a market screen offers them: a period picks its own
 * candle size, so one day is the session in five-minute candles and five
 * years are weeks. The history behind is read in full and only the period is
 * opened on screen (CandleChart's `openOn`).
 *
 * Pure: candle times in, how many of the latest belong to the period out.
 */

export type ChartRange = "1D" | "1W" | "1M" | "1Q" | "YTD" | "1Y" | "5Y";

export const CHART_RANGES: Array<{ id: ChartRange; interval: CandleInterval; title: string }> = [
  { id: "1D", interval: "5m", title: "Today's session, 5-minute candles" },
  { id: "1W", interval: "15m", title: "Five sessions, 15-minute candles" },
  { id: "1M", interval: "1h", title: "One month, hourly candles" },
  { id: "1Q", interval: "1d", title: "Three months, daily candles" },
  { id: "YTD", interval: "1d", title: "Since 1 January, daily candles" },
  { id: "1Y", interval: "1d", title: "One year, daily candles" },
  { id: "5Y", interval: "1wk", title: "Five years, weekly candles" },
];

const DAY = 86_400;
/** The New York date of a candle, which is the session it belongs to. */
const sessionDay = (time: number) => new Date(time * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** How many of the latest candles fall inside the period, counted back from the last one. */
export function candlesInRange(times: readonly number[], range: ChartRange): number {
  if (!times.length) return 0;
  const last = times[times.length - 1];
  let from: number;
  switch (range) {
    case "1D": {
      const day = sessionDay(last);
      let count = 0;
      for (let index = times.length - 1; index >= 0 && sessionDay(times[index]) === day; index--) count++;
      return count;
    }
    case "1W": from = last - 7 * DAY; break;
    case "1M": from = last - 31 * DAY; break;
    case "1Q": from = last - 92 * DAY; break;
    case "YTD": from = Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000; break;
    case "1Y": from = last - 366 * DAY; break;
    case "5Y": from = last - 5 * 366 * DAY; break;
  }
  let count = 0;
  for (let index = times.length - 1; index >= 0 && times[index] > from; index--) count++;
  return count;
}
