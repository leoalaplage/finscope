import { cagrForPeriods, derivedValue } from "./finance";
import { qsPriceInputs, qsRow, type QsPriceInputs } from "./qs-export";
import type { CompanyDataset, CompanyProfile, FinancialPeriod } from "./types";

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
  /**
   * When the filings behind this digest were read.
   *
   * Carried so the daily warm-up can tell a current company from a stale one
   * without reading the six-megabyte dataset back to look at its own timestamp.
   * See `refreshableTickers` in dataset-cache.ts: before this existed the timer
   * skipped anything already cached, so a company was only ever rebuilt when
   * its key expired a week later — and a set of results published the day after
   * a build stayed invisible for the rest of that week.
   */
  retrievedAt: string;
  /**
   * Whether this is a bank, broker or exchange.
   *
   * A card must not state a free-cash-flow margin for one. Carried on the
   * digest rather than read from the reader's own watchlist entry, because a
   * company they added themselves has whatever profile the SEC search produced
   * and the digest is built from the dataset that was actually normalized.
   */
  businessType: CompanyProfile["businessType"];
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
  /**
   * The three figures the card actually shows, all measured over five years.
   *
   * A single year's margin moves with one heavy investment year and a single
   * year's return moves with one acquisition, so a card built from the latest
   * reading ranks companies by whichever of them happened to have a quiet
   * twelve months. Five years is short enough to still describe the business
   * as it is now and long enough that one year cannot carry it.
   *
   * The margin is stated after stock-based compensation because that is the
   * cash the owner actually keeps: pay settled in shares never leaves the cash
   * flow statement, so a margin before it credits the company with money it
   * handed to its employees.
   */
  freeCashFlowAfterSbcMargin5Y: number | null;
  cashReturnOnCapital5Y: number | null;
  freeCashFlowPerShareCagr5Y: number | null;
  /**
   * The company's row of the QS Screener's table, minus the four columns that
   * need a live price. Computed here so the screener can score the watchlist
   * without anyone pasting an export of it from somewhere else.
   */
  qs: Record<string, number | string | null>;
  qsPrice: QsPriceInputs;
}

const sorted = (dataset: CompanyDataset, periodicity: FinancialPeriod["periodicity"]) =>
  dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

/**
 * The mean of a metric over the last five reported years.
 *
 * Three years is the floor rather than five, because a company that listed four
 * years ago has a real five-year-average-shaped answer and refusing it would
 * leave the card emptier than the filings warrant. Fewer than three is an
 * average of one good year and is not reported.
 */
function fiveYearAverage(annual: FinancialPeriod[], metric: string): number | null {
  const values = annual.slice(-5).map((period) => derivedValue(period, metric)).filter((value): value is number => value != null && Number.isFinite(value));
  return values.length < 3 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

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
    retrievedAt: dataset.retrievedAt,
    businessType: dataset.company.businessType,
    periodEnd: period.periodEnd,
    periodLabel: period.label,
    shares: derivedValue(period, "sharesOutstanding") ?? derivedValue(period, "dilutedShares"),
    revenue: derivedValue(period, "revenue"),
    revenueGrowth: thisYear != null && lastYear != null && lastYear > 0 ? thisYear / lastYear - 1 : null,
    freeCashFlow: derivedValue(period, "freeCashFlow"),
    freeCashFlowMargin: derivedValue(period, "freeCashFlowMargin"),
    cashReturnOnCapital: derivedValue(period, "cashReturnOnCapital"),
    netDebt: derivedValue(period, "netDebt"),
    freeCashFlowAfterSbcMargin5Y: fiveYearAverage(annual, "freeCashFlowAfterSbcMargin"),
    cashReturnOnCapital5Y: fiveYearAverage(annual, "cashReturnOnCapital"),
    freeCashFlowPerShareCagr5Y: cagrForPeriods(annual, "freeCashFlowPerShare", 5).value,
    qs: qsRow(dataset, null).values,
    qsPrice: qsPriceInputs(dataset),
  };
}
