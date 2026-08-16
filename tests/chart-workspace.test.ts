import { describe, expect, it } from "vitest";
import { createAutoChartPlan, formatChartValue, unitFamily } from "../lib/auto-chart";
import { chartDomain } from "../lib/charting";
import { addCompany, addMetric, addPair, applyChartFrequency, addSeriesUnique, chartMetrics, chartTickers, chartTitle, createWorkspaceChart, createWorkspaceSeries, deserializeWorkspace, duplicateChart, focusCompany, hasOverrides, moveItem, patchSeries, removeCompany, removeSeries, resetSeries, serializeWorkspace, SERIES_COLORS, toggleSeries } from "../lib/chart-workspace";

const series = (chart: string, ticker: string, metric: string) => createWorkspaceSeries(chart, ticker, metric);
const chartWith = (...pairs: Array<[string, string]>) => createWorkspaceChart("chart-1", pairs.map(([ticker, metric]) => series("chart-1", ticker, metric)));

describe("chart workspace state", () => {
  it("adds a second metric without replacing the first", () => {
    const chart = addPair(chartWith(["AAPL", "stockPrice"]), "AAPL", "revenue");
    expect(chart.series.map((item) => item.metric)).toEqual(["stockPrice", "revenue"]);
  });

  it("adds a third metric", () => {
    let chart = createWorkspaceChart("chart-1");
    for (const metric of ["revenue", "freeCashFlow", "operatingMargin"]) chart = addPair(chart, "AAPL", metric);
    expect(chart.series).toHaveLength(3);
  });

  it("adds a company to every metric already on the chart", () => {
    const chart = addCompany(chartWith(["AAPL", "revenue"], ["AAPL", "operatingMargin"]), "MSFT");
    expect(chartTickers(chart)).toEqual(["AAPL", "MSFT"]);
    expect(chart.series).toHaveLength(4);
  });

  it("adds a metric to every company already on the chart", () => {
    const chart = addMetric(chartWith(["AAPL", "revenue"], ["MSFT", "revenue"]), "freeCashFlow", "AAPL");
    expect(chartMetrics(chart)).toEqual(["revenue", "freeCashFlow"]);
    expect(chart.series).toHaveLength(4);
  });

  it("keeps stock price and several fundamentals on the same chart", () => {
    const chart = chartWith(["AAPL", "stockPrice"], ["AAPL", "revenue"], ["AAPL", "freeCashFlowPerShare"]);
    expect(chart.series).toHaveLength(3);
  });

  it("does not add an exact duplicate series", () => {
    const item = series("chart-1", "AAPL", "revenue");
    expect(addSeriesUnique(createWorkspaceChart("chart-1", [item]), item).series).toHaveLength(1);
  });

  it("removes one series only", () => {
    const chart = chartWith(["AAPL", "revenue"], ["AAPL", "freeCashFlow"]);
    expect(removeSeries(chart, chart.series[0].uid).series.map((item) => item.metric)).toEqual(["freeCashFlow"]);
  });

  it("removes a whole company from the chart", () => {
    const chart = removeCompany(chartWith(["AAPL", "revenue"], ["MSFT", "revenue"]), "MSFT");
    expect(chartTickers(chart)).toEqual(["AAPL"]);
  });

  it("toggles visibility without dropping the series", () => {
    const chart = chartWith(["AAPL", "revenue"]);
    const hidden = toggleSeries(chart, chart.series[0].uid);
    expect(hidden.series[0].visible).toBe(false);
    expect(toggleSeries(hidden, chart.series[0].uid).series[0].visible).toBe(true);
  });

  it("points an existing chart at another company instead of appending it", () => {
    const chart = focusCompany(chartWith(["AAPL", "stockPrice"], ["AAPL", "freeCashFlowPerShare"]), "MSFT");
    expect(chartTickers(chart)).toEqual(["MSFT"]);
    expect(chartMetrics(chart)).toEqual(["stockPrice", "freeCashFlowPerShare"]);
  });

  it("adds the requested metric when focusing a company", () => {
    const chart = focusCompany(chartWith(["AAPL", "stockPrice"]), "MSFT", "operatingMargin");
    expect(chartMetrics(chart)).toEqual(["stockPrice", "operatingMargin"]);
  });

  it("duplicates a chart with new series identities", () => {
    const chart = chartWith(["AAPL", "revenue"]);
    const copy = duplicateChart(chart, "chart-2");
    expect(copy.series[0].uid).toContain("chart-2");
    expect(copy.series[0].uid).not.toBe(chart.series[0].uid);
  });

  it("reorders charts independently", () => {
    const charts = [createWorkspaceChart("chart-1"), createWorkspaceChart("chart-2")];
    expect(moveItem(charts, 0, 1).map((chart) => chart.id)).toEqual(["chart-2", "chart-1"]);
  });

  it("names a chart from its own contents", () => {
    const label = (metric: string) => metric === "stockPrice" ? "Stock price" : "FCF / share";
    expect(chartTitle(chartWith(["AAPL", "stockPrice"], ["AAPL", "freeCashFlowPerShare"]), label)).toBe("AAPL · Stock price & FCF / share");
  });

  it("saves and reloads a workspace losslessly", () => {
    const charts = [chartWith(["AAPL", "revenue"])];
    expect(deserializeWorkspace(serializeWorkspace(charts))).toEqual(charts);
  });

  it("migrates a workspace saved by an older, setting-heavy model", () => {
    const legacy = JSON.stringify([{ id: "chart-1", name: "Chart 1", range: "20", leftAxis: { scale: "log" }, series: [{ uid: "old:uid", ticker: "AAPL", metric: "revenue", frequency: "ttm", transform: "yoy", axis: "right", visible: true, color: "#000" }] }]);
    const [chart] = deserializeWorkspace(legacy);
    // A range the current model no longer offers falls back rather than sticking.
    expect(chart.range).toBe("max");
    // Frequency and axis still mean the same thing, so they are kept as
    // overrides; the identifier is rebuilt and everything else is dropped.
    expect(chart.series).toEqual([{ uid: "chart-1:AAPL:revenue", ticker: "AAPL", metric: "revenue", visible: true, frequency: "ttm", axis: "right" }]);
  });

  it("rejects a workspace with nothing usable left", () => {
    expect(() => deserializeWorkspace('{"id":"chart-1"}')).toThrow(/Invalid/);
    expect(() => deserializeWorkspace("[{}]")).toThrow(/Invalid/);
  });
});

