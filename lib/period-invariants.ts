import { derivedValue, valueOf } from "./finance";
import { METRICS } from "./metrics";
import type { CompanyDataset, FinancialPeriod, MetricKey } from "./types";

/**
 * Checks that hold *between* periods, which the per-period invariants cannot see.
 *
 * A trailing window is only trustworthy if it equals the quarters it claims to
 * sum, and a reported year is only trustworthy if its own quarters add back to
 * it. Both are arithmetic on figures already published, so a failure is a real
 * problem in the data rather than a difference of opinion — and both are exactly
 * the kind of error that produces a chart which looks perfectly reasonable.
 */
export interface PeriodInvariantResult {
  ticker: string;
  invariant: string;
  metric: string;
  period: string;
  observed: number | null;
  recalculated: number | null;
  /** Absolute difference over the larger magnitude. */
  relativeDifference: number | null;
  status: "passed" | "failed" | "not-applicable";
  detail: string;
}

/**
 * A tenth of a percent.
 *
 * Filings round to millions, and four rounded quarters will not add to a
 * rounded year exactly. Anything beyond this is not rounding.
 */
const TOLERANCE = .001;

const FLOWS: MetricKey[] = ["revenue", "grossProfit", "operatingIncome", "netIncome", "operatingCashFlow", "capitalExpenditures"];

function compare(
  ticker: string, invariant: string, metric: string, period: string,
  observed: number | null, recalculated: number | null, detail: string,
): PeriodInvariantResult {
  if (observed == null || recalculated == null || !Number.isFinite(observed) || !Number.isFinite(recalculated)) {
    return { ticker, invariant, metric, period, observed, recalculated, relativeDifference: null, status: "not-applicable", detail: "A figure this check needs is not reported." };
  }
  const scale = Math.max(Math.abs(observed), Math.abs(recalculated));
  const relativeDifference = scale === 0 ? 0 : Math.abs(observed - recalculated) / scale;
  return { ticker, invariant, metric, period, observed, recalculated, relativeDifference, status: relativeDifference <= TOLERANCE ? "passed" : "failed", detail };
}

const sorted = (dataset: CompanyDataset, periodicity: string) =>
  dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

/** The four quarters of a fiscal year, only when all four are present. */
function quartersOf(dataset: CompanyDataset, fiscalYear: number): FinancialPeriod[] | null {
  const quarters = sorted(dataset, "quarterly").filter((period) => period.fiscalYear === fiscalYear);
  return quarters.length === 4 ? quarters : null;
}

export function runPeriodInvariants(dataset: CompanyDataset): PeriodInvariantResult[] {
  const results: PeriodInvariantResult[] = [];
  const ticker = dataset.company.ticker;

  // A reported year against its own four quarters.
  for (const year of sorted(dataset, "annual")) {
    const quarters = quartersOf(dataset, year.fiscalYear);
    if (!quarters) continue;
    for (const metric of FLOWS) {
      const parts = quarters.map((quarter) => valueOf(quarter, metric));
      if (parts.some((part) => part == null)) continue;
      results.push(compare(ticker, "Annual = Q1 + Q2 + Q3 + Q4", metric, year.periodEnd,
        valueOf(year, metric), parts.reduce((sum: number, part) => sum + part!, 0),
        `${METRICS[metric]?.label ?? metric} for FY${year.fiscalYear} against the four quarters the filer reported inside it.`));
    }
  }

  // A trailing window against the four quarters it claims to sum.
  const quarterly = sorted(dataset, "quarterly");
  for (const window of sorted(dataset, "ttm")) {
    const index = quarterly.findIndex((quarter) => quarter.periodEnd === window.periodEnd);
    if (index < 3) continue;
    const parts = quarterly.slice(index - 3, index + 1);
    for (const metric of FLOWS) {
      const values = parts.map((quarter) => valueOf(quarter, metric));
      if (values.some((value) => value == null)) continue;
      results.push(compare(ticker, "TTM = four consecutive quarters", metric, window.periodEnd,
        valueOf(window, metric), values.reduce((sum: number, value) => sum + value!, 0),
        `${METRICS[metric]?.label ?? metric} trailing to ${window.periodEnd}.`));
    }
  }

  // Every margin against its own definition, and every per-share figure
  // against the share count it is supposed to have used.
  for (const period of dataset.periods) {
    const revenue = valueOf(period, "revenue");
    for (const [margin, numerator] of [
      ["grossMargin", "grossProfit"], ["operatingMargin", "operatingIncome"],
      ["netMargin", "netIncome"], ["operatingCashFlowMargin", "operatingCashFlow"],
      ["freeCashFlowMargin", "freeCashFlow"],
    ] as const) {
      const top = derivedValue(period, numerator);
      if (top == null || revenue == null || revenue === 0) continue;
      results.push(compare(ticker, "Margin = metric / revenue", margin, period.periodEnd,
        derivedValue(period, margin), top / revenue, `${METRICS[margin]?.label ?? margin} in ${period.label}.`));
    }

    const shares = valueOf(period, "dilutedShares");
    if (shares == null || shares === 0) continue;
    for (const [perShare, total] of [
      ["revenuePerShare", "revenue"], ["netIncomePerShare", "netIncome"],
      ["operatingCashFlowPerShare", "operatingCashFlow"], ["freeCashFlowPerShare", "freeCashFlow"],
    ] as const) {
      const top = derivedValue(period, total);
      if (top == null) continue;
      results.push(compare(ticker, "Per share = total / diluted shares", perShare, period.periodEnd,
        derivedValue(period, perShare), top / shares, `${METRICS[perShare]?.label ?? perShare} in ${period.label}.`));
    }
  }

  return results;
}

export interface InvariantSummary {
  ticker: string;
  passed: number;
  failed: number;
  notApplicable: number;
  /** The worst failures first, so a report leads with what matters. */
  worst: PeriodInvariantResult[];
}

export function summariseInvariants(results: PeriodInvariantResult[], ticker: string, limit = 5): InvariantSummary {
  const failures = results.filter((item) => item.status === "failed")
    .sort((left, right) => (right.relativeDifference ?? 0) - (left.relativeDifference ?? 0));
  return {
    ticker,
    passed: results.filter((item) => item.status === "passed").length,
    failed: failures.length,
    notApplicable: results.filter((item) => item.status === "not-applicable").length,
    worst: failures.slice(0, limit),
  };
}
