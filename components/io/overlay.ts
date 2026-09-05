
/**
 * Joining a traded price to a filed period, and nothing else.
 *
 * The company page draws one point per period and places it by its position in
 * the series, so a share price shown beside a measure has to *be* those periods
 * rather than a daily line laid over them. These two functions are that join,
 * kept apart from the component so both halves of it can be checked directly.
 */

export interface Bar { date: string; close: number }

/** How far before the first period the quotes are asked for, in days. */
const LEAD_IN_DAYS = 45;

/**
 * The last close on or before each of the dates given.
 *
 * A filed measure exists on the day the period ended; a price exists on days the
 * market was open, which is rarely the same day. Reading the price *as of* each
 * period end is the only join between the two that never invents a session:
 * every point on the overlay is a close that actually happened, on or just
 * before the day the company closed its books.
 *
 * Both sequences are in date order, so this walks them once.
 */
export function closesAsOf(bars: Bar[], dates: string[]): Array<number | null> {
  const found: Array<number | null> = [];
  let index = 0;
  let last: number | null = null;
  for (const date of dates) {
    while (index < bars.length && bars[index].date <= date) { last = bars[index].close; index += 1; }
    found.push(last);
  }
  return found;
}

/**
 * The window of quotes an overlay needs, given the periods it must cover.
 *
 * Asked at the coarsest granularity that still lands a session on every period:
 * a chart of twenty annual periods needs monthly closes and nothing finer, and
 * asking for daily bars across twenty years is twenty times the payload to draw
 * the same line at the same width. The lead-in exists so the earliest period
 * has a close *before* it rather than no close at all.
 */
export function overlayWindow(periods: Array<{ end: string }>) {
  const first = periods[0]?.end;
  if (!first) return null;
  const start = new Date(`${first}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - LEAD_IN_DAYS);
  const years = (Date.now() - start.getTime()) / (365.25 * 86_400_000);
  return {
    frequency: years > 6 ? "monthly" : "weekly",
    start: start.toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10),
  };
}

