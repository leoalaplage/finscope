import { describe, expect, it } from "vitest";
import { automaticChartType, automaticDomain, automaticFrequency, createAutoChartPlan, validateSeries } from "../lib/auto-chart";
import type { CompanyDataset, SeriesObservation } from "../lib/types";

const dataset = {
  company: { name: "Test", ticker: "T", cik: "1", exchange: "X", currency: "USD", sector: "", description: "" },
  retrievedAt: "2026-01-01", warnings: [], periods: [
    { label: "FY", fiscalYear: 2025, periodEnd: "2025-12-31", periodicity: "annual", filingDate: "2026-02-01", accession: "a", currency: "USD", facts: { revenue: { metric: "revenue", value: 100, currency: "USD", unit: "currency", periodEnd: "2025-12-31", periodicity: "annual", fiscalYear: 2025, provenance: { provider: "SEC", sourceUrl: "sec", retrievedAt: "2026-01-01", concept: "Revenue", status: "reported" } } } },
    { label: "TTM", fiscalYear: 2025, periodEnd: "2025-12-31", periodicity: "ttm", ttmQuarterEnds: ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"], filingDate: "2026-02-01", accession: "b", currency: "USD", facts: { revenue: { metric: "revenue", value: 110, currency: "USD", unit: "currency", periodEnd: "2025-12-31", periodicity: "ttm", fiscalYear: 2025, provenance: { provider: "Calculated", sourceUrl: "sec", retrievedAt: "2026-01-01", concept: "Revenue", status: "calculated" } } } },
  ],
} as CompanyDataset;
const observation = (date: string, value: number | null): SeriesObservation => ({ date, value, frequency: "weekly", currency: "USD", unit: "perShare", source: "Yahoo Finance", status: "Market data", rawObservation: true });

describe("automatic chart policy", () => {
  it("keeps stock price weekly while independently selecting TTM fundamentals", () => {
    expect(automaticFrequency("stockPrice", dataset)).toBe("weekly");
    expect(automaticFrequency("revenue", dataset)).toBe("ttm");
  });

  it("uses straight line-compatible series types and bars only for annual flows", () => {
    expect(automaticChartType("stockPrice", "weekly")).toBe("line");
    expect(automaticChartType("freeCashFlowPerShare", "ttm")).toBe("line");
    expect(automaticChartType("revenue", "annual")).toBe("bar");
    expect(automaticChartType("revenue", "ttm")).toBe("line");
  });

  it("gives every unit family its own panel and never a second overlaid axis", () => {
    // Two scales in one plot area let the ranges decide where the lines cross,
    // so the automatic layout never produces one. Overlaying stays available,
    // but only when a reader assigns an axis themselves.
    const one = createAutoChartPlan([{ id: "T:revenue", ticker: "T", metric: "revenue", dataset }, { id: "T:netIncome", ticker: "T", metric: "netIncome", dataset }]);
    expect(new Set(one.map((item) => item.panel)).size).toBe(1);

    const two = createAutoChartPlan([{ id: "T:revenue", ticker: "T", metric: "revenue", dataset }, { id: "T:freeCashFlowMargin", ticker: "T", metric: "freeCashFlowMargin", dataset }]);
    expect(new Set(two.map((item) => item.panel)).size).toBe(2);

    const three = createAutoChartPlan([{ id: "T:revenue", ticker: "T", metric: "revenue", dataset }, { id: "T:freeCashFlowMargin", ticker: "T", metric: "freeCashFlowMargin", dataset }, { id: "T:dilutedShares", ticker: "T", metric: "dilutedShares", dataset }]);
    expect(new Set(three.map((item) => item.panel)).size).toBe(3);

    for (const plan of [one, two, three]) expect(plan.every((item) => item.axis === "left")).toBe(true);
  });

  it("auto-scales price without zero and starts absolute fundamentals at zero", () => {
    const [price, revenue] = createAutoChartPlan([{ id: "T:stockPrice", ticker: "T", metric: "stockPrice", dataset }, { id: "T:revenue", ticker: "T", metric: "revenue", dataset }]);
    expect(price.scale).toBe("auto"); expect(price.startAtZero).toBe(false);
    expect(revenue.scale).toBe("zero"); expect(automaticDomain([10, 20], revenue)).toEqual([0, 21.6]);
  });

  it("isolates invalid observations instead of invalidating valid peers", () => {
    const result = validateSeries([observation("2026-01-02", 10), observation("bad-date", Number.NaN), observation("2026-01-09", null)], "weekly");
    expect(result.valid).toBe(true); expect(result.observations).toHaveLength(1); expect(result.invalidCount).toBe(2);
    expect(validateSeries([], "weekly").reason).toBe("No data available");
  });

  it("is deterministic for frequency, axes, panels and colors", () => {
    const input = [{ id: "T:stockPrice", ticker: "T", metric: "stockPrice", dataset }, { id: "T:revenue", ticker: "T", metric: "revenue", dataset }];
    expect(createAutoChartPlan(input)).toEqual(createAutoChartPlan(input));
  });
});
