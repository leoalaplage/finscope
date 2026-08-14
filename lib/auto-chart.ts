import { CHART_PALETTE, chartDomain } from "./charting";
import { validatedDerivedValue } from "./data-quality";
import { METRICS } from "./metrics";
import type { CompanyDataset, SeriesFrequency, SeriesObservation } from "./types";

export type AutoChartType = "line" | "bar";
export type AutoAxis = "left" | "right";
export type AutoScale = "zero" | "auto";
export type UnitFamily = "currency" | "perShare" | "price" | "percent" | "shares" | "ratio" | "indexed";

export interface AutoSeriesInput {
  id: string;
  ticker: string;
  metric: string;
  dataset?: CompanyDataset;
  frequency?: SeriesFrequency;
  indexed?: boolean;
}

export interface AutoSeriesPlan extends AutoSeriesInput {
  frequency: SeriesFrequency;
  family: UnitFamily;
  axis: AutoAxis;
  panel: number;
  type: AutoChartType;
  scale: AutoScale;
  color: string;
  format: "currency" | "percent" | "number" | "ratio" | "index";
  startAtZero: boolean;
  showCagr: boolean;
  missingData: "report-points";
}

export interface SeriesValidation {
  valid: boolean;
  observations: SeriesObservation[];
  invalidCount: number;
  reason?: string;
}

const FLOW_METRICS = new Set([
  "revenue", "grossProfit", "costOfRevenue", "operatingIncome", "netIncome",
  "operatingCashFlow", "capitalExpenditures", "freeCashFlow", "stockBasedCompensation",
]);
const ALLOCATION_METRICS = new Set(["shareRepurchases", "shareIssuance", "netShareRepurchases", "dividendsPaid", "acquisitions"]);
const MARGIN_METRICS = new Set(["grossMargin", "operatingMargin", "netMargin", "operatingCashFlowMargin", "freeCashFlowMargin", "cashConversion"]);
const SHARE_METRICS = new Set(["dilutedShares", "basicShares", "sharesOutstanding", "sharesIssued", "treasuryShares"]);
const PRICE_METRICS = new Set(["stockPrice", "stockTotalReturn"]);

function hasReliableTtm(dataset: CompanyDataset | undefined, metric: string) {
  return Boolean(dataset?.periods.some((period) => period.periodicity === "ttm" && period.ttmQuarterEnds?.length === 4 && validatedDerivedValue(period, metric, "validated") != null));
}

export function automaticFrequency(metric: string, dataset?: CompanyDataset): SeriesFrequency {
  if (PRICE_METRICS.has(metric)) return "weekly";
  if (SHARE_METRICS.has(metric)) return (dataset?.periods.filter((period) => period.periodicity === "quarterly" && validatedDerivedValue(period, metric, "validated") != null).length ?? 0) >= 4 ? "quarterly" : "annual";
  if (MARGIN_METRICS.has(metric) || METRICS[metric]?.kind === "perShare" || FLOW_METRICS.has(metric)) {
    return hasReliableTtm(dataset, metric) ? "ttm" : "annual";
  }
  return hasReliableTtm(dataset, metric) ? "ttm" : "annual";
}

export function unitFamily(metric: string, indexed = false): UnitFamily {
  if (indexed) return "indexed";
  if (PRICE_METRICS.has(metric)) return "price";
  const kind = METRICS[metric]?.kind;
  if (kind === "currency" || kind === "perShare" || kind === "percent" || kind === "shares" || kind === "ratio") return kind;
  return "ratio";
}

export function automaticChartType(metric: string, frequency: SeriesFrequency): AutoChartType {
  if (PRICE_METRICS.has(metric) || SHARE_METRICS.has(metric) || MARGIN_METRICS.has(metric) || METRICS[metric]?.kind === "perShare") return "line";
  if (ALLOCATION_METRICS.has(metric)) return "bar";
  if (FLOW_METRICS.has(metric) && (frequency === "annual" || frequency === "quarterly")) return "bar";
  return "line";
}

function stableColor(id: string) {
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return CHART_PALETTE[Math.abs(hash) % CHART_PALETTE.length].value;
}

export function createAutoChartPlan(inputs: AutoSeriesInput[]): AutoSeriesPlan[] {
  const families = [...new Set(inputs.map((item) => unitFamily(item.metric, item.indexed)))];
  const panelByFamily = new Map<UnitFamily, number>();
  if (families.length > 2) families.forEach((family, index) => panelByFamily.set(family, index));
  else families.forEach((family) => panelByFamily.set(family, 0));
  const firstFamily = families[0];

  return inputs.map((input) => {
    const frequency = input.frequency ?? automaticFrequency(input.metric, input.dataset);
    const family = unitFamily(input.metric, input.indexed);
    const isPrice = PRICE_METRICS.has(input.metric);
    const isPercent = family === "percent";
    const axis: AutoAxis = families.includes("price") && families.length === 2
      ? (family === "price" ? "right" : "left")
      : families.length <= 1 || family === firstFamily ? "left" : "right";
    const scale: AutoScale = isPrice ? "auto" : "zero";
    return {
      ...input,
      frequency,
      family,
      axis: families.length > 2 ? "left" : axis,
      panel: panelByFamily.get(family) ?? 0,
      type: automaticChartType(input.metric, frequency),
      scale,
      color: stableColor(input.id),
      format: input.indexed ? "index" : isPercent ? "percent" : family === "currency" || family === "perShare" || family === "price" ? "currency" : family === "ratio" ? "ratio" : "number",
      startAtZero: !isPrice,
      showCagr: !isPercent && !ALLOCATION_METRICS.has(input.metric),
      missingData: "report-points",
    };
  });
}

export function validateSeries(observations: SeriesObservation[], knownFrequency: SeriesFrequency, companyResolved = true): SeriesValidation {
  if (!companyResolved) return { valid: false, observations: [], invalidCount: 0, reason: "Company could not be resolved" };
  const recognized = ["daily", "weekly", "monthly", "market-quarterly", "market-annual", "annual", "quarterly", "ttm"].includes(knownFrequency);
  if (!recognized) return { valid: false, observations: [], invalidCount: observations.length, reason: "Frequency is not recognized" };
  let invalidCount = 0;
  const clean = observations.filter((observation) => {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(observation.date) && observation.value != null && Number.isFinite(observation.value);
    if (!valid) invalidCount += 1;
    return valid;
  });
  if (!clean.length) return { valid: false, observations: [], invalidCount, reason: observations.length ? "No finite values with valid dates" : "No data available" };
  return { valid: true, observations: clean, invalidCount, reason: invalidCount ? `${invalidCount} invalid observation${invalidCount === 1 ? "" : "s"} excluded` : undefined };
}

export function automaticDomain(values: Array<number | null | undefined>, plan: Pick<AutoSeriesPlan, "scale">) {
  return chartDomain(values, plan.scale).domain;
}

export const AUTO_CHART_POLICY = {
  price: "Weekly adjusted close on its real trading dates; auto-scaled without zero.",
  fundamentals: "TTM when available, otherwise annual; never repeated between reports.",
  axes: "One axis per compatible unit family; more than two families create aligned panels.",
  invalid: "Invalid values are excluded and reported per series without affecting peers.",
} as const;
