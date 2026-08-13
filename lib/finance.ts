import type { FinancialPeriod, MetricKey, NormalizedFact, PricePoint } from "./types";

export const FORMULAS = {
  grossMargin: "Gross profit / Revenue",
  operatingMargin: "Operating income / Revenue",
  netMargin: "Net income / Revenue",
  operatingCashFlowMargin: "Operating cash flow / Revenue",
  freeCashFlow: "Operating cash flow − |Capital expenditures|",
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
} as const;

export function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

export function freeCashFlow(operatingCashFlow: number | null, capex: number | null) {
  if (operatingCashFlow == null || capex == null) return null;
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

export function derivedValue(period: FinancialPeriod, key: string): number | null {
  const revenue = valueOf(period, "revenue");
  const diluted = valueOf(period, "dilutedShares");
  const fcf = freeCashFlow(valueOf(period, "operatingCashFlow"), valueOf(period, "capitalExpenditures"));
  const map: Record<string, number | null> = {
    freeCashFlow: fcf,
    grossMargin: margin(valueOf(period, "grossProfit"), revenue),
    operatingMargin: margin(valueOf(period, "operatingIncome"), revenue),
    netMargin: margin(valueOf(period, "netIncome"), revenue),
    operatingCashFlowMargin: margin(valueOf(period, "operatingCashFlow"), revenue),
    freeCashFlowMargin: margin(fcf, revenue),
    revenuePerShare: perShare(revenue, diluted),
    grossProfitPerShare: perShare(valueOf(period, "grossProfit"), diluted),
    operatingIncomePerShare: perShare(valueOf(period, "operatingIncome"), diluted),
    netIncomePerShare: perShare(valueOf(period, "netIncome"), diluted),
    operatingCashFlowPerShare: perShare(valueOf(period, "operatingCashFlow"), diluted),
    freeCashFlowPerShare: perShare(fcf, diluted),
  };
  return map[key] ?? valueOf(period, key as MetricKey);
}

export function ttmFact(facts: NormalizedFact[]): number | null {
  const ordered = [...facts].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  return ttm(ordered.map((fact) => fact.value));
}

export function valuationMetrics(period: FinancialPeriod, price: PricePoint | null) {
  const dilutedShares = valueOf(period, "dilutedShares");
  if (!price || dilutedShares == null) return null;
  const marketCap = price.close * dilutedShares;
  const fcf = freeCashFlow(valueOf(period, "operatingCashFlow"), valueOf(period, "capitalExpenditures"));
  return {
    marketCap,
    priceToSales: safeDivide(marketCap, valueOf(period, "revenue")),
    priceToEarnings: safeDivide(marketCap, valueOf(period, "netIncome")),
    priceToOperatingCashFlow: safeDivide(marketCap, valueOf(period, "operatingCashFlow")),
    priceToFreeCashFlow: safeDivide(marketCap, fcf),
    freeCashFlowYield: safeDivide(fcf, marketCap),
    operatingCashFlowYield: safeDivide(valueOf(period, "operatingCashFlow"), marketCap),
    buybackYield: safeDivide(valueOf(period, "shareRepurchases"), marketCap),
  };
}

export function convertUnit(value: number | null, unit: "unit" | "thousand" | "million" | "billion") {
  if (value == null) return null;
  const divisors = { unit: 1, thousand: 1e3, million: 1e6, billion: 1e9 };
  return value / divisors[unit];
}
