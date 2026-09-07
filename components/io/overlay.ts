
/**
 * Joining a traded price to a filed period, and nothing else.
 *
 * The company page draws one point per period and places it by its position in
 * the series, so a share price shown beside a measure has to *be* those periods
 * rather than a daily line laid over them. These functions are that join, kept
 * apart from the component so every part of it can be checked directly.
 */

export interface Bar { date: string; close: number }

/** A close, and the session it actually happened on. */
export interface Close { value: number; on: string }

/** How far before the first period the quotes are asked for, in days. */
const LEAD_IN_DAYS = 45;

/**
 * The last close on or before each of the dates given, and its own date.
 *
 * A filed measure exists on the day the period ended; a price exists on days the
 * market was open, which is rarely the same day. Reading the price *as of* each
 * period end is the only join between the two that never invents a session:
 * every point on the overlay is a close that actually happened, on or just
 * before the day the company closed its books. Never after it — a close from
 * the week following a period end is a fact the reader of that period did not
 * have.
 *
 * The date comes back with the figure because the gap between the two is the
 * one thing a reader cannot see on the chart, and the chart has to be able to
 * say it.
 *
 * Both sequences are in date order, so this walks them once.
 */
export function closesAsOf(bars: Bar[], dates: string[]): Array<Close | null> {
  const found: Array<Close | null> = [];
  let index = 0;
  let last: Close | null = null;
  for (const date of dates) {
    while (index < bars.length && bars[index].date <= date) { last = { value: bars[index].close, on: bars[index].date }; index += 1; }
    found.push(last);
  }
  return found;
}

/**
 * The same closes, except that the newest period carries today's price.
 *
 * The chart stops at the newest period that has been filed. The market does
 * not: it has kept trading through the weeks or months since, and it is that
 * price a reader is holding a measure up against. Reading the last point at its
 * own period end drew a line that stopped where the last filing did — Apple on
 * 7 September 2026 showed $283.78 under "Share price" while the price chart at
 * the top of the same page carried $319.97, thirteen per cent apart, two
 * figures on one screen that could not both be the share price.
 *
 * Every earlier period keeps its own end, because there the chart has a next
 * point and the price at the time is the honest companion to the filing. Only
 * the newest one moves, and it moves to the latest close there is rather than
 * to an extrapolation. The date it moved to comes back with it, so the page can
 * say what it did instead of quietly showing a price the crosshair's date does
 * not name.
 */
export function overlayCloses(bars: Bar[], periodEnds: string[]): Array<Close | null> {
  const closes = closesAsOf(bars, periodEnds);
  const latest = bars.at(-1);
  const last = closes.length - 1;
  if (!latest || last < 0 || closes[last] == null) return closes;
  if (latest.date <= closes[last]!.on) return closes;
  closes[last] = { value: latest.close, on: latest.date };
  return closes;
}

/** Whole days between two ISO dates, or nothing when either is missing. */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The window of quotes an overlay needs, given the periods it must cover.
 *
 * Weekly throughout. It used to drop to monthly past six years, on the reasoning
 * that a chart of twenty annual periods needs no finer grain to draw the same
 * line at the same width — true of the line, false of the points. A monthly bar
 * is stamped at the end of its month, and a fiscal quarter rarely ends there:
 * Apple closes on the last Saturday, so the newest bar at or before 27 June is
 * the one dated 29 May, and the point is priced by a close a month early. Not
 * occasionally — measured over Apple's seventy trailing periods, monthly quotes
 * ran 18.8 days early on average and 29 at worst, weekly 1.1 and 2. Seventeen
 * years of weekly bars is 917 of them against 212, on a payload that was never
 * the problem.
 *
 * The lead-in exists so the earliest period has a close *before* it rather than
 * no close at all.
 */
export function overlayWindow(periods: Array<{ end: string }>) {
  const first = periods[0]?.end;
  if (!first) return null;
  const start = new Date(`${first}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - LEAD_IN_DAYS);
  return {
    frequency: "weekly" as const,
    start: start.toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10),
  };
}
