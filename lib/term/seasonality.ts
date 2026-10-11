/**
 * Seasonality: each calendar month's return, year by year, and what the
 * months have done on average — the median, the mean and how often they rose.
 *
 * Read from monthly bars, each month's close against the month before's, so a
 * month that is still running is counted as it stands and marked as such.
 */

export interface MonthlyBars { t: number[]; c: number[] }
export interface SeasonYear { year: number; months: Array<number | null> }
export interface MonthStats { mean: number | null; median: number | null; up: number; count: number }

export function seasonality(bars: MonthlyBars, now = new Date()): { years: SeasonYear[]; stats: MonthStats[]; running: { year: number; month: number } | null } {
  const byYear = new Map<number, Array<number | null>>();
  for (let index = 1; index < bars.c.length; index++) {
    const date = new Date(bars.t[index] * 1000);
    const year = date.getUTCFullYear();
    if (!byYear.has(year)) byYear.set(year, new Array(12).fill(null));
    byYear.get(year)![date.getUTCMonth()] = bars.c[index] / bars.c[index - 1] - 1;
  }
  const years = [...byYear].map(([year, months]) => ({ year, months })).sort((a, b) => b.year - a.year);
  const stats = Array.from({ length: 12 }, (_, month): MonthStats => {
    const values = years.map((row) => row.months[month]).filter((value): value is number => value != null);
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return {
      mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      median: sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null,
      up: values.filter((value) => value > 0).length,
      count: values.length,
    };
  });
  const last = bars.t.length ? new Date(bars.t[bars.t.length - 1] * 1000) : null;
  const running = last && last.getUTCFullYear() === now.getUTCFullYear() && last.getUTCMonth() === now.getUTCMonth()
    ? { year: last.getUTCFullYear(), month: last.getUTCMonth() }
    : null;
  return { years, stats, running };
}