describe("automatic presentation", () => {
  it("gives every series on a chart a distinct color", () => {
    const plan = createAutoChartPlan([{ id: "a", ticker: "AAPL", metric: "stockPrice" }, { id: "b", ticker: "AAPL", metric: "revenue" }, { id: "c", ticker: "AAPL", metric: "operatingMargin" }]);
    expect(new Set(plan.map((item) => item.color)).size).toBe(3);
  });

  it("colors by company when several companies are compared", () => {
    const plan = createAutoChartPlan([{ id: "a", ticker: "AAPL", metric: "revenue" }, { id: "b", ticker: "AAPL", metric: "freeCashFlow" }, { id: "c", ticker: "MSFT", metric: "revenue" }, { id: "d", ticker: "MSFT", metric: "freeCashFlow" }]);
    expect(plan[0].color).toBe(plan[1].color);
    expect(plan[2].color).toBe(plan[3].color);
    expect(plan[0].color).not.toBe(plan[2].color);
  });

  it("drops bars when a market series puts hundreds of dates on the shared axis", () => {
    const alone = createAutoChartPlan([{ id: "a", ticker: "AAPL", metric: "revenue", frequency: "annual" }]);
    expect(alone[0].type).toBe("bar");
    const withPrice = createAutoChartPlan([{ id: "a", ticker: "AAPL", metric: "revenue", frequency: "annual" }, { id: "b", ticker: "AAPL", metric: "stockPrice", frequency: "weekly" }]);
    expect(withPrice.map((item) => item.type)).toEqual(["line", "line"]);
  });

  it("drops bars when two companies would overlap on the same period", () => {
    const plan = createAutoChartPlan([{ id: "a", ticker: "AAPL", metric: "revenue", frequency: "annual" }, { id: "b", ticker: "MSFT", metric: "revenue", frequency: "annual" }]);
    expect(plan.every((item) => item.type === "line")).toBe(true);
  });

  it("formats each unit family from the metric alone", () => {
    expect(formatChartValue(0.293, unitFamily("operatingMargin"))).toBe("29.3%");
    expect(formatChartValue(391_000_000_000, unitFamily("revenue"))).toBe("$391B");
    expect(formatChartValue(6.42, unitFamily("freeCashFlowPerShare"))).toBe("$6.42");
    expect(formatChartValue(null, unitFamily("revenue"))).toBe("N/M");
  });

  it("keeps zero in view for absolute fundamentals and lets price float", () => {
    expect(chartDomain([5, 10], "zero").domain[0]).toBe(0);
    expect(chartDomain([120, 240], "auto").domain).toEqual(["auto", "auto"]);
    // "fit" frames the data instead of the origin, so a tight band stays legible.
    expect(chartDomain([120, 140], "fit").domain).toEqual([118.4, 141.6]);
    // The margin must not invent a sign the data never had.
    expect(chartDomain([9, 562], "fit").domain[0]).toBe(0);
    // All-negative data is framed just as closely, but the axis still stops at
    // zero rather than implying the series was ever positive.
    const negative = chartDomain([-40, -5], "fit").domain as [number, number];
    expect(negative[1]).toBeLessThanOrEqual(0);
    expect(negative[1]).toBeGreaterThan(-5);
    // Data that genuinely crosses zero keeps its margin on both sides.
    expect(chartDomain([-40, 60], "fit").domain[0]).toBeLessThan(-40);
  });
});

