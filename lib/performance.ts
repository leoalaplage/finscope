import type { MarketSession } from "./adapters/yahoo";

/**
 * The windows a performance table states, and how far back each one reaches.
 *
 * Calendar distances rather than counts of sessions: "a month" is a month a
 * reader can check against their own memory, where "twenty-one trading days"
 * is a number only the machine finds natural. Year to date is not a distance at
 * all — it is the last close of the previous year, whenever that was — so it
 * carries no days and is computed apart.
 */
/**
 * The four windows the table states, and what each figure is.
 *
 * A day and a year to date are total moves: over that long, a move is what a
 * reader means. Five and ten years are annualised, because a cumulative
 * five-hundred per cent tells you nothing about the pace it was earned at and
 * cannot be set beside a one-day change without misleading. `annualised` is not
 * decoration — the label carries "p.a." precisely because +25% a year and +25%
 * over a decade are the same nine characters and opposite facts.
 */
/**
 * What a stored or cached row was computed from.
 *
 * It travels in the URL the page asks with as well as in the key the answer is
 * kept under, because the two caches are different caches: the store is keyed
 * by this and the reader's own browser is keyed by the address. Bumping only
 * the first is how a corrected row sits behind a copy the browser was told it
 * could keep — and for a rate served under a heading that used to mean a total,
 * that is not a stale number but a wrong one.
 *
 * p2 added the ten-year window. p3 cut the four middle ones and annualised the
 * long two.
 */
export const PERFORMANCE_SHAPE = "p3";

export const WINDOWS = [
  { id: "d1", label: "1D", days: 1, annualised: false },
  { id: "ytd", label: "YTD", days: null, annualised: false },
  { id: "y5", label: "5Y p.a.", days: 1826, annualised: true },
  { id: "y10", label: "10Y p.a.", days: 3653, annualised: true },
] as const;

export type WindowId = typeof WINDOWS[number]["id"];

export interface Performance {
  /** The most recent close, and the session it belongs to. */
  price: number | null;
  asOf: string | null;
  changes: Partial<Record<WindowId, number | null>>;
}

const DAY_MS = 86_400_000;

/** Sessions that actually have a close, oldest first. */
function usable(sessions: MarketSession[]): Array<{ date: string; close: number }> {
  return sessions
    .flatMap((session) => {
      const close = session.close ?? session.adjustedClose;
      return close == null ? [] : [{ date: session.date, close }];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * The last session on or before a date.
 *
 * On or before, never after: a window that reached forward would measure a
 * return the market had not yet delivered on the day it claims to start.
 * A target older than the first session we hold has no answer rather than
 * silently anchoring on the earliest one, which would state a five-year return
 * for a company that listed two years ago.
 */
function closeOnOrBefore(rows: Array<{ date: string; close: number }>, target: string): { date: string; close: number } | null {
  if (!rows.length || target < rows[0].date) return null;
  let found: { date: string; close: number } | null = null;
  for (const row of rows) {
    if (row.date > target) break;
    found = row;
  }
  return found;
}

const shiftDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

/**
 * Every window's return for one company, from its daily closes.
 *
 * One pass over one set of sessions answers all seven, which is why the whole
 * table costs one request per company rather than one per cell.
 *
 * The one-day change is the previous *session*, not the previous calendar day:
 * on a Monday the comparison a reader means is Friday's close, and subtracting
 * a day would find nothing and report no move at all over a weekend.
 */
export function performanceOf(sessions: MarketSession[]): Performance {
  const rows = usable(sessions);
  const last = rows.at(-1);
  if (!last) return { price: null, asOf: null, changes: {} };

  const changes: Partial<Record<WindowId, number | null>> = {};
  const total = (base: number | null) => base == null || base === 0 ? null : last.close / base - 1;

  /*
   * The rate that compounds from the anchor to the last close.
   *
   * Over the time actually elapsed, not the length of the window asked for:
   * markets are shut at weekends, so the close on or before a date ten years
   * back is up to four days older than ten years, and dividing by the nominal
   * span would quietly state a rate for a period that is not the one measured.
   *
   * A base at or below nought has no rate to compound — a company cannot be
   * said to have grown at a proportion of a loss — and neither has a span too
   * short to annualise without turning noise into a headline.
   */
  const annualised = (anchor: { date: string; close: number } | null) => {
    if (!anchor || anchor.close <= 0 || last.close <= 0) return null;
    const years = (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${anchor.date}T00:00:00Z`)) / (365.25 * DAY_MS);
    if (!Number.isFinite(years) || years < 1) return null;
    return (last.close / anchor.close) ** (1 / years) - 1;
  };

  for (const window of WINDOWS) {
    if (window.id === "d1") {
      const previous = rows.at(-2);
      changes.d1 = previous ? total(previous.close) : null;
      continue;
    }
    if (window.id === "ytd") {
      // The last close of the previous calendar year, which is what every
      // year-to-date figure anywhere is measured from.
      const yearStart = `${last.date.slice(0, 4)}-01-01`;
      changes.ytd = total(closeOnOrBefore(rows, shiftDays(yearStart, 1))?.close ?? null);
      continue;
    }
    const anchor = closeOnOrBefore(rows, shiftDays(last.date, window.days!));
    changes[window.id] = window.annualised ? annualised(anchor) : total(anchor?.close ?? null);
  }

  return { price: last.close, asOf: last.date, changes };
}
