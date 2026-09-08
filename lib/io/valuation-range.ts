import type { IoPeriod } from "./view";

export type HistoricalValuationMetric =
  | "enterpriseToFreeCashFlow" | "priceToFreeCashFlow" | "freeCashFlowYield"
  | "dividendYield" | "buybackYield" | "shareholderYield";

export interface ValuationPrice {
  price: number;
  date: string;
  currency: string;
}

export interface HistoricalValuationPoint {
  date: string;
  /** The day the figures behind this point became public, and it was priced. */
  publishedAt: string;
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
 * The same, where a negative numerator is a fact rather than a failure.
 *
 * A multiple struck on negative earnings is meaningless — a company losing
 * money is not cheap — which is why every ratio above refuses one. Cash
 * returned to shareholders is not a multiple: a company that issued more stock
 * than it bought back returned *less than nothing*, and that is exactly the
 * thing a reader wants to see. Only the price has to be positive.
 */
const signedRatio = (numerator: number | null, denominator: number | null) =>
  numerator != null && denominator != null
    && Number.isFinite(numerator) && Number.isFinite(denominator)
    && denominator > 0
    ? numerator / denominator
    : null;

/** Two figures added where either may be missing, and nothing where both are. */
const summed = (left: number | null, right: number | null) =>
  left == null && right == null ? null : (left ?? 0) + (right ?? 0);

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
  /*
   * What the company paid out, against what it was worth on the day.
   *
   * Dividends are a cash outflow and are normalized positive; net repurchases
   * are gross buybacks less issuance proceeds and are signed, so a company that
   * issued more stock than it retired carries a negative buyback yield. That is
   * the reading — it diluted its owners — and it is kept rather than withheld.
   *
   * Priced on the same day and the same share count as every other figure here,
   * so a payout is measured against what the company cost when it was announced
   * rather than against what it costs now.
   */
  const dividends = period.values.dividendsPaid;
  const netBuybacks = period.values.netShareRepurchases;
  return {
    date: price.date,
    publishedAt: period.publishedAt,
    periodEnd: period.end,
    periodLabel: period.label,
    metrics: {
      enterpriseToFreeCashFlow: positiveRatio(enterpriseValue, freeCashFlow),
      priceToFreeCashFlow: positiveRatio(marketCap, freeCashFlow),
      freeCashFlowYield: positiveRatio(freeCashFlow, marketCap),
      dividendYield: signedRatio(dividends, marketCap),
      buybackYield: signedRatio(netBuybacks, marketCap),
      shareholderYield: signedRatio(summed(dividends, netBuybacks), marketCap),
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
