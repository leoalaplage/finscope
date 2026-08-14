import { validatedDerivedValue, validationForMetric } from "./data-quality";
import { METRICS } from "./metrics";
import type { CompanyDataset, FinancialPeriod, MarketBar, MissingDataMode, Periodicity, SeriesFrequency, SeriesObservation, TimeAlignment } from "./types";

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
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function defaultSeriesFrequency(metric: string, preferred: Periodicity = "annual"): SeriesFrequency {
  return MARKET_SERIES_METRICS.has(metric) ? "weekly" : preferred;
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
  return fundamentalObservationsFromPeriods(dataset.periods,metric,frequency,alignment);
}

export function fundamentalObservationsFromPeriods(periods: FinancialPeriod[], metric: string, frequency: SeriesFrequency, alignment: TimeAlignment): SeriesObservation[] {
  if (!FUNDAMENTAL_SERIES_FREQUENCIES.includes(frequency)) return [];
  return periods
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
    const value = metric === "stockTotalReturn" ? bar.adjustedClose : bar.close;
    if (value == null) return [];
    return [{ date: bar.date, value, frequency, currency: bar.currency, unit: "perShare", source: "Yahoo Finance", sourceUrl: bar.sourceUrl, status: "Market data" as const, rawObservation: true as const }];
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

export function indexObservationsTo100(observations: SeriesObservation[]) {
  const first = observations.find((item) => item.value != null && item.value !== 0)?.value;
  return observations.map((item) => ({ ...item, value: first == null || item.value == null ? null : item.value / first * 100 }));
}