describe("per-series overrides", () => {
  const uid = "chart-1:AAPL:revenue";

  it("starts fully automatic and carries no presentation fields", () => {
    const [series] = chartWith(["AAPL", "revenue"]).series;
    expect(hasOverrides(series)).toBe(false);
    expect(series).toEqual({ uid, ticker: "AAPL", metric: "revenue", visible: true });
  });

  it("overrides frequency, style and axis independently", () => {
    let chart = chartWith(["AAPL", "revenue"]);
    chart = patchSeries(chart, uid, { frequency: "quarterly" });
    chart = patchSeries(chart, uid, { style: "area" });
    chart = patchSeries(chart, uid, { axis: "right" });
    expect(chart.series[0]).toMatchObject({ frequency: "quarterly", style: "area", axis: "right" });
    expect(hasOverrides(chart.series[0])).toBe(true);
  });

  it("clears a single override without disturbing the others", () => {
    let chart = patchSeries(chartWith(["AAPL", "revenue"]), uid, { style: "bar", axis: "right" });
    chart = patchSeries(chart, uid, { style: undefined });
    expect("style" in chart.series[0]).toBe(false);
    expect(chart.series[0].axis).toBe("right");
  });

  it("hands a series back to the automatic layout", () => {
    const chart = patchSeries(chartWith(["AAPL", "revenue"]), uid, { style: "bar", axis: "right", frequency: "annual" });
    const reset = resetSeries(chart, uid);
    expect(hasOverrides(reset.series[0])).toBe(false);
    expect(reset.series[0].visible).toBe(true);
  });

  it("touches only the addressed series", () => {
    const chart = patchSeries(chartWith(["AAPL", "revenue"], ["AAPL", "stockPrice"]), uid, { axis: "right" });
    expect(chart.series[1].axis).toBeUndefined();
  });

  it("survives a save and reload", () => {
    const chart = patchSeries(chartWith(["AAPL", "revenue"]), uid, { style: "area", axis: "right", frequency: "quarterly" });
    expect(deserializeWorkspace(serializeWorkspace([chart]))[0].series[0]).toMatchObject({ style: "area", axis: "right", frequency: "quarterly" });
  });

  it("discards a stored override that is no longer a valid choice", () => {
    const stored = JSON.stringify([{ id: "chart-1", range: "max", series: [{ ticker: "AAPL", metric: "revenue", visible: true, style: "candlestick", axis: "middle", frequency: "hourly" }] }]);
    expect(hasOverrides(deserializeWorkspace(stored)[0].series[0])).toBe(false);
  });
});

describe("chart appearance", () => {

  it("offers exactly five colours and stores one as an override", () => {
    expect(SERIES_COLORS).toHaveLength(5);
    const chart = patchSeries(chartWith(["AAPL", "revenue"]), "chart-1:AAPL:revenue", { color: SERIES_COLORS[2].value });
    expect(chart.series[0].color).toBe(SERIES_COLORS[2].value);
    expect(deserializeWorkspace(serializeWorkspace([chart]))[0].series[0].color).toBe(SERIES_COLORS[2].value);
  });

  it("refuses a colour that is not in the palette", () => {
    const stored = JSON.stringify([{ id: "chart-1", range: "max", series: [{ ticker: "AAPL", metric: "revenue", visible: true, color: "#ff00ff" }] }]);
    expect(deserializeWorkspace(stored)[0].series[0].color).toBeUndefined();
  });

  it("defaults to automatic scale, actual values and one chart", () => {
    const chart = createWorkspaceChart("chart-1");
    expect(chart).toMatchObject({ scale: "auto", values: "raw", layout: "combined", showGrid: true, showPoints: false });
  });

  it("keeps appearance choices across a save and reload", () => {
    const chart = { ...chartWith(["AAPL", "revenue"]), scale: "fit" as const, values: "indexed" as const, layout: "per-company" as const, showGrid: false, showPoints: true };
    expect(deserializeWorkspace(serializeWorkspace([chart]))[0]).toMatchObject({ scale: "fit", values: "indexed", layout: "per-company", showGrid: false, showPoints: true });
  });

  it("falls back to the default for an appearance value it does not recognise", () => {
    // "grid" is a layout this model understands, so it is kept; the other two
    // are not, and fall back rather than sticking.
    const stored = JSON.stringify([{ id: "chart-1", range: "max", scale: "logarithmic", values: "detrended", layout: "carousel", series: [{ ticker: "AAPL", metric: "revenue", visible: true }] }]);
    expect(deserializeWorkspace(stored)[0]).toMatchObject({ scale: "auto", values: "raw", layout: "combined" });
  });
});

