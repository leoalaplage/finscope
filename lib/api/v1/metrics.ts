import { validationForMetric, validatedDerivedValue } from "../../data-quality";
import { METRICS, type MetricKind } from "../../metrics";
import type { FactStatus, FinancialPeriod, MetricKey } from "../../types";
import type { V1FinancialSeries, V1FinancialValue, V1MetricUnit } from "./contracts";

export const V1_METRICS = {
  revenue: "revenue",
  grossProfit: "grossProfit",
  operatingIncome: "operatingIncome",
  netIncome: "netIncome",
  eps: "netIncomePerShare",
  operatingCashFlow: "operatingCashFlow",
  capex: "capitalExpenditures",
  fcf: "freeCashFlow",
  fcfAfterSbc: "freeCashFlowAfterSbc",
  fcfPerShare: "freeCashFlowPerShare",
  grossMargin: "grossMargin",
  operatingMargin: "operatingMargin",
  netMargin: "netMargin",
  fcfMargin: "freeCashFlowMargin",
  dilutedShares: "dilutedShares",
  sharesOutstanding: "sharesOutstanding",
  stockBasedCompensation: "stockBasedCompensation",
  cash: "cashAndEquivalents",
  totalDebt: "totalDebt",
  netDebt: "netDebt",
  roic: "roic",
  cashReturnOnCapital: "cashReturnOnCapital",
} as const;

export type V1Metric = keyof typeof V1_METRICS;
export const DEFAULT_V1_METRICS: V1Metric[] = ["revenue", "eps", "fcf"];

const unitOf = (kind: MetricKind): V1MetricUnit => kind;

export function isV1Metric(value: string): value is V1Metric {
  return Object.hasOwn(V1_METRICS, value);
}

export function parseV1Metrics(value: string | null): { metrics: V1Metric[]; invalid: string[] } {
  if (!value?.trim()) return { metrics: DEFAULT_V1_METRICS, invalid: [] };
  const requested = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  return {
    metrics: requested.filter(isV1Metric),
    invalid: requested.filter((metric) => !isV1Metric(metric)),
  };
}

function publicStatus(period: FinancialPeriod, internalMetric: string, value: number | null): FactStatus {
  if (value == null) return "unavailable";
  const validation = validationForMetric(period, internalMetric);
  if (validation.status === "Confirmed invalid" || validation.status === "Missing") return "unavailable";
  if (validation.status === "Restated") return "restated";
  const fact = period.facts[internalMetric as MetricKey];
  if (fact) return fact.provenance.status;
  return "calculated";
}

export function financialValue(period: FinancialPeriod, metric: V1Metric): V1FinancialValue {
  const internalMetric = V1_METRICS[metric];
  const definition = METRICS[internalMetric];
  const value = validatedDerivedValue(period, internalMetric, "validated");
  const unit = unitOf(definition.kind);
  return {
    metric,
    label: definition.label,
    value,
    currency: unit === "currency" || unit === "perShare" ? period.currency : null,
    unit,
    frequency: period.periodicity,
    periodStart: period.periodStart ?? null,
    periodEnd: period.periodEnd,
    fiscalYear: period.fiscalYear,
    fiscalQuarter: period.fiscalQuarter ?? null,
    status: publicStatus(period, internalMetric, value),
  };
}

export function financialSeries(periods: FinancialPeriod[], metric: V1Metric, frequency: FinancialPeriod["periodicity"]): V1FinancialSeries {
  const values = periods
    .filter((period) => period.periodicity === frequency)
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
    .map((period) => financialValue(period, metric));
  const definition = METRICS[V1_METRICS[metric]];
  const unit = unitOf(definition.kind);
  return {
    metric,
    label: definition.label,
    currency: unit === "currency" || unit === "perShare" ? values.find((value) => value.currency)?.currency ?? null : null,
    unit,
    frequency,
    values,
  };
}

