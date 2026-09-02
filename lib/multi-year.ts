import { derivedValue } from "@/lib/finance";
import type { FinancialPeriod } from "@/lib/types";

/**
 * What a five-year margin is, and what it is not.
 *
 * Rivian's gross margin across 2021–2025 came out as −220%, because the mean
 * of five ratios gives the same weight to the year revenue was $55m and the
 * losses were billions as to the year revenue was $5bn. The arithmetic is
 * right; the figure is not a margin anybody would recognise, and no analyst
 * would write it down.
 *
 * A multi-year margin is the aggregate: five years of gross profit over five
 * years of revenue. That is one ratio of two real sums, it weights each year by
 * the size it actually was, and for Rivian it lands where the business did.
 *
 * Amounts — revenue, cash flow, a share count — keep the ordinary mean, which
 * is exactly the right statistic for them.
 */
export const RATIO_PARTS: Record<string, { numerator: string; denominator: string }> = {
  grossMargin: { numerator: "grossProfit", denominator: "revenue" },
  operatingMargin: { numerator: "operatingIncome", denominator: "revenue" },
  netMargin: { numerator: "netIncome", denominator: "revenue" },
  pretaxMargin: { numerator: "incomeBeforeTax", denominator: "revenue" },
  ebitdaMargin: { numerator: "ebitda", denominator: "revenue" },
  operatingCashFlowMargin: { numerator: "operatingCashFlow", denominator: "revenue" },
  freeCashFlowMargin: { numerator: "freeCashFlow", denominator: "revenue" },
  freeCashFlowAfterSbcMargin: { numerator: "freeCashFlowAfterSbc", denominator: "revenue" },
  capitalIntensity: { numerator: "capitalExpenditures", denominator: "revenue" },
  stockBasedCompensationToRevenue: { numerator: "stockBasedCompensation", denominator: "revenue" },
  stockBasedCompensationToFcf: { numerator: "stockBasedCompensation", denominator: "freeCashFlow" },
  cashConversion: { numerator: "freeCashFlow", denominator: "netIncome" },
  effectiveTaxRate: { numerator: "incomeTaxExpense", denominator: "incomeBeforeTax" },
  roic: { numerator: "nopat", denominator: "investedCapital" },
  cashReturnOnCapital: { numerator: "freeCashFlow", denominator: "investedCapital" },
  returnOnEquity: { numerator: "netIncome", denominator: "totalEquity" },
  returnOnAssets: { numerator: "netIncome", denominator: "totalAssets" },
  returnOnTangibleAssets: { numerator: "netIncome", denominator: "tangibleAssets" },
};

export interface MultiYearResult {
  value: number | null;
  /** How many periods went into it, so the figure can say what it covers. */
  periods: number;
  /** Why there is no figure, where there is none. */
  reason?: string;
}

/**
 * The average of a metric over the periods given.
 *
 * A period contributes to a ratio only when it has both halves — half a
 * fraction is not a data point, and letting a missing denominator through
 * would silently change what the other years were being divided by.
 */
export function multiYearAverage(periods: FinancialPeriod[], metric: string): MultiYearResult {
  const parts = RATIO_PARTS[metric];
  if (!parts) {
    const values = periods.map((period) => derivedValue(period, metric)).filter((value): value is number => value != null && Number.isFinite(value));
    if (!values.length) return { value: null, periods: 0, reason: "No period reports this figure." };
    return { value: values.reduce((sum, value) => sum + value, 0) / values.length, periods: values.length };
  }

  let top = 0; let bottom = 0; let counted = 0;
  for (const period of periods) {
    const numerator = derivedValue(period, parts.numerator);
    const denominator = derivedValue(period, parts.denominator);
    if (numerator == null || denominator == null || !Number.isFinite(numerator) || !Number.isFinite(denominator)) continue;
    top += numerator; bottom += denominator; counted++;
  }
  if (!counted) return { value: null, periods: 0, reason: "No period reports both halves of this ratio." };
  /*
   * A denominator that sums to zero or below has no ratio worth stating. Five
   * years of losses do not average into a tax rate, and a company whose
   * cumulative net income is negative has no cash-conversion figure — saying
   * so is more use than a number with a sign nobody can read.
   */
  if (bottom <= 0) return { value: null, periods: counted, reason: "The base of this ratio sums to zero or less across the window." };
  return { value: top / bottom, periods: counted };
}
