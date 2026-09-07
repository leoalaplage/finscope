
/**
 * Putting a traded price and a filed measure on one frame, and nothing else.
 *
 * The two are quoted at grains an order of magnitude apart — a close every week
 * against a figure every quarter — so the frame cannot be a row of positions
 * both of them fill. It is a stretch of time, and each line is placed in it by
 * its own dates: the price keeps every close it has, the measure keeps its
 * periods, and the measure's line simply ends before the right edge when the
 * market has traded past the last filing.
 *
 * These functions are that placement, kept apart from the component so every
 * part of it can be checked directly.
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
 * The price itself, at the grain it was quoted, over the window a chart covers.
 *
 * One point per filed period is the right shape for a *measure* and the wrong
 * one for a price. A year of trailing quarters is five points, and five points
 * drew the share price as four straight lines between quarter ends: the low of
 * the year was whichever quarter end happened to catch it, a fall and a
 * recovery inside one quarter did not exist, and the reader was looking at a
 * line that no longer resembled the thing it was named after.
 *
 * So the price keeps every close in the window instead. It starts on the first
 * period end — the same instant the measure starts, so the two lines share a
 * left edge — and runs to the newest close there is. Nothing is averaged,
 * resampled or interpolated; these are the weekly closes as they came.
 */
export function priceSeries(bars: Bar[], from: string): Close[] {
  const opening = closesAsOf(bars, [from])[0];
  const after = bars.filter((bar) => bar.date > from).map((bar) => ({ value: bar.close, on: bar.date }));
  return opening ? [{ value: opening.value, on: from }, ...after] : after;
}

/**
 * Where each date falls across a window, as a fraction of its width.
 *
 * Two series on one frame only share an x axis if that axis means something to
 * both of them. Spread by position it means nothing: fifty-two weekly closes
 * and five quarters spread evenly across the same frame put week thirteen and
 * quarter two in different places, and the crosshair would name a date for one
 * line while pointing at another date on the other. Placed by their dates, both
 * lines are on the same axis — time — and the measure simply stops before the
 * right edge, which is the truth about it.
 */
export function positions(dates: string[], from: string, to: string): number[] {
  const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
  const span = end - start;
  if (!Number.isFinite(span) || span <= 0) return dates.map((_, index) => (dates.length < 2 ? 0.5 : index / (dates.length - 1)));
  return dates.map((date) => Math.min(1, Math.max(0, (Date.parse(`${date}T00:00:00Z`) - start) / span)));
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
