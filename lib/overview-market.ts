import { derivedValue } from "./finance";
import type { FinancialPeriod, MarketBar } from "./types";

export interface PeriodCandle { open: number; high: number; low: number; close: number }

/**
 * Whether a market bar falls inside a reported period's window.
 *
 * A bar carries the span it covers, not just the day it ends on, and a fiscal
 * quarter rarely ends on a Friday: Apple's closes on a Saturday in late June,
 * three days before the week that contains it. Comparing end dates alone would
 * drop that week and shorten every candle by its last few sessions, so a bar
 * belongs to the period its span reaches into.
 */
const within = (bar: MarketBar, start: string, end: string) => bar.periodStart <= end && bar.date > start;

/**
 * One candle per reported period, so the price card shares its x-axis with
 * every other card on the page.
 *
 * Aggregating market sessions into fiscal quarters rather than calendar ones is
 * the point: a reader comparing the price against the revenue underneath it is
 * comparing the same window, and the labels line up across the grid.
 *
 * Open, high and low are the provider's own; where it reports none for a
 * session the close stands in, which is what a bar with no intraday range
 * means. A period with no sessions at all returns null rather than a flat
 * candle at the last known price.
 */
export function candlesForPeriods(periods: Array<{ periodEnd: string }>, bars: MarketBar[]): Array<PeriodCandle | null> {
  const sorted = [...bars].sort((left, right) => left.date.localeCompare(right.date));
  return periods.map((period, index) => {
    // The first period has no predecessor to bound it, so it takes a quarter.
    const previous = periods[index - 1]?.periodEnd ?? shiftDays(period.periodEnd, -92);
    const inside = sorted.filter((bar) => within(bar, previous, period.periodEnd));
    if (!inside.length) return null;
    const highs = inside.map((bar) => bar.high ?? bar.close).filter(Number.isFinite);
    const lows = inside.map((bar) => bar.low ?? bar.close).filter(Number.isFinite);
    const open = inside[0].open ?? inside[0].close;
    const close = inside.at(-1)!.close;
    if (![open, close].every(Number.isFinite) || !highs.length || !lows.length) return null;
    return { open, high: Math.max(...highs, open, close), low: Math.min(...lows, open, close), close };
  });
}

function shiftDays(date: string, days: number) {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/**
 * The last close on or before a date.
 *
 * Never a later one: pricing a period against a session that had not happened
 * when it closed would value the company on information the date does not
 * carry. A gap wider than the tolerance returns nothing rather than reaching
 * back for a stale price.
 */
export function closeOn(bars: MarketBar[], date: string, toleranceDays = 14): number | null {
  let best: MarketBar | null = null;
  for (const bar of bars) {
    if (bar.date > date) continue;
    if (!best || bar.date > best.date) best = bar;
  }
  if (!best) return null;
  const gap = (Date.parse(date) - Date.parse(best.date)) / 86_400_000;
  if (!Number.isFinite(gap) || gap > toleranceDays) return null;
  return Number.isFinite(best.close) && best.close > 0 ? best.close : null;
}

/**
 * Free cash flow yield at a date: the cash the trailing year produced against
 * what the whole company cost that day.
 *
 * The same definition `valuationSnapshot` uses — free cash flow over price
 * times shares, and unavailable rather than negative when the year burned cash,
 * because a negative yield is not a cheaper company. A test holds the two to
 * the same answer.
 */
export function freeCashFlowYieldOn(period: FinancialPeriod, price: number | null): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  const shares = derivedValue(period, "sharesOutstanding") ?? derivedValue(period, "dilutedShares");
  const freeCashFlow = derivedValue(period, "freeCashFlow");
  if (shares == null || shares <= 0 || freeCashFlow == null || freeCashFlow <= 0) return null;
  return freeCashFlow / (price * shares);
}

/**
 * The periods falling inside the last `years` of reported history.
 *
 * By date, not by count: a trailing series is not always four to the year — a
 * quarter a filer never made recoverable leaves a hole — so taking the last
 * forty periods labels the window "10Y" while showing nearly twelve. An
 * infinite span returns everything, which is the case a finite sentinel got
 * wrong: `MAX_SAFE_INTEGER` years before 2026 is not a date, and asking for one
 * threw where it should have returned the lot.
 */
export function periodsWithin<T extends { periodEnd: string }>(periods: T[], years: number): T[] {
  const end = periods.at(-1)?.periodEnd;
  if (!end || !Number.isFinite(years) || years <= 0) return periods;
  const cutoff = new Date(`${end}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  // Checked after the shift, not before it: the subtraction is what makes the
  // date unrepresentable, and checking the date it started from proves nothing.
  if (Number.isNaN(cutoff.getTime())) return periods;
  const from = cutoff.toISOString().slice(0, 10);
  return periods.filter((period) => period.periodEnd >= from);
}
