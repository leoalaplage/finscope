import type { FinancialPeriod, MetricKey } from "./types";

export const FORMULAS = {
  grossMargin: "Gross profit / Revenue",
  operatingMargin: "Operating income / Revenue",
  netMargin: "Net income / Revenue",
  operatingCashFlowMargin: "Operating cash flow / Revenue",
  freeCashFlow: "Operating cash flow − |Capital expenditures|",
  freeCashFlowAfterSbc: "Operating cash flow − |Capital expenditures| − Stock-based compensation",
  freeCashFlowAfterSbcPerShare: "Free cash flow after stock-based compensation / Diluted weighted average shares",
  freeCashFlowAfterSbcMargin: "Free cash flow after stock-based compensation / Revenue",
  investedCapital: "Total debt + Total equity − Cash and equivalents",
  nopat: "Operating income × (1 − Effective tax rate)",
  roic: "NOPAT / Invested capital",
  cashReturnOnCapital: "Free cash flow / Invested capital",
  capitalIntensity: "|Capital expenditures| / Revenue",
  freeCashFlowMargin: "Free cash flow / Revenue",
  revenuePerShare: "Revenue / Diluted weighted average shares",
  grossProfitPerShare: "Gross profit / Diluted weighted average shares",
  operatingIncomePerShare: "Operating income / Diluted weighted average shares",
  netIncomePerShare: "Net income / Diluted weighted average shares",
  operatingCashFlowPerShare: "Operating cash flow / Diluted weighted average shares",
  freeCashFlowPerShare: "Free cash flow / Diluted weighted average shares",
  dilutionRate: "Current diluted shares / Previous diluted shares − 1",
  cagr: "(Ending value / Beginning value)^(1 / years) − 1",
  ttmFlow: "Sum of the latest four available quarters",
  priceToSales: "Market capitalization / Revenue",
  priceToEarnings: "Market capitalization / Net income",
  priceToOperatingCashFlow: "Market capitalization / Operating cash flow",
  priceToFreeCashFlow: "Market capitalization / Free cash flow",
  freeCashFlowYield: "Free cash flow / Market capitalization",
  buybackYield: "Gross share repurchases / Market capitalization",
  ebitda: "Operating income + Depreciation and amortization",
  ebitdaMargin: "EBITDA / Revenue",
  pretaxMargin: "Pre-tax income / Revenue",
  tangibleAssets: "Total assets − Goodwill − Acquired intangibles",
  capitalEmployed: "Total assets − Current liabilities",
  returnOnEquity: "Net income / Total equity",
  returnOnAssets: "Net income / Total assets",
  returnOnTangibleAssets: "Net income / Tangible assets",
  returnOnCapitalEmployed: "Operating income / Capital employed",
  debtToEquity: "Total debt / Total equity",
  interestCoverage: "Operating income / Interest expense",
  dividendPayout: "Dividends paid / Net income",
  dividendYield: "Dividends per share / Share price",
  enterpriseValue: "Market capitalization + Net debt",
  priceToBook: "Market capitalization / Total equity",
  enterpriseToSales: "Enterprise value / Revenue",
  enterpriseToEbitda: "Enterprise value / EBITDA",
  enterpriseToGrossProfit: "Enterprise value / Gross profit",
} as const;

export function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

export function freeCashFlow(operatingCashFlow: number | null, capex: number | null) {
  if (operatingCashFlow == null || capex == null) return null;
  // Normalized data stores cash outflows as positive magnitudes. Math.abs keeps
  // this helper safe for raw provider fixtures without applying the sign twice.
  return operatingCashFlow - Math.abs(capex);
}

export function margin(value: number | null, revenue: number | null) {
  return safeDivide(value, revenue);
}

export function perShare(value: number | null, dilutedShares: number | null) {
  return safeDivide(value, dilutedShares);
}

export function dilutionRate(current: number | null, previous: number | null) {
  const ratio = safeDivide(current, previous);
  return ratio == null ? null : ratio - 1;
}

export function annualizedDilution(current: number | null, previous: number | null, years: number) {
  if (current == null || previous == null || current <= 0 || previous <= 0 || years <= 0) return null;
  return Math.pow(current / previous, 1 / years) - 1;
}

