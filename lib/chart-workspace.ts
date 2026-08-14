import type { AutoAxis, AutoChartType, AutoScale } from "./auto-chart";
import type { MissingDataMode, SeriesFrequency, TimeAlignment } from "./types";

export type SeriesTransform = "raw" | "per-share" | "yoy" | "qoq" | "cagr" | "indexed" | "percentage-change";
export type DataMode = "validated" | "raw";
export type SeriesChartType = AutoChartType | "area" | "step" | "scatter";
export type CurveMode = "straight" | "curved" | "step";
export type StrokeMode = "solid" | "dashed" | "dotted";
export type LegendMode = "compact" | "detailed" | "hidden";
export type UnitsMode = "split" | "indexed" | "remove";
export type RangePreset = "1" | "3" | "5" | "10" | "15" | "20" | "max" | "custom";
export type AverageMode = "none" | "visible" | "median" | "3y" | "5y" | "10y" | "max" | "rolling" | "custom";
export type CagrHorizon = "visible" | "3" | "5" | "10" | "15" | "20" | "max" | "custom";

export interface AxisConfig {
  scale: AutoScale | "custom" | "log";
  minimum: number | null;
  maximum: number | null;
  visible: boolean;
  position: AutoAxis;
  showZero: boolean;
  unitScale: "unit" | "thousand" | "million" | "billion";
  decimals: number;
  format: "automatic" | "currency" | "percent" | "number";
  unitLabel: string;
  inverted: boolean;
}

export interface WorkspaceSeries {
  uid: string;
  ticker: string;
  metric: string;
  frequency: SeriesFrequency;
  transform: SeriesTransform;
  axis: AutoAxis;
  visible: boolean;
  chartType: SeriesChartType;
  curve: CurveMode;
  stroke: StrokeMode;
  thickness: "thin" | "normal" | "thick";
  points: boolean;
  barMode: "grouped" | "stacked";
  barWidth: number;
  showValues: boolean;
  color: string;
  fillColor: string;
  opacity: number;
  alignment: TimeAlignment;
  missingData: MissingDataMode;
  dataMode: DataMode;
  commonCurrency: boolean;
  average: AverageMode;
  rollingWindow: number;
  cagrHorizons: CagrHorizon[];
}

export interface WorkspaceChart {
  id: string;
  name: string;
  series: WorkspaceSeries[];
  range: RangePreset;
  customStart: string;
  customEnd: string;
  leftAxis: AxisConfig;
  rightAxis: AxisConfig;
  showGrid: boolean;
  showTooltips: boolean;
  showDataTable: boolean;
  showInvalid: boolean;
  legendMode: LegendMode;
  unitsMode: UnitsMode;
  syncRange: boolean;
  zoomEnabled: boolean;
  legendFields: { ticker: boolean; metric: boolean; frequency: boolean; latest: boolean; cagr: boolean; average: boolean; axis: boolean; unit: boolean };
}

const axis = (position: AutoAxis): AxisConfig => ({ scale: "zero", minimum: null, maximum: null, visible: true, position, showZero: true, unitScale: "unit", decimals: 1, format: "automatic", unitLabel: "", inverted: false });

export function buildSeriesUid(chartId: string, series: Pick<WorkspaceSeries, "ticker" | "metric" | "frequency" | "transform" | "axis">) {
  return `${chartId}:${series.ticker}:${series.metric}:${series.frequency}:${series.transform}:${series.axis}`;
}

export function createWorkspaceSeries(chartId: string, ticker: string, metric: string, frequency: SeriesFrequency, color: string, axisSide: AutoAxis = "left", transform: SeriesTransform = "raw"): WorkspaceSeries {
  const base = { ticker, metric, frequency, transform, axis: axisSide };
  return { uid: buildSeriesUid(chartId, base), ...base, visible: true, chartType: "line", curve: "straight", stroke: "solid", thickness: "normal", points: false, barMode: "grouped", barWidth: 18, showValues: false, color, fillColor: color, opacity: 1, alignment: "fiscal-period", missingData: "report-points", dataMode: "validated", commonCurrency: false, average: "none", rollingWindow: 20, cagrHorizons: ["visible"] };
}

export function createWorkspaceChart(id: string, ticker: string, series: WorkspaceSeries[]): WorkspaceChart {
  return { id, name: `Chart ${id.replace(/\D/g, "") || id}`, series, range: "max", customStart: "", customEnd: "", leftAxis: axis("left"), rightAxis: { ...axis("right"), scale: "auto" }, showGrid: true, showTooltips: true, showDataTable: false, showInvalid: false, legendMode: "compact", unitsMode: "split", syncRange: false, zoomEnabled: false, legendFields: { ticker: true, metric: true, frequency: true, latest: false, cagr: true, average: false, axis: false, unit: false } };
}

export function patchSeries(chart: WorkspaceChart, uid: string, patch: Partial<WorkspaceSeries>): WorkspaceChart {
  return { ...chart, series: chart.series.map((item) => item.uid === uid ? (() => { const next = { ...item, ...patch }; return { ...next, uid: buildSeriesUid(chart.id, next) }; })() : item) };
}

export function addSeriesUnique(chart: WorkspaceChart, series: WorkspaceSeries): WorkspaceChart {
  return chart.series.some((item) => item.uid === series.uid) ? chart : { ...chart, series: [...chart.series, series] };
}

export function removeSeries(chart: WorkspaceChart, uid: string): WorkspaceChart {
  return { ...chart, series: chart.series.filter((series) => series.uid !== uid) };
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next;
}

export function duplicateChart(chart: WorkspaceChart, nextId: string): WorkspaceChart {
  const copy = structuredClone(chart); copy.id = nextId; copy.name = `${chart.name} copy`; copy.series = copy.series.map((series) => ({ ...series, uid: buildSeriesUid(nextId, series) })); return copy;
}

export function serializeWorkspace(charts: WorkspaceChart[]) {
  return JSON.stringify(charts);
}

export function deserializeWorkspace(value: string): WorkspaceChart[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((chart) => !chart || typeof chart !== "object" || !("id" in chart) || !("series" in chart) || !Array.isArray(chart.series))) throw new Error("Invalid chart workspace");
  return parsed as WorkspaceChart[];
}
