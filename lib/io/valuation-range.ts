import type { IoPeriod } from "./view";

export type HistoricalValuationMetric = "enterpriseToFreeCashFlow" | "priceToFreeCashFlow" | "freeCashFlowYield";

export interface ValuationPrice {
  price: number;
  date: string;
  currency: string;
}

export interface HistoricalValuationPoint {
  date: string;
  filingDate: string;
  periodEnd: string;
  periodLabel: string;
  metrics: Record<HistoricalValuationMetric, number | null>;
}

export interface HistoricalValuationRange {
  current: number | null;
  low: number | null;
  high: number | null;
  median: number | null;
  percentile: number | null;
  observations: number;
  startDate: string | null;
  endDate: string | null;
}

const positiveRatio = (numerator: number | null, denominator: number | null) =>
  numerator != null && denominator != null
    && Number.isFinite(numerator) && Number.isFinite(denominator)
    && numerator > 0 && denominator > 0
    ? numerator / denominator
    : null;

/**
 * One valuation observation, using only figures that were public on its date.
 *
 * The period carries its own share count and net debt. Using today's balance
 * against a price from five years ago would produce a very precise-looking
 * multiple that never existed, so a period with no filed basis simply has no
 * observation. Currency mismatches are withheld for the same reason they are
 * on the current valuation strip.
 */
export function historicalValuationPoint(period: IoPeriod, price: ValuationPrice): HistoricalValuationPoint | null {
  const basis = period.valuationBasis;
  if (!basis || price.currency !== period.currency || !(price.price > 0)) return null;
  const freeCashFlow = period.values.freeCashFlow;
  const marketCap = price.price * basis.shares;
  const enterpriseValue = basis.netDebt == null ? null : marketCap + basis.netDebt;
  return {
    date: price.date,
    filingDate: period.filingDate,
    periodEnd: period.end,
    periodLabel: period.label,
    metrics: {
      enterpriseToFreeCashFlow: positiveRatio(enterpriseValue, freeCashFlow),
      priceToFreeCashFlow: positiveRatio(marketCap, freeCashFlow),
      freeCashFlowYield: positiveRatio(freeCashFlow, marketCap),
    },
  };
}

/** The observed min–max range, median and current percentile over one window. */
export function historicalValuationRange(
  history: HistoricalValuationPoint[],
  metric: HistoricalValuationMetric,
  current: number | null,
  years: number,
  asOf: string,
): HistoricalValuationRange {
  const cutoff = new Date(`${asOf.slice(0, 10)}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  const from = Number.isNaN(cutoff.getTime()) ? "" : cutoff.toISOString().slice(0, 10);
  const observations = history
    .filter((point) => !from || point.date >= from)
    .map((point) => ({ date: point.date, value: point.metrics[metric] }))
    .filter((point): point is { date: string; value: number } => point.value != null && Number.isFinite(point.value));
  const values = observations.map((point) => point.value).sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  const median = values.length
    ? values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
    : null;
  return {
    current,
    low: values[0] ?? null,
    high: values.at(-1) ?? null,
    median,
    percentile: current != null && values.length
      ? values.filter((value) => value <= current).length / values.length
      : null,
    observations: values.length,
    startDate: observations[0]?.date ?? null,
    endDate: observations.at(-1)?.date ?? null,
  };
}
