import type { CandleInterval } from "../adapters/candles";

/**
 * The arithmetic of the chart page, kept apart from the drawing so it can be
 * tested: how many candles each interval shows, the price scale and the dates
 * written under it.
 */

export const INTERVAL_NAMES: Record<CandleInterval, string> = { "1d": "D", "1wk": "W", "1mo": "M" };
export const INTERVAL_TITLES: Record<CandleInterval, string> = { "1d": "Daily", "1wk": "Weekly", "1mo": "Monthly" };

/** About ten and a half months of sessions, four years of weeks, fifteen years of months. */
export const CANDLES_SHOWN: Record<CandleInterval, number> = { "1d": 220, "1wk": 208, "1mo": 180 };

/** Narrower than this a candle is a line, so a narrow screen shows fewer of them. */
export const MIN_CANDLE_PX = 4;

export function candlesToShow(interval: CandleInterval, available: number, widthPx: number | null): number {
  const fit = widthPx ? Math.floor(widthPx / MIN_CANDLE_PX) : Infinity;
  return Math.max(0, Math.min(CANDLES_SHOWN[interval], available, Math.max(20, fit)));
}

export interface Scale { min: number; max: number; ticks: number[] }

/**
 * A price scale around everything drawn, with round ticks.
 *
 * Padded by a twentieth each side so the highest wick does not touch the top,
 * and ticked at 1, 2, 2.5 or 5 times a power of ten — the steps a reader can
 * add up in their head.
 */
export function priceScale(values: number[], count = 6): Scale | null {
  const known = values.filter(Number.isFinite);
  if (!known.length) return null;
  let min = Math.min(...known);
  let max = Math.max(...known);
  if (min === max) { min -= Math.abs(min || 1) * 0.05; max += Math.abs(max || 1) * 0.05; }
  const pad = (max - min) * 0.05;
  min -= pad;
  max += pad;
  const rough = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((multiple) => multiple * power >= rough) ?? 10) * power;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step) ticks.push(Number(tick.toFixed(10)));
  return { min, max, ticks };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface DateLabel { index: number; text: string }

/**
 * The dates written under the candles.
 *
 * A label where a new month begins for days, a new quarter for weeks, a new
 * year for months — and January always carries its year, so a reader never
 * has to count back to know which one they are in. Labels too close to the
 * previous one are dropped.
 */
export function dateLabels(times: number[], interval: CandleInterval, maxLabels = 8): DateLabel[] {
  const every = interval === "1d" ? 1 : interval === "1wk" ? 3 : 12;
  const found: Array<DateLabel & { month: number }> = [];
  let previous: number | null = null;
  times.forEach((time, index) => {
    const date = new Date(time * 1000);
    const month = date.getUTCFullYear() * 12 + date.getUTCMonth();
    const bucket = Math.floor(month / every);
    if (previous !== null && bucket !== previous) {
      const m = date.getUTCMonth();
      found.push({ index, month, text: interval === "1mo" || m === 0 ? String(date.getUTCFullYear()) : MONTHS[m] });
    }
    previous = bucket;
  });
  /*
   * Too many: keep every second, third… label, counted in months from
   * January, so the thinned row still carries every year it can — "Jan, Jul"
   * rather than "Oct, Apr".
   */
  const steps = [1, 2, 3, 4, 6, 12, 24, 36, 60, 120].filter((months) => months % every === 0);
  const step = steps.find((months) => found.filter((label) => label.month % months === 0).length <= maxLabels) ?? steps[steps.length - 1];
  return found.filter((label) => label.month % step === 0).map(({ index, text }) => ({ index, text }));
}

export function dateText(time: number, interval: CandleInterval): string {
  const date = new Date(time * 1000);
  const month = MONTHS[date.getUTCMonth()];
  if (interval === "1mo") return `${month} ${date.getUTCFullYear()}`;
  const prefix = interval === "1wk" ? "Week of " : "";
  return `${prefix}${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}
