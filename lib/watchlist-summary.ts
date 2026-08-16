import { derivedValue } from "./finance";
import type { CompanyDataset, FinancialPeriod } from "./types";

/**
 * The few figures a watchlist card shows, and nothing else.
 *
 * A normalized company is around six megabytes of JSON — 261 KB even gzipped —
 * because it carries every fact of every period with its provenance. Fetching
 * twenty-one of those to render twenty-one cards would move five megabytes over
 * the wire to display eighty numbers, so the numbers are computed once, when the
 * dataset is built, and stored beside it.
 *
 * Market capitalisation is deliberately absent: it needs a price, the page
 * already fetches one per card, and a cap frozen into the cache would be a day
 * old. The share count travels instead and the browser multiplies.
 */
export interface WatchlistSummary {
  ticker: string;
  name: string;
  currency: string;
  /** The period every figure below is taken from. */
  periodEnd: string;
  periodLabel: string;
  shares: number | null;
  revenue: number | null;
  /** Latest full year against the one before it, never a trailing window. */
  revenueGrowth: number | null;
  freeCashFlow: number | null;
  freeCashFlowMargin: number | null;
  cashReturnOnCapital: number | null;
  netDebt: number | null;
}

const sorted = (dataset: CompanyDataset, periodicity: FinancialPeriod["periodicity"]) =>
  dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

/** Trailing twelve months where the filings support it, the last year otherwise. */
export function summaryPeriod(dataset: CompanyDataset): FinancialPeriod | undefined {
  return sorted(dataset, "ttm").at(-1) ?? sorted(dataset, "annual").at(-1);
}

export function summariseDataset(dataset: CompanyDataset): WatchlistSummary | null {
  const period = summaryPeriod(dataset);
  if (!period) return null;
  const annual = sorted(dataset, "annual");
  const latestYear = annual.at(-1); const priorYear = annual.at(-2);
  const thisYear = latestYear ? derivedValue(latestYear, "revenue") : null;
  const lastYear = priorYear ? derivedValue(priorYear, "revenue") : null;
  return {
    ticker: dataset.company.ticker,
    name: dataset.company.name,
    currency: dataset.company.currency,
    periodEnd: period.periodEnd,
    periodLabel: period.label,
    shares: derivedValue(period, "sharesOutstanding") ?? derivedValue(period, "dilutedShares"),
    revenue: derivedValue(period, "revenue"),
    revenueGrowth: thisYear != null && lastYear != null && lastYear > 0 ? thisYear / lastYear - 1 : null,
    freeCashFlow: derivedValue(period, "freeCashFlow"),
    freeCashFlowMargin: derivedValue(period, "freeCashFlowMargin"),
    cashReturnOnCapital: derivedValue(period, "cashReturnOnCapital"),
    netDebt: derivedValue(period, "netDebt"),
  };
}
