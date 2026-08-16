import { validatedDerivedValue, validationForMetric } from "./data-quality";
import { METRICS } from "./metrics";
import type { CompanyDataset, FinancialPeriod, MarketBar, MissingDataMode, SeriesFrequency, SeriesObservation, TimeAlignment } from "./types";

export const MARKET_SERIES_METRICS = new Set(["stockPrice", "stockTotalReturn"]);
export const MARKET_SERIES_FREQUENCIES: SeriesFrequency[] = ["daily", "weekly", "monthly", "market-quarterly", "market-annual"];
export const FUNDAMENTAL_SERIES_FREQUENCIES: SeriesFrequency[] = ["annual", "quarterly", "ttm"];

export interface MixedSeriesDefinition {
  id: string;
  ticker: string;
  metric: string;
  frequency: SeriesFrequency;
  missingData: MissingDataMode;
}

export interface MixedChartCell {
  value: number | null;
  carried: boolean;
  observationDate: string;
  ageDays: number;
  observation: SeriesObservation;
}

export interface MixedChartRow {
  date: string;
  cells: Record<string, MixedChartCell | null>;
}

export function frequencyOptions(metric: string) {
  return MARKET_SERIES_METRICS.has(metric) ? MARKET_SERIES_FREQUENCIES : FUNDAMENTAL_SERIES_FREQUENCIES;
}

export function frequencyLabel(frequency: SeriesFrequency) {
  const value = frequency.startsWith("market-") ? frequency.slice(7) : frequency;
  if (value === "ttm") return "TTM";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function updateSeriesDefinition(definitions: MixedSeriesDefinition[], id: string, patch: Partial<MixedSeriesDefinition>) {
  return definitions.map((item) => item.id === id ? { ...item, ...patch } : item);
}

export function providerMarketFrequency(frequency: SeriesFrequency) {
  if (frequency === "market-quarterly") return "quarterly" as const;
  if (frequency === "market-annual") return "annual" as const;
  if (frequency === "daily" || frequency === "weekly" || frequency === "monthly") return frequency;
  return null;
}

function observationDate(period: FinancialPeriod, alignment: TimeAlignment) {
  return alignment === "as-reported" ? period.filingDate : period.periodEnd;
}

export function fundamentalObservations(dataset: CompanyDataset, metric: string, frequency: SeriesFrequency, alignment: TimeAlignment): SeriesObservation[] {
  if (!FUNDAMENTAL_SERIES_FREQUENCIES.includes(frequency)) return [];
  return dataset.periods
    .filter((period) => period.periodicity === frequency)
    .sort((a, b) => observationDate(a, alignment).localeCompare(observationDate(b, alignment)))
    .flatMap((period) => {
      const date = observationDate(period, alignment);
      const value = validatedDerivedValue(period, metric, "validated");
      if (!date || value == null) return [];
      const fact = period.facts[metric as keyof FinancialPeriod["facts"]];
      const validation = validationForMetric(period, metric);
      return [{
        date, value, fiscalPeriodEnd: period.periodEnd, filingDate: period.filingDate, frequency,
        currency: period.currency, unit: METRICS[metric]?.kind ?? fact?.unit ?? "unknown",
        source: fact?.provenance.provider ?? "Calculated", sourceUrl: fact?.provenance.sourceUrl,
        status: validation.status, rawObservation: true as const,
      }];
    });
}

export function marketObservations(bars: MarketBar[], metric: string, frequency: SeriesFrequency): SeriesObservation[] {
  return [...bars].sort((a,b)=>a.date.localeCompare(b.date)).flatMap((bar) => {
    // Yahoo adjusted close is the canonical chart input requested for price series.
    // Each observation keeps its real trading-session date and is never projected
    // onto a fundamental reporting frequency.
    const value = bar.adjustedClose ?? bar.close;
    if (value == null) return [];
    // The open, high and low are the raw session, not the dividend-adjusted
    // series, so a candle drawn from them is internally consistent even when
    // `value` above is the adjusted close a line wants.
    return [{
      date: bar.date, value, open: bar.open, high: bar.high, low: bar.low,
      frequency, currency: bar.currency, unit: "perShare", source: "Yahoo Finance", sourceUrl: bar.sourceUrl,
      status: "Market data" as const, rawObservation: true as const,
    }];
  });
}

function daysBetween(left: string, right: string) { return Math.max(0, Math.round((Date.parse(right) - Date.parse(left)) / 86_400_000)); }

/**
 * Produces a common date axis while preserving the raw observation arrays.
 * Step cells are display-only projections and must never be exported or used in CAGR.
 */
export function alignMixedSeries(series: Array<{ definition: MixedSeriesDefinition; observations: SeriesObservation[] }>): MixedChartRow[] {
  const dates = [...new Set(series.flatMap((item) => item.observations.map((observation) => observation.date)))].sort();
  return dates.map((date) => {
    const cells: Record<string, MixedChartCell | null> = {};
    for (const item of series) {
      const exact = item.observations.find((observation) => observation.date === date);
      const last = exact ?? (item.definition.missingData === "step-until-next-report"
        ? [...item.observations].reverse().find((observation) => observation.date < date)
        : undefined);
      cells[item.definition.id] = last ? { value: last.value, carried: !exact, observationDate: last.date, ageDays: daysBetween(last.date, date), observation: last } : null;
    }
    return { date, cells };
  });
}

export function visibleRawObservations(observations: SeriesObservation[], startDate: string, endDate: string) {
  return observations.filter((item) => item.date >= startDate && item.date <= endDate);
}

/** The moving averages a price chart may carry, in sessions. */
export const MOVING_AVERAGES = [20, 50, 200] as const;
export type MovingAverage = typeof MOVING_AVERAGES[number];

/**
 * A simple moving average of the drawn sessions.
 *
 * Over the sessions actually on the chart, at whatever grain the reader chose,
 * so a 50 on a weekly chart is fifty weeks and says so. The first `window - 1`
 * points have nothing to average and are left empty rather than filled with a
 * shorter mean, which would draw a line that starts steep for reasons that are
 * not in the data.
 */
export function movingAverage(observations: SeriesObservation[], window: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0; let counted = 0;
  const values = observations.map((item) => item.value);
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value != null && Number.isFinite(value)) { sum += value; counted++; }
    if (index >= window) {
      const leaving = values[index - window];
      if (leaving != null && Number.isFinite(leaving)) { sum -= leaving; counted--; }
    }
    out.push(index >= window - 1 && counted === window ? sum / window : null);
  }
  return out;
}
