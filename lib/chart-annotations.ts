import type { CompanyDataset } from "./types";

export interface DateBand { start: string; end: string; label: string }
export interface DateMark { date: string; label: string; ticker: string }

/**
 * US recessions as dated by the NBER's Business Cycle Dating Committee, from
 * peak month to trough month.
 *
 * These are fixed historical facts rather than anything derived from a filing,
 * so they are written down rather than fetched. The committee dates a cycle
 * well after it ends, which is why the list stops where it does: an ongoing
 * contraction has no trough yet and would be a guess.
 */
export const US_RECESSIONS: DateBand[] = [
  { start: "2001-03-01", end: "2001-11-30", label: "2001 recession" },
  { start: "2007-12-01", end: "2009-06-30", label: "Great Recession" },
  { start: "2020-02-01", end: "2020-04-30", label: "COVID-19 recession" },
];

/** Recession bands overlapping the drawn window, clipped to it. */
export function recessionBands(from: string, to: string): DateBand[] {
  return US_RECESSIONS
    .filter((band) => band.end >= from && band.start <= to)
    .map((band) => ({ ...band, start: band.start < from ? from : band.start, end: band.end > to ? to : band.end }));
}

/**
 * Disclosed stock splits for the companies on a chart.
 *
 * A split is where a per-share series changes meaning, so marking it explains
 * a step that would otherwise look like a data error.
 */
export function splitMarks(datasets: CompanyDataset[], from: string, to: string): DateMark[] {
  return datasets
    .flatMap((dataset) => (dataset.company.stockSplits ?? []).map((split) => ({
      date: split.date, ticker: dataset.company.ticker, label: `${dataset.company.ticker} ${split.ratio}:1`,
    })))
    .filter((mark) => mark.date >= from && mark.date <= to)
    .sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Snaps an annotation date onto the drawn category axis.
 *
 * The x-axis is a list of observation dates, not a continuous scale, so a date
 * that never appears in the data has nowhere to sit. Returning the nearest
 * drawn date on or after it keeps the mark on the axis rather than dropping it.
 */
export function snapToAxis(dates: string[], target: string): string | null {
  if (!dates.length) return null;
  return dates.find((date) => date >= target) ?? null;
}