export function cagr(start: number | null, end: number | null, years: number) {
  if (start == null || end == null || start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

export interface CagrResult {
  value: number | null;
  years: number;
  startDate: string;
  endDate: string;
  startValue: number | null;
  endValue: number | null;
  reason?: string;
}

export function cagrBetweenDates(startValue: number | null, endValue: number | null, startDate: string, endDate: string): CagrResult {
  const years = (Date.parse(endDate) - Date.parse(startDate)) / (365.2425 * 86_400_000);
  const base = { years, startDate, endDate, startValue, endValue };
  if (!Number.isFinite(years) || years <= 0) return { ...base, value: null, reason: "Invalid or overlapping dates" };
  if (startValue == null || endValue == null) return { ...base, value: null, reason: "Insufficient data" };
  if (startValue === 0) return { ...base, value: null, reason: "Starting value is zero" };
  if (Math.sign(startValue) !== Math.sign(endValue)) return { ...base, value: null, reason: "Endpoint signs differ" };
  if (startValue < 0 || endValue < 0) return { ...base, value: null, reason: "CAGR is not meaningful for negative endpoints" };
  return { ...base, value: Math.pow(endValue / startValue, 1 / years) - 1 };
}

export function cagrForPeriods(periods: FinancialPeriod[], metric: string, targetYears: number | "max") {
  const dependencyMap: Record<string, MetricKey[]> = { freeCashFlow: ["operatingCashFlow","capitalExpenditures"], revenuePerShare:["revenue","dilutedShares"], netIncomePerShare:["netIncome","dilutedShares"], freeCashFlowPerShare:["operatingCashFlow","capitalExpenditures","dilutedShares"], freeCashFlowAfterSbc:["operatingCashFlow","capitalExpenditures","stockBasedCompensation"], freeCashFlowAfterSbcPerShare:["operatingCashFlow","capitalExpenditures","stockBasedCompensation","dilutedShares"] };
  const valid = (period: FinancialPeriod) => {
    const keys = dependencyMap[metric] ?? [metric as MetricKey];
    return keys.every((key) => period.facts[key]?.validation?.status !== "Confirmed invalid");
  };
  const complete = periods.filter((period) => valid(period) && derivedValue(period, metric) != null).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const end = complete.at(-1);
  if (!end) return { value: null, years: 0, startDate: "", endDate: "", startValue: null, endValue: null, reason: "Insufficient data" } satisfies CagrResult;
  const yearsFromEnd = (period: FinancialPeriod) => (Date.parse(end.periodEnd) - Date.parse(period.periodEnd)) / (365.2425 * 86_400_000);
  const maximumStart = complete[0]; const maximumYears = yearsFromEnd(maximumStart);
  const start = targetYears === "max" ? maximumStart : complete
    .map((period) => ({ period, distance: Math.abs(yearsFromEnd(period) - targetYears), years: yearsFromEnd(period) }))
    .filter((candidate) => candidate.years > 0 && candidate.distance <= 0.5)
    .sort((left, right) => left.distance - right.distance)[0]?.period;
  if (!start || start === end) return { value: null, years: maximumYears, startDate: maximumStart.periodEnd, endDate: end.periodEnd, startValue: derivedValue(maximumStart, metric), endValue: derivedValue(end, metric), reason: `Requested ${targetYears}Y; maximum exact available history is ${maximumYears.toFixed(2)}Y. Maximum-available CAGR is reported separately.` } satisfies CagrResult;
  return cagrBetweenDates(derivedValue(start, metric), derivedValue(end, metric), start.periodEnd, end.periodEnd);
}

export function ttm(values: Array<number | null>) {
  const lastFour = values.slice(-4);
  if (lastFour.length !== 4 || lastFour.some((value) => value == null)) return null;
  return (lastFour as number[]).reduce((sum, value) => sum + value, 0);
}

export function splitAdjustedShares(shares: number | null, splitFactor: number) {
  if (shares == null || splitFactor <= 0) return null;
  return shares * splitFactor;
}

export function valueOf(period: FinancialPeriod, key: MetricKey) {
  return period.facts[key]?.value ?? null;
}

/**
 * The financing view of invested capital: what the providers of capital put in,
 * net of the cash the business is not using. Preferred over the operating view
 * because the SEC data carries equity and debt reliably, while a full operating
 * build-up would need fixed assets and intangibles that several filers omit.
 */
export function investedCapital(period: FinancialPeriod): number | null {
  const debt = valueOf(period, "totalDebt"); const equity = valueOf(period, "totalEquity");
  if (equity == null) return null;
  const capital = (debt ?? 0) + equity - (valueOf(period, "cashAndEquivalents") ?? 0);
  return capital > 0 ? capital : null;
}

/** Operating profit after the tax the company actually paid on it. */
export function nopat(period: FinancialPeriod): number | null {
  const operating = valueOf(period, "operatingIncome");
  if (operating == null) return null;
  const pretax = valueOf(period, "incomeBeforeTax"); const tax = valueOf(period, "incomeTaxExpense");
  const rate = pretax != null && tax != null && pretax > 0 ? tax / pretax : null;
  // A rate outside nought to sixty percent is a one-off, not a run rate.
  const effective = rate != null && rate >= 0 && rate <= .6 ? rate : .21;
  return operating * (1 - effective);
}

/**
 * Operating profit before the non-cash charges that depend on accounting
 * policy rather than trading. Built up from operating income rather than down
 * from net income, so it never picks up financing or one-off items.
 */
export function ebitda(period: FinancialPeriod): number | null {
  const operating = valueOf(period, "operatingIncome");
  const depreciation = valueOf(period, "depreciationAndAmortization");
  return operating == null || depreciation == null ? null : operating + Math.abs(depreciation);
}

/**
 * Assets the business actually operates, with goodwill and acquired intangibles
 * removed. Those are the price paid for past acquisitions; leaving them in
 * flatters an organic grower and penalises an acquisitive one for nothing it
 * does today.
 */
export function tangibleAssets(period: FinancialPeriod): number | null {
  const assets = valueOf(period, "totalAssets");
  if (assets == null) return null;
  const goodwill = valueOf(period, "goodwill"); const intangibles = valueOf(period, "intangibleAssets");
  // A filer that tags neither concept has not told us it owns no goodwill — it
  // has told us nothing. Returning total assets under a tangible label would
  // publish return on assets a second time wearing a different name, which is
  // exactly what Apple did after it stopped tagging goodwill in 2017.
  if (goodwill == null && intangibles == null) return null;
  const tangible = assets - (goodwill ?? 0) - (intangibles ?? 0);
  return tangible > 0 ? tangible : null;
}

/** Capital employed: everything financed for longer than a trading cycle. */
export function capitalEmployed(period: FinancialPeriod): number | null {
  const assets = valueOf(period, "totalAssets"); const current = valueOf(period, "currentLiabilities");
  if (assets == null || current == null) return null;
  const employed = assets - current;
  return employed > 0 ? employed : null;
}

export function derivedValue(period: FinancialPeriod, key: string): number | null {
  const revenue = valueOf(period, "revenue");
  const diluted = valueOf(period, "dilutedShares");
  const compatibleCurrencyFacts = (keys: MetricKey[]) => keys.map((metric) => period.facts[metric]).every((fact) => fact?.unit === "currency" && fact.currency === period.currency && fact.periodEnd === period.periodEnd);
  const compatibleShares = period.facts.dilutedShares?.unit === "shares" && period.facts.dilutedShares.currency === period.currency && period.facts.dilutedShares.periodEnd === period.periodEnd;
  const fcf = compatibleCurrencyFacts(["operatingCashFlow","capitalExpenditures"]) ? freeCashFlow(valueOf(period, "operatingCashFlow"), valueOf(period, "capitalExpenditures")) : null;
  const compatiblePerShare = (total: number | null, dependencies: MetricKey[]) => compatibleShares && compatibleCurrencyFacts(dependencies) ? perShare(total,diluted) : null;
  // Treats stock-based compensation as the cost it is rather than adding it
  // back. Operating cash flow already contains depreciation and the working
  // capital movement, so subtracting compensation from it lands on the same
  // figure as building free cash flow up from net income — without depending on
  // an aggregate working-capital concept that two thirds of filers never tag.
  const sbc = valueOf(period, "stockBasedCompensation");
  const fcfAfterSbc = fcf == null || sbc == null || !compatibleCurrencyFacts(["stockBasedCompensation"]) ? null : fcf - Math.abs(sbc);
  const map: Record<string, number | null> = {
    freeCashFlow: fcf,
    freeCashFlowAfterSbc: fcfAfterSbc,
    freeCashFlowAfterSbcMargin: margin(fcfAfterSbc, revenue),
    freeCashFlowAfterSbcPerShare: compatiblePerShare(fcfAfterSbc,["operatingCashFlow","capitalExpenditures","stockBasedCompensation"]),
    grossMargin: margin(valueOf(period, "grossProfit"), revenue),
    operatingMargin: margin(valueOf(period, "operatingIncome"), revenue),
    netMargin: margin(valueOf(period, "netIncome"), revenue),
    operatingCashFlowMargin: margin(valueOf(period, "operatingCashFlow"), revenue),
    freeCashFlowMargin: margin(fcf, revenue),
    revenuePerShare: compatiblePerShare(revenue,["revenue"]),
    grossProfitPerShare: compatiblePerShare(valueOf(period, "grossProfit"),["grossProfit"]),
    operatingIncomePerShare: compatiblePerShare(valueOf(period, "operatingIncome"),["operatingIncome"]),
    netIncomePerShare: compatiblePerShare(valueOf(period, "netIncome"),["netIncome"]),
    operatingCashFlowPerShare: compatiblePerShare(valueOf(period, "operatingCashFlow"),["operatingCashFlow"]),
    freeCashFlowPerShare: compatiblePerShare(fcf,["operatingCashFlow","capitalExpenditures"]),
    stockBasedCompensationToRevenue: safeDivide(valueOf(period, "stockBasedCompensation"), revenue),
    stockBasedCompensationToFcf: safeDivide(valueOf(period, "stockBasedCompensation"), fcf),
    cashConversion: safeDivide(fcf, valueOf(period, "netIncome")),
    effectiveTaxRate: safeDivide(valueOf(period, "incomeTaxExpense"), valueOf(period, "incomeBeforeTax")),
    investedCapital: investedCapital(period),
    nopat: nopat(period),
    // ROIC has been declared in the metric registry all along without ever
    // being computed, so it rendered as an em dash everywhere it appeared.
    roic: safeDivide(nopat(period), investedCapital(period)),
    // The same question as ROIC, asked of cash instead of accounting profit.
    // NOPAT applies an effective tax rate, and falls back to an assumed 21%
    // when the reported one is not usable, so ROIC always carries one
    // assumption. Free cash flow carries none: it is what the business
    // actually produced after paying for its own maintenance.
    cashReturnOnCapital: safeDivide(fcf, investedCapital(period)),
    capitalIntensity: revenue ? safeDivide(Math.abs(valueOf(period, "capitalExpenditures") ?? Number.NaN), revenue) : null,
    netDebt: valueOf(period, "totalDebt") == null && valueOf(period, "cashAndEquivalents") == null ? null : (valueOf(period, "totalDebt") ?? 0) - (valueOf(period, "cashAndEquivalents") ?? 0),
    netWorkingCapital: valueOf(period, "currentAssets") == null || valueOf(period, "currentLiabilities") == null ? null : valueOf(period, "currentAssets")! - valueOf(period, "currentLiabilities")! - (valueOf(period, "cashAndEquivalents") ?? 0),
    ebitda: ebitda(period),
    ebitdaMargin: margin(ebitda(period), revenue),
    pretaxMargin: margin(valueOf(period, "incomeBeforeTax"), revenue),
    tangibleAssets: tangibleAssets(period),
    capitalEmployed: capitalEmployed(period),
    // Returns are stated on the period-end base rather than an average of
    // opening and closing balances. The average is marginally more correct for
    // a year of heavy issuance, but it needs a prior balance sheet, and mixing
    // the two conventions across companies would be worse than either.
    returnOnEquity: safeDivide(valueOf(period, "netIncome"), valueOf(period, "totalEquity")),
    returnOnAssets: safeDivide(valueOf(period, "netIncome"), valueOf(period, "totalAssets")),
    returnOnTangibleAssets: safeDivide(valueOf(period, "netIncome"), tangibleAssets(period)),
    returnOnCapitalEmployed: safeDivide(valueOf(period, "operatingIncome"), capitalEmployed(period)),
    debtToEquity: safeDivide(valueOf(period, "totalDebt"), valueOf(period, "totalEquity")),
    // A company with no interest expense is not infinitely covered, it is
    // simply unlevered. Dividing by zero would print ∞, so it stays unavailable.
    interestCoverage: safeDivide(valueOf(period, "operatingIncome"), valueOf(period, "interestExpense")),
    dividendPayout: safeDivide(valueOf(period, "dividendsPaid"), valueOf(period, "netIncome")),
  };
  return map[key] ?? valueOf(period, key as MetricKey);
}