describe("a stored workspace keeps the shape it was drawn in", () => {
  it("restores a candle series, which a hand-written whitelist dropped", () => {
    // The restore guard named line, bar and area. Adding candles meant every
    // candle chart quietly came back a line on the next visit.
    const stored = JSON.stringify([{ id: "chart-1", range: "5Y", movingAverages: [50], series: [{ ticker: "AAPL", metric: "stockPrice", style: "candle", frequency: "daily", visible: true }] }]);
    const [chart] = deserializeWorkspace(stored);
    expect(chart.series[0].style).toBe("candle");
    expect(chart.series[0].frequency).toBe("daily");
    expect(chart.movingAverages).toEqual([50]);
  });

  it("still refuses a style it does not have", () => {
    const stored = JSON.stringify([{ id: "chart-1", series: [{ ticker: "AAPL", metric: "revenue", style: "sparkline" }] }]);
    expect(deserializeWorkspace(stored)[0].series[0].style).toBeUndefined();
  });

  it("keeps only the moving averages it can draw", () => {
    const stored = JSON.stringify([{ id: "chart-1", movingAverages: [20, 7, "50", 200], series: [{ ticker: "AAPL", metric: "stockPrice" }] }]);
    expect(deserializeWorkspace(stored)[0].movingAverages).toEqual([20, 200]);
  });
});

describe("opening a card in Charts", () => {
  const blank = createWorkspaceChart("chart-1", [], "max");

  it("refuses a frequency the metric cannot be reported at", () => {
    // The overview draws trailing-twelve-month cards and handed that frequency
    // to the price card too. Charts then looked for quarterly filings of a
    // share price, found none, and arrived saying the dataset carried no
    // observation for the metric.
    const chart = focusCompany(blank, "AAPL", "stockPrice", { style: "candle", frequency: "ttm" });
    expect(chart.series[0].frequency).toBeUndefined();
    expect(chart.series[0].style).toBe("candle");
  });

  it("keeps a frequency the metric does have", () => {
    expect(focusCompany(blank, "AAPL", "stockPrice", { style: "candle", frequency: "weekly" }).series[0].frequency).toBe("weekly");
    expect(focusCompany(blank, "AAPL", "revenue", { style: "bar", frequency: "ttm" }).series[0].frequency).toBe("ttm");
  });

  it("refuses a market frequency on a filed measure too", () => {
    expect(focusCompany(blank, "AAPL", "revenue", { style: "bar", frequency: "weekly" }).series[0].frequency).toBeUndefined();
  });
});

describe("the chart-wide frequency", () => {
  const chart = () => createWorkspaceChart("chart-1", [
    { ...createWorkspaceSeries("chart-1", "AAPL", "revenue"), frequency: "ttm" as const },
    { ...createWorkspaceSeries("chart-1", "AAPL", "stockPrice"), frequency: "weekly" as const },
  ], "max");

  it("releases the per-series frequencies it is meant to override", () => {
    // A series frequency wins over the chart's, and every card opened from a
    // company overview pins one — so Annual, Quarterly and TTM did nothing at
    // all and the buttons looked broken.
    const annual = applyChartFrequency(chart(), "annual");
    expect(annual.frequency).toBe("annual");
    expect(annual.series[0].frequency).toBeUndefined();
  });

  it("says nothing about a share price, which has sessions rather than periods", () => {
    expect(applyChartFrequency(chart(), "annual").series[1].frequency).toBe("weekly");
  });

  it("clears back to automatic when switched off", () => {
    const off = applyChartFrequency(applyChartFrequency(chart(), "annual"), undefined);
    expect(off.frequency).toBeUndefined();
    expect(off.series[0].frequency).toBeUndefined();
  });
});
