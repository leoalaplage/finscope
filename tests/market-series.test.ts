import { describe, expect, it } from "vitest";
import { aggregateMarketSessions } from "../lib/adapters/yahoo";
import { analyzeVisibleSeries } from "../lib/series-analysis";

describe("market frequency aggregation", () => {
  const sessions = [
    { date: "2026-01-05", open: 10, high: 12, low: 9, close: 11, adjustedClose: 10.5, volume: 100 },
    { date: "2026-01-06", open: 11, high: 14, low: 10, close: 13, adjustedClose: 12.5, volume: 200 },
    { date: "2026-01-09", open: 13, high: 15, low: 12, close: 14, adjustedClose: 13.5, volume: 300 },
    { date: "2026-01-12", open: 15, high: 16, low: 14, close: 15, adjustedClose: 14.5, volume: 400 },
  ];
  it("builds exchange-session weekly OHLCV and uses the last adjusted close", () => {
    const bars = aggregateMarketSessions(sessions, "weekly");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ periodStart: "2026-01-05", date: "2026-01-09", open: 10, high: 15, low: 9, close: 14, adjustedClose: 13.5, volume: 600 });
  });
  it("uses the final session for monthly lines", () => expect(aggregateMarketSessions(sessions, "monthly")[0].close).toBe(15));
});

describe("visible-window analysis", () => {
  it("uses exact visible dates", () => expect(analyzeVisibleSeries([{ date: "2020-06-30", value: 100 }, { date: "2025-06-30", value: 161.051 }], "cagr").value).toBeCloseTo(.1, 3));
  it("does not invent CAGR for negative, zero or invalid endpoints", () => {
    expect(analyzeVisibleSeries([{ date: "2020-01-01", value: 0 }, { date: "2025-01-01", value: 10 }], "cagr").reason).toContain("zero");
    expect(analyzeVisibleSeries([{ date: "2020-01-01", value: -1 }, { date: "2025-01-01", value: 2 }], "cagr").value).toBeNull();
    expect(analyzeVisibleSeries([{ date: "2020-01-01", value: 1, valid: false }, { date: "2025-01-01", value: 2 }], "cagr").reason).toContain("validation");
  });
  it("reports margin movement in points and the average", () => {
    const result = analyzeVisibleSeries([{ date: "2024-01-01", value: .2 }, { date: "2025-01-01", value: .3 }], "margin");
    expect(result.pointChange).toBeCloseTo(.1); expect(result.average).toBeCloseTo(.25);
  });
});
