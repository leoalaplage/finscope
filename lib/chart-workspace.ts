import type { SeriesFrequency } from "./types";

/**
 * Charts decide for themselves which frequency, series type, axis, panel, color
 * and number format each metric deserves, in `auto-chart.ts`. A reader can
 * override the frequency, the style and the axis of any single series; anything
 * they have not touched keeps following the data.
 */
export type RangePreset = "1" | "3" | "5" | "10" | "max";

export type SeriesStyle = "line" | "bar" | "area";
export type SeriesAxis = "left" | "right";

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
}

export interface WorkspaceChart {
  id: string;
  series: WorkspaceSeries[];
  range: RangePreset;
  showDataTable: boolean;
}

export const RANGE_OPTIONS: Array<[RangePreset, string]> = [["1", "1Y"], ["3", "3Y"], ["5", "5Y"], ["10", "10Y"], ["max", "Max"]];
const RANGE_VALUES = new Set(RANGE_OPTIONS.map(([value]) => value));
const SERIES_FREQUENCIES = new Set<string>(["daily", "weekly", "monthly", "market-quarterly", "market-annual", "annual", "quarterly", "ttm"]);

export function buildSeriesUid(chartId: string, ticker: string, metric: string) {
  return `${chartId}:${ticker}:${metric}`;
}

export function createWorkspaceSeries(chartId: string, ticker: string, metric: string): WorkspaceSeries {
  return { uid: buildSeriesUid(chartId, ticker, metric), ticker, metric, visible: true };
}

export function createWorkspaceChart(id: string, series: WorkspaceSeries[] = [], range: RangePreset = "max"): WorkspaceChart {
  return { id, series, range, showDataTable: false };
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
export function patchSeries(chart: WorkspaceChart, uid: string, patch: Partial<Pick<WorkspaceSeries, "style" | "axis" | "frequency">>): WorkspaceChart {
  return { ...chart, series: chart.series.map((series) => {
    if (series.uid !== uid) return series;
    const next = { ...series, ...patch };
    for (const key of ["style", "axis", "frequency"] as const) if (next[key] === undefined) delete next[key];
    return next;
  }) };
}

/** Hands one series back to the automatic layout. */
export function resetSeries(chart: WorkspaceChart, uid: string): WorkspaceChart {
  return { ...chart, series: chart.series.map((series) => series.uid === uid ? { uid: series.uid, ticker: series.ticker, metric: series.metric, visible: series.visible } : series) };
}

export function hasOverrides(series: WorkspaceSeries) {
  return series.style !== undefined || series.axis !== undefined || series.frequency !== undefined;
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
export function focusCompany(chart: WorkspaceChart, ticker: string, metric?: string): WorkspaceChart {
  const metrics = chartMetrics(chart);
  if (metric && !metrics.includes(metric)) metrics.push(metric);
  const wanted = metrics.length ? metrics : ["stockPrice", "freeCashFlowPerShare"];
  return { ...chart, series: wanted.map((item) => createWorkspaceSeries(chart.id, ticker, item)) };
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
      if (item.style === "line" || item.style === "bar" || item.style === "area") restored.style = item.style;
      if (item.axis === "left" || item.axis === "right") restored.axis = item.axis;
      if (typeof item.frequency === "string" && SERIES_FREQUENCIES.has(item.frequency)) restored.frequency = item.frequency as SeriesFrequency;
      return [restored];
    });
    const unique = [...new Map(series.map((item) => [item.uid, item])).values()];
    const range = typeof chart.range === "string" && RANGE_VALUES.has(chart.range as RangePreset) ? chart.range as RangePreset : "max";
    return [{ ...createWorkspaceChart(chart.id, unique, range), showDataTable: chart.showDataTable === true }];
  });
  if (!charts.length) throw new Error("Invalid chart workspace");
  return charts;
}
