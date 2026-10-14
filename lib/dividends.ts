import type { DividendPayment } from "./adapters/yahoo-dividends";

/**
 * A dividend record read the way an income investor reads one: how much a
 * year, how often, how fast it has grown, how many years in a row it has been
 * raised, and when the next one should go ex.
 *
 * Pure: payments in (lib/adapters/yahoo-dividends.ts), figures out. A payment
 * well above the regular ones around it is a special dividend: counted in the
 * year's cash, left out of the rate and the growth.
 */

export interface DividendYear {
  year: number;
  /** Cash paid in the year, regular and special. */
  regular: number; special: number;
  payments: number;
  /** The year's rate: its average regular payment times the frequency, so a year with an extra or a missing ex-date is not read as a raise or a cut. */
  rate: number;
  complete: boolean;
}

export interface DividendRecord {
  /** Payments a year: 12, 4, 2 or 1. */
  frequency: number | null;
  /** The last regular payment times the frequency. */
  annualRate: number | null;
  /** What was paid over the last twelve months, specials included. */
  trailing: number;
  years: DividendYear[];
  growth1: number | null; growth5: number | null; growth10: number | null;
  /** Complete years in a row with a higher regular dividend than the year before. */
  raisedYears: number;
  /** Whether that run goes back to the first year on record: the true run is longer. */
  raisedSinceRecord: boolean;
  /** Complete years in a row without a lower one. */
  uncutYears: number;
  /** The next ex-date the rhythm points to, where there is one; an expectation, not an announcement. */
  nextExpected: string | null;
  last: DividendPayment | null;
  /** Each payment with whether it was special, newest first. */
  payments: Array<DividendPayment & { special: boolean; change: number | null }>;
}

const DAY = 86_400_000;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function dividendRecord(payments: DividendPayment[], today = new Date()): DividendRecord | null {
  if (!payments.length) return null;
  const sorted = [...payments].sort((left, right) => left.date.localeCompare(right.date));
  const gaps = sorted.slice(1).map((payment, index) => (Date.parse(payment.date) - Date.parse(sorted[index].date)) / DAY).slice(-12);
  const gap = median(gaps);
  const frequency = gap == null ? null : gap <= 45 ? 12 : gap <= 120 ? 4 : gap <= 240 ? 2 : 1;

  // Special: more than 1.75 times the median of the six regular-looking payments around it.
  const marked = sorted.map((payment, index) => {
    const around = sorted.slice(Math.max(0, index - 3), index + 4).filter((_, at) => at !== Math.min(3, index)).map((entry) => entry.amount);
    const typical = median(around);
    return { ...payment, special: typical != null && around.length >= 3 && payment.amount > typical * 1.75 };
  });
  const regular = marked.filter((payment) => !payment.special);
  const last = regular.at(-1) ?? null;

  const thisYear = today.getUTCFullYear();
  const byYear = new Map<number, DividendYear>();
  for (const payment of marked) {
    const year = Number(payment.date.slice(0, 4));
    const entry = byYear.get(year) ?? { year, regular: 0, special: 0, payments: 0, rate: 0, complete: year < thisYear };
    if (payment.special) entry.special += payment.amount; else { entry.regular += payment.amount; entry.payments++; }
    byYear.set(year, entry);
  }
  // The first year on record may have started part-way: only years with a full set of payments count as complete.
  const years = [...byYear.values()].sort((a, b) => a.year - b.year)
    .map((entry) => ({ ...entry, rate: entry.payments && frequency ? (entry.regular / entry.payments) * frequency : entry.regular }));
  if (years.length && frequency && years[0].payments < frequency) years[0].complete = false;
  const complete = years.filter((entry) => entry.complete && entry.rate > 0);
  const cagr = (span: number) => {
    const end = complete.at(-1), start = complete.find((entry) => end && entry.year === end.year - span);
    return end && start && start.rate > 0 ? (end.rate / start.rate) ** (1 / span) - 1 : null;
  };
  let raisedYears = 0;
  for (let index = complete.length - 1; index > 0 && complete[index].year === complete[index - 1].year + 1 && complete[index].rate > complete[index - 1].rate * 1.0005; index--) raisedYears++;
  let uncutYears = 0;
  for (let index = complete.length - 1; index > 0 && complete[index].year === complete[index - 1].year + 1 && complete[index].rate >= complete[index - 1].rate * 0.995; index--) uncutYears++;
  const raisedSinceRecord = raisedYears > 0 && raisedYears === complete.length - 1;

  const yearAgo = new Date(today.getTime() - 365 * DAY).toISOString().slice(0, 10);
  const trailing = marked.filter((payment) => payment.date > yearAgo).reduce((sum, payment) => sum + payment.amount, 0);
  // A payer that has missed two of its rhythm's dates is not about to pay again on schedule.
  const lastDate = sorted.at(-1)!.date;
  const next = gap != null ? new Date(Date.parse(lastDate) + gap * DAY) : null;
  const nextExpected = next && next.getTime() > today.getTime() - 2 * DAY && next.getTime() - today.getTime() < 2 * gap! * DAY ? next.toISOString().slice(0, 10) : null;
  const lapsed = gap != null && today.getTime() - Date.parse(lastDate) > 2.2 * gap * DAY;

  return {
    frequency,
    annualRate: last && frequency && !lapsed ? last.amount * frequency : null,
    trailing,
    years,
    growth1: cagr(1), growth5: cagr(5), growth10: cagr(10),
    raisedYears, raisedSinceRecord, uncutYears,
    nextExpected: lapsed ? null : nextExpected,
    last,
    payments: marked.reverse().map((payment, index, list) => {
      const before = list.slice(index + 1).find((entry) => !entry.special);
      return { ...payment, change: !payment.special && before ? payment.amount / before.amount - 1 : null };
    }),
  };
}
