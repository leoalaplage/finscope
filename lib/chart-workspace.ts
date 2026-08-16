import type { SeriesFrequency } from "./types";
import { frequencyOptions, MOVING_AVERAGES, type MovingAverage } from "./mixed-series";

/**
 * Charts decide for themselves which frequency, series type, axis, panel, color
 * and number format each metric deserves, in `auto-chart.ts`. A reader can
 * override the frequency, the style and the axis of any single series; anything
 * they have not touched keeps following the data.
 */
export type RangePreset = "1" | "3" | "5" | "10" | "max";

export type SeriesStyle = "line" | "bar" | "area" | "candle";
/**
 * Every style a stored workspace may name.
 *
 * Derived from the type rather than written out again at the point of reading:
 * the restore guard listed three of them by hand, so adding candles silently
 * dropped the choice on the next visit and every candle chart came back a line.
 */
export const SERIES_STYLES = new Set<SeriesStyle>(["line", "bar", "area", "candle"]);
export type SeriesAxis = "left" | "right";
/** Auto reads the metric, zero anchors the axis, fit frames the data closely,
 *  log compares rates of change rather than amounts. */
export type ScaleMode = "auto" | "zero" | "fit" | "log";
/**
 * Raw values; every series rebased to a common zero so shapes compare; or the
 * step-to-step change. Rebasing to zero rather than a hundred means the axis
 * reads "+240%" instead of "340", which is the number the reader wanted anyway.
 */
export type ValueMode = "raw" | "indexed" | "change";
/** One chart for everything, one per company, or a company-by-metric grid. */
export type LayoutMode = "combined" | "per-company" | "grid";

/**
 * Deliberately short: a palette you pick from, not a colour wheel. These are
 * five of the eight validated categorical slots, so a hand-picked colour is
 * always one the automatic assignment could have chosen itself.
 */
export const SERIES_COLORS = [
  { name: "Blue", value: "#2a78d6" },
  { name: "Orange", value: "#eb6834" },
  { name: "Aqua", value: "#1baf7a" },
  { name: "Violet", value: "#4a3aa7" },
  { name: "Red", value: "#e34948" },
] as const;
const COLOR_VALUES = new Set<string>(SERIES_COLORS.map((color) => color.value));

/**
 * Every presentation field is optional and means "decide for me". A series only
 * carries what the reader has deliberately overridden, so charts keep choosing
 * for themselves until someone disagrees, and a reset is a delete rather than a
 * recalculation.
 */
export interface WorkspaceSeries {
  uid: string;
  ticker: string;
  metric: string;
  visible: boolean;
  style?: SeriesStyle;
  axis?: SeriesAxis;
  frequency?: SeriesFrequency;
  color?: string;
}

export interface WorkspaceChart {
  id: string;
  series: WorkspaceSeries[];
  range: RangePreset;
  showDataTable: boolean;
  scale: ScaleMode;
  values: ValueMode;
  layout: LayoutMode;
  showGrid: boolean;
  showPoints: boolean;
  /** Overlay every unit on one plot area with a second axis, on request. */
  overlay: boolean;
  /** One frequency for every fundamental on the chart, overriding the
   *  automatic choice. Market series keep their own trading frequency. */
  frequency?: "annual" | "quarterly" | "ttm";
  /** Mark disclosed stock splits on the date axis. */
  showSplits: boolean;
  /** Shade US recessions behind the series. */
  showRecessions: boolean;
  /**
   * Moving averages drawn over the price series, in sessions.
   *
   * On the chart rather than on a series: they describe the price, and asking
   * for a 50 twice because two companies are on the plot is not a question
   * anyone has.
   */
  movingAverages: MovingAverage[];
}

/**
 * Ready-made questions, so the common ones are one click rather than six.
 * A preset replaces the metrics and keeps whichever companies are on screen.
 */
export interface ChartPreset {
  id: string;
  label: string;
  metrics: string[];
  /** Presets may also set the reading that makes them legible. */
  overlay?: boolean;
  values?: ValueMode;
  layout?: LayoutMode;
  /** Applied to every series the preset creates. */
  style?: SeriesStyle;
}

export const CHART_PRESETS: ChartPreset[] = [
  { id: "price-fcf", label: "Price vs FCF / share", metrics: ["stockPrice", "freeCashFlowPerShare"], overlay: true },
  { id: "growth", label: "Growth", metrics: ["revenue", "freeCashFlow", "freeCashFlowPerShare"] },
  { id: "margins", label: "Margins", metrics: ["grossMargin", "operatingMargin", "netMargin", "freeCashFlowMargin"] },
  { id: "cash-quality", label: "Cash quality", metrics: ["freeCashFlow", "freeCashFlowAfterSbc", "stockBasedCompensation"] },
  { id: "capital", label: "Capital allocation", metrics: ["shareRepurchases", "dividendsPaid", "stockBasedCompensation", "dilutedShares"] },
  { id: "rerating", label: "Price vs cash: re-rating", metrics: ["priceToFreeCashFlow"] },
  { id: "cards", label: "Cards", metrics: ["revenue", "operatingIncome", "netIncome", "freeCashFlow"], layout: "grid", style: "bar" },
  { id: "compare", label: "Compare companies", metrics: ["stockPrice"], values: "indexed" },
];

