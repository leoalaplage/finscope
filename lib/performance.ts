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
export const WINDOWS = [
  { id: "d1", label: "1D", days: 1 },
  { id: "w1", label: "1W", days: 7 },
  { id: "m1", label: "1M", days: 30 },
  { id: "m3", label: "3M", days: 91 },
  { id: "ytd", label: "YTD", days: null },
  { id: "y1", label: "1Y", days: 365 },
  { id: "y5", label: "5Y", days: 1826 },
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
function closeOnOrBefore(rows: Array<{ date: string; close: number }>, target: string): number | null {
  if (!rows.length || target < rows[0].date) return null;
  let found: number | null = null;
  for (const row of rows) {
    if (row.date > target) break;
    found = row.close;
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
  const from = (base: number | null) => base == null || base === 0 ? null : last.close / base - 1;

  for (const window of WINDOWS) {
    if (window.id === "d1") {
      const previous = rows.at(-2);
      changes.d1 = previous ? from(previous.close) : null;
      continue;
    }
    if (window.id === "ytd") {
      // The last close of the previous calendar year, which is what every
      // year-to-date figure anywhere is measured from.
      const yearStart = `${last.date.slice(0, 4)}-01-01`;
      changes.ytd = from(closeOnOrBefore(rows, shiftDays(yearStart, 1)));
      continue;
    }
    changes[window.id] = from(closeOnOrBefore(rows, shiftDays(last.date, window.days!)));
  }

  return { price: last.close, asOf: last.date, changes };
}
