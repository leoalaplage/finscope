import { describe, expect, it } from "vitest";
import { createAutoChartPlan, formatChartValue, unitFamily } from "../lib/auto-chart";
import { chartDomain } from "../lib/charting";
import { addCompany, addMetric, addPair, addSeriesUnique, chartMetrics, chartTickers, chartTitle, createWorkspaceChart, createWorkspaceSeries, deserializeWorkspace, duplicateChart, focusCompany, moveItem, removeCompany, removeSeries, serializeWorkspace, toggleSeries } from "../lib/chart-workspace";

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
    expect(chart.range).toBe("max");
    expect(chart.series).toEqual([{ uid: "chart-1:AAPL:revenue", ticker: "AAPL", metric: "revenue", visible: true }]);
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
  });
});