/** Applies a preset to a chart, keeping its companies. */
export function applyPreset(chart: WorkspaceChart, preset: ChartPreset, fallbackTicker: string): WorkspaceChart {
  const tickers = chartTickers(chart);
  const companies = tickers.length ? tickers : [fallbackTicker];
  const series = companies.flatMap((ticker) => preset.metrics.map((metric) => {
    const item = createWorkspaceSeries(chart.id, ticker, metric);
    return preset.style ? { ...item, style: preset.style } : item;
  }));
  return { ...chart, series, overlay: preset.overlay ?? false, values: preset.values ?? "raw", layout: preset.layout ?? "combined" };
}

export const RANGE_OPTIONS: Array<[RangePreset, string]> = [["1", "1Y"], ["3", "3Y"], ["5", "5Y"], ["10", "10Y"], ["max", "Max"]];
const RANGE_VALUES = new Set(RANGE_OPTIONS.map(([value]) => value));
const SERIES_FREQUENCIES = new Set<string>(["daily", "weekly", "monthly", "market-quarterly", "market-annual", "annual", "quarterly", "ttm"]);

function buildSeriesUid(chartId: string, ticker: string, metric: string) {
  return `${chartId}:${ticker}:${metric}`;
}

export function createWorkspaceSeries(chartId: string, ticker: string, metric: string): WorkspaceSeries {
  return { uid: buildSeriesUid(chartId, ticker, metric), ticker, metric, visible: true };
}

export function createWorkspaceChart(id: string, series: WorkspaceSeries[] = [], range: RangePreset = "max"): WorkspaceChart {
  return { id, series, range, showDataTable: false, scale: "auto", values: "raw", layout: "combined", showGrid: true, showPoints: false, overlay: false, showSplits: false, showRecessions: false, movingAverages: [] };
}

export function addSeriesUnique(chart: WorkspaceChart, series: WorkspaceSeries): WorkspaceChart {
  return chart.series.some((item) => item.uid === series.uid) ? chart : { ...chart, series: [...chart.series, series] };
}

export function addPair(chart: WorkspaceChart, ticker: string, metric: string): WorkspaceChart {
  return addSeriesUnique(chart, createWorkspaceSeries(chart.id, ticker, metric));
}

export function removeSeries(chart: WorkspaceChart, uid: string): WorkspaceChart {
  return { ...chart, series: chart.series.filter((series) => series.uid !== uid) };
}

export function toggleSeries(chart: WorkspaceChart, uid: string): WorkspaceChart {
  return { ...chart, series: chart.series.map((series) => series.uid === uid ? { ...series, visible: !series.visible } : series) };
}

/** Applies an override, or clears it when the value is undefined. */
export function patchSeries(chart: WorkspaceChart, uid: string, patch: Partial<Pick<WorkspaceSeries, "style" | "axis" | "frequency" | "color">>): WorkspaceChart {
  return { ...chart, series: chart.series.map((series) => {
    if (series.uid !== uid) return series;
    const next = { ...series, ...patch };
    for (const key of ["style", "axis", "frequency", "color"] as const) if (next[key] === undefined) delete next[key];
    return next;
  }) };
}

/** Hands one series back to the automatic layout. */
export function resetSeries(chart: WorkspaceChart, uid: string): WorkspaceChart {
  return { ...chart, series: chart.series.map((series) => series.uid === uid ? { uid: series.uid, ticker: series.ticker, metric: series.metric, visible: series.visible } : series) };
}

export function hasOverrides(series: WorkspaceSeries) {
  return series.style !== undefined || series.axis !== undefined || series.frequency !== undefined || series.color !== undefined;
}

export function chartTickers(chart: WorkspaceChart) {
  return [...new Set(chart.series.map((series) => series.ticker))];
}

export function chartMetrics(chart: WorkspaceChart) {
  return [...new Set(chart.series.map((series) => series.metric))];
}

/** Adds a company to every metric already on the chart, so comparisons stay complete. */
export function addCompany(chart: WorkspaceChart, ticker: string): WorkspaceChart {
  const metrics = chartMetrics(chart);
  return (metrics.length ? metrics : ["stockPrice"]).reduce((current, metric) => addPair(current, ticker, metric), chart);
}

/** Adds a metric for every company already on the chart, for the same reason. */
export function addMetric(chart: WorkspaceChart, metric: string, fallbackTicker: string): WorkspaceChart {
  const tickers = chartTickers(chart);
  return (tickers.length ? tickers : [fallbackTicker]).reduce((current, ticker) => addPair(current, ticker, metric), chart);
}

export function removeCompany(chart: WorkspaceChart, ticker: string): WorkspaceChart {
  return { ...chart, series: chart.series.filter((series) => series.ticker !== ticker) };
}

/**
 * Points an existing chart at another company, keeping the metrics on screen.
 * Opening a company in Charts should show that company, not append it forever.
 */
