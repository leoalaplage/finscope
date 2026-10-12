import type { IoPeriod } from "./view";

/**
 * A company's valuation multiples through time: each month-end over the last
 * decade, struck from that day's close against the trailing figures that were
 * public on the day — the period whose filing came out last before it — and
 * the share count and net debt that filing gave.
 *
 * The close and the share count are on one split basis (the price is the
 * split-adjusted close, and the view moves every share figure onto today's
 * basis), so a month between a split and the next filing is priced right.
 * A multiple on a loss, a negative cash flow or a negative book is not drawn:
 * it is not a multiple, it is a sign.
 *
 * Pure.
 */

export type MultipleKey =
  | "pe" | "pfcf" | "evFcf" | "evEbitda" | "evEbit" | "ps" | "evSales" | "pb" | "ptb"
  | "fcfYield" | "earningsYield" | "dividendYield" | "shareholderYield";

export interface MultipleSpec { key: MultipleKey; label: string; short: string; percent: boolean; formula: string }

export const MULTIPLES: MultipleSpec[] = [
  { key: "pe", label: "Price / earnings", short: "P/E", percent: false, formula: "Market capitalisation ÷ trailing net income to common" },
  { key: "pfcf", label: "Price / free cash flow", short: "P/FCF", percent: false, formula: "Market capitalisation ÷ trailing free cash flow" },
  { key: "evFcf", label: "EV / free cash flow", short: "EV/FCF", percent: false, formula: "Enterprise value ÷ trailing free cash flow" },
  { key: "evEbitda", label: "EV / EBITDA", short: "EV/EBITDA", percent: false, formula: "Enterprise value ÷ trailing EBITDA" },
  { key: "evEbit", label: "EV / EBIT", short: "EV/EBIT", percent: false, formula: "Enterprise value ÷ trailing operating income" },
  { key: "ps", label: "Price / sales", short: "P/S", percent: false, formula: "Market capitalisation ÷ trailing revenue" },
  { key: "evSales", label: "EV / sales", short: "EV/Sales", percent: false, formula: "Enterprise value ÷ trailing revenue" },
  { key: "pb", label: "Price / book", short: "P/B", percent: false, formula: "Market capitalisation ÷ shareholders' equity" },
  { key: "ptb", label: "Price / tangible book", short: "P/TBV", percent: false, formula: "Market capitalisation ÷ equity less goodwill and intangibles" },
  { key: "fcfYield", label: "Free cash flow yield", short: "FCF yield", percent: true, formula: "Trailing free cash flow ÷ market capitalisation" },
  { key: "earningsYield", label: "Earnings yield", short: "Earnings yield", percent: true, formula: "Trailing net income to common ÷ market capitalisation" },
  { key: "dividendYield", label: "Dividend yield", short: "Dividend yield", percent: true, formula: "Trailing dividends paid ÷ market capitalisation" },
  { key: "shareholderYield", label: "Shareholder yield", short: "Shareholder yield", percent: true, formula: "Trailing dividends plus repurchases net of issuance ÷ market capitalisation; negative where the company issued more stock than it paid out" },
];

export interface PricedDate { date: string; price: number; currency: string | null }
export interface MultiplePoint { date: string; periodLabel: string; values: Partial<Record<MultipleKey, number | null>> }

const positive = (top: number | null | undefined, bottom: number | null | undefined) =>
  top == null || bottom == null || !Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0 || bottom <= 0 ? null : top / bottom;
const yieldOf = (top: number | null | undefined, bottom: number | null | undefined) =>
  top == null || bottom == null || !Number.isFinite(top) || !(bottom > 0) ? null : top / bottom;

/** Every multiple of one period at one price. */
export function multiplesAt(period: IoPeriod, price: number): MultiplePoint["values"] | null {
  const basis = period.valuationBasis;
  if (!basis || !(price > 0) || !(basis.shares > 0)) return null;
  const v = period.values;
  const cap = price * basis.shares;
  const ev = basis.netDebt == null ? null : cap + basis.netDebt;
  const earnings = v.netIncomeToCommon ?? v.netIncome;
  const tangible = v.totalEquity == null ? null : v.totalEquity - (v.goodwill ?? 0) - (v.intangibleAssets ?? 0);
  return {
    pe: positive(cap, earnings),
    pfcf: positive(cap, v.freeCashFlow),
    evFcf: positive(ev, v.freeCashFlow),
    evEbitda: positive(ev, v.ebitda),
    evEbit: positive(ev, v.operatingIncome),
    ps: positive(cap, v.revenue),
    evSales: positive(ev, v.revenue),
    pb: positive(cap, v.totalEquity),
    ptb: positive(cap, tangible),
    fcfYield: yieldOf(v.freeCashFlow, cap),
    earningsYield: yieldOf(earnings, cap),
    dividendYield: v.dividendsPaid == null ? null : yieldOf(Math.abs(v.dividendsPaid), cap),
    // Dividends are paid out whatever their sign in the cash-flow statement; net repurchases are signed, so dilution counts against.
    shareholderYield: v.dividendsPaid == null && v.netShareRepurchases == null
      ? null
      : yieldOf(Math.abs(v.dividendsPaid ?? 0) + (v.netShareRepurchases ?? 0), cap),
  };
}

const DAY = 86_400_000;

/**
 * The multiples at each priced date, from the trailing period public on it.
 * A period older than fifteen months by then is not current enough to price.
 */
export function multipleSeries(periods: IoPeriod[], prices: PricedDate[]): MultiplePoint[] {
  const usable = periods.filter((period) => period.valuationBasis).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const out: MultiplePoint[] = [];
  for (const priced of [...prices].sort((a, b) => a.date.localeCompare(b.date))) {
    let period: IoPeriod | undefined;
    for (const candidate of usable) if (candidate.publishedAt <= priced.date) period = candidate;
    if (!period || Date.parse(priced.date) - Date.parse(period.end) > 456 * DAY) continue;
    if (priced.currency && priced.currency !== period.currency) continue;
    const values = multiplesAt(period, priced.price);
    if (values) out.push({ date: priced.date, periodLabel: period.label, values });
  }
  return out;
}

export interface MultipleStats { current: number | null; median: number | null; mean: number | null; deviation: number | null; low: number | null; high: number | null; percentile: number | null; count: number }

/** Where the latest value sits in the window: median, mean ± one standard deviation, range and percentile. */
export function multipleStats(points: MultiplePoint[], key: MultipleKey): MultipleStats {
  const values = points.map((point) => point.values[key]).filter((value): value is number => value != null && Number.isFinite(value));
  const current = [...points].reverse().find((point) => point.values[key] != null)?.values[key] ?? null;
  if (!values.length) return { current, median: null, mean: null, deviation: null, low: null, high: null, percentile: null, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  const percentile = current == null ? null : sorted.filter((value) => value < current).length / Math.max(1, sorted.length - 1);
  return { current, median, mean, deviation, low: sorted[0], high: sorted.at(-1)!, percentile: percentile == null ? null : Math.min(1, percentile), count: values.length };
}

/** Month-ends from `years` before `today` up to the last one before it, at most 120 (the price endpoint's limit). */
export function monthEnds(today: string, years = 10): string[] {
  const end = new Date(`${today.slice(0, 10)}T00:00:00Z`);
  const out: string[] = [];
  for (let back = years * 12; back >= 1; back--) {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - back + 1, 0));
    out.push(date.toISOString().slice(0, 10));
  }
  return out.slice(-120);
}
