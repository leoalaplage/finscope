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

export const HIGH_FREQUENCY: SeriesFrequency[] = ["daily", "weekly", "monthly"];

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

/**
 * Distinct colors in chart order. Hashing an identifier looks stable but
 * collides, and two series in the same color is the one mistake a reader
 * cannot recover from.
 */
function planColors(inputs: AutoSeriesInput[]) {
  const byTicker = new Map<string, number>();
  for (const input of inputs) if (!byTicker.has(input.ticker)) byTicker.set(input.ticker, byTicker.size);
  const multiCompany = byTicker.size > 1;
  const metrics = [...new Set(inputs.map((item) => item.metric))];
  return inputs.map((input) => {
    // One company: colour by metric. Several: colour by company, so the eye
    // groups the comparison the way the chart is meant to be read.
    const index = multiCompany ? byTicker.get(input.ticker)! : metrics.indexOf(input.metric);
    return CHART_PALETTE[index % CHART_PALETTE.length].value;
  });
}

export function createAutoChartPlan(inputs: AutoSeriesInput[]): AutoSeriesPlan[] {
  const families = [...new Set(inputs.map((item) => unitFamily(item.metric, item.indexed)))];
  const panelByFamily = new Map<UnitFamily, number>();
  if (families.length > 2) families.forEach((family, index) => panelByFamily.set(family, index));
  else families.forEach((family) => panelByFamily.set(family, 0));
  const firstFamily = families[0];
  const colors = planColors(inputs);
  const frequencies = inputs.map((input) => input.frequency ?? automaticFrequency(input.metric, input.dataset));
  // A single market series turns the shared date axis into hundreds of
  // categories, which would squeeze annual bars into invisible hairlines.
  const forceLines = frequencies.some((frequency) => HIGH_FREQUENCY.includes(frequency)) || new Set(inputs.map((item) => item.ticker)).size > 1;

  return inputs.map((input, index) => {
    const frequency = frequencies[index];
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
      type: forceLines ? "line" : automaticChartType(input.metric, frequency),
      scale,
      color: colors[index],
      format: input.indexed ? "index" : isPercent ? "percent" : family === "currency" || family === "perShare" || family === "price" ? "currency" : family === "ratio" ? "ratio" : "number",
      startAtZero: !isPrice,
      showCagr: !isPercent && !ALLOCATION_METRICS.has(input.metric),
      missingData: "report-points",
    };
  });
}

const FAMILY_LABEL: Record<UnitFamily, string> = {
  currency: "Currency", perShare: "Per share", price: "Share price", percent: "Percent", shares: "Share count", ratio: "Ratio", indexed: "Indexed to 100",
};

export function familyLabel(family: UnitFamily) { return FAMILY_LABEL[family] ?? family; }

/**
 * One formatter for axes, legends, tooltips and the data table, chosen from the
 * metric's own unit family. No unit, decimal or scale setting to get wrong.
 */
export function formatChartValue(value: number | null | undefined, family: UnitFamily, currency = "USD", compact = true): string {
  if (value == null || !Number.isFinite(value)) return "N/M";
  if (family === "percent") return `${(value * 100).toFixed(1)}%`;
  if (family === "ratio") return `${value.toFixed(1)}×`;
  if (family === "indexed") return value.toFixed(0);
  if (family === "shares") return new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 10_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(value);
  const small = Math.abs(value) < 1_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency, currencyDisplay: "narrowSymbol",
    notation: compact && !small ? "compact" : "standard",
    maximumFractionDigits: small ? 2 : 1,
  }).format(value);
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