export function focusCompany(chart: WorkspaceChart, ticker: string, metric?: string, presentation?: Pick<WorkspaceSeries, "style" | "frequency">): WorkspaceChart {
  // Arriving from a card that was already drawn a certain way, the chart should
  // continue it. Landing on a different shape of the same number reads as a
  // different number.
  if (metric && presentation) {
    return { ...chart, layout: "combined", overlay: false, values: "raw", series: [{ ...createWorkspaceSeries(chart.id, ticker, metric), ...usable(metric, presentation) }] };
  }
  const metrics = chartMetrics(chart);
  if (metric && !metrics.includes(metric)) metrics.push(metric);
  const wanted = metrics.length ? metrics : ["stockPrice", "freeCashFlowPerShare"];
  return { ...chart, series: wanted.map((item) => createWorkspaceSeries(chart.id, ticker, item)) };
}

/**
 * A presentation the metric can actually be drawn in.
 *
 * A share price has sessions and a filing has fiscal periods, and the two sets
 * of frequencies do not overlap. Opening the price card from a company overview
 * carried that page's own frequency — trailing twelve months — into a market
 * series, which then went looking for quarterly filings of a share price and
 * found none, so the chart arrived empty saying the dataset carried no
 * observation. Dropping a frequency the metric cannot have leaves the automatic
 * choice in place, which is always drawable.
 */
function usable(metric: string, presentation: Pick<WorkspaceSeries, "style" | "frequency">): Pick<WorkspaceSeries, "style" | "frequency"> {
  const allowed = frequencyOptions(metric);
  return {
    ...presentation,
    frequency: presentation.frequency && allowed.includes(presentation.frequency) ? presentation.frequency : undefined,
  };
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next;
}

export function duplicateChart(chart: WorkspaceChart, nextId: string): WorkspaceChart {
  return { ...chart, id: nextId, series: chart.series.map((series) => ({ ...series, uid: buildSeriesUid(nextId, series.ticker, series.metric) })) };
}

/** Human title for a chart, built from its own contents rather than a stored name. */
export function chartTitle(chart: WorkspaceChart, label: (metric: string) => string) {
  const tickers = chartTickers(chart); const metrics = chartMetrics(chart);
  if (!chart.series.length) return "Empty chart";
  const companies = tickers.length > 3 ? `${tickers.length} companies` : tickers.join(", ");
  const subjects = metrics.length > 3 ? `${metrics.length} metrics` : metrics.map(label).join(" & ");
  return `${companies} · ${subjects}`;
}

export function serializeWorkspace(charts: WorkspaceChart[]) {
  return JSON.stringify(charts);
}

/**
 * Accepts anything previously stored and keeps only what the current model
 * understands, so an older saved workspace degrades into a valid chart instead
 * of leaving the page blank.
 */
export function deserializeWorkspace(value: string): WorkspaceChart[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Invalid chart workspace");
  const charts = parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const chart = entry as Partial<WorkspaceChart> & { series?: unknown };
    if (typeof chart.id !== "string" || !Array.isArray(chart.series)) return [];
    const series = (chart.series as unknown[]).flatMap((entry) => {
      const item = entry as Record<string, unknown>;
      if (!item || typeof item.ticker !== "string" || typeof item.metric !== "string") return [];
      const restored: WorkspaceSeries = { ...createWorkspaceSeries(chart.id!, item.ticker, item.metric), visible: item.visible !== false };
      if (typeof item.style === "string" && SERIES_STYLES.has(item.style as SeriesStyle)) restored.style = item.style as SeriesStyle;
      if (item.axis === "left" || item.axis === "right") restored.axis = item.axis;
      if (typeof item.frequency === "string" && SERIES_FREQUENCIES.has(item.frequency)) restored.frequency = item.frequency as SeriesFrequency;
      if (typeof item.color === "string" && COLOR_VALUES.has(item.color)) restored.color = item.color;
      return [restored];
    });
    const unique = [...new Map(series.map((item) => [item.uid, item])).values()];
    const range = typeof chart.range === "string" && RANGE_VALUES.has(chart.range as RangePreset) ? chart.range as RangePreset : "max";
    const base = createWorkspaceChart(chart.id, unique, range);
    return [{
      ...base,
      showDataTable: chart.showDataTable === true,
      scale: chart.scale === "zero" || chart.scale === "fit" || chart.scale === "log" ? chart.scale : base.scale,
      values: chart.values === "indexed" || chart.values === "change" ? chart.values : base.values,
      frequency: chart.frequency === "annual" || chart.frequency === "quarterly" || chart.frequency === "ttm" ? chart.frequency : undefined,
      layout: chart.layout === "per-company" || chart.layout === "grid" ? chart.layout : base.layout,
      showGrid: chart.showGrid !== false,
      showPoints: chart.showPoints === true,
      overlay: chart.overlay === true,
      movingAverages: Array.isArray(chart.movingAverages)
        ? (chart.movingAverages as unknown[]).filter((value): value is MovingAverage => MOVING_AVERAGES.includes(value as MovingAverage))
        : [],
      showSplits: chart.showSplits === true,
      showRecessions: chart.showRecessions === true,
    }];
  });
  if (!charts.length) throw new Error("Invalid chart workspace");
  return charts;
}
