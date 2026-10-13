import { describe, expect, it } from "vitest";
import { portfolioSeries, rebasePair } from "../lib/portfolio";
import { performanceChartPoints, performanceHistories, type Histories } from "../lib/term/portfolio-performance";

const bar = (date: string, close: number, adjusted = close) => ({ date, close, adjusted });
const source: Histories = {
  holdings: {
    DIV: [bar("2025-01-02", 100, 90), bar("2026-01-02", 110, 110)],
    GROWTH: [bar("2025-01-02", 100), bar("2026-01-02", 110)],
  },
  // Yahoo's price index has identical close and adjusted close.
  index: [bar("2025-01-02", 5000), bar("2026-01-02", 5500)],
  totalIndex: [bar("2025-01-02", 10000), bar("2026-01-02", 11200)],
};

function performance(ticker: string, total: boolean, histories = source) {
  const read = performanceHistories(histories, total);
  return rebasePair(portfolioSeries([{ ticker, shares: 10 }], read.histories), read.index).at(-1)!;
}

describe("PERF price and total returns", () => {
  it("switches both the dividend-paying book and its benchmark", () => {
    expect(performance("DIV", false).portfolio).toBeCloseTo(110);
    expect(performance("DIV", false).benchmark).toBeCloseTo(110);
    expect(performance("DIV", true).portfolio).toBeCloseTo(122.222222);
    expect(performance("DIV", true).benchmark).toBeCloseTo(112);
  });

  it("changes the benchmark even when the holdings paid no dividends", () => {
    expect(performance("GROWTH", true).portfolio).toBe(performance("GROWTH", false).portfolio);
    expect(performance("GROWTH", true).benchmark).toBeCloseTo(112);
    expect(performance("GROWTH", false).benchmark).toBeCloseTo(110);
  });

  it("does not silently replace a missing total-return index with a price index", () => {
    expect(performanceHistories({ ...source, totalIndex: [] }, true).index).toEqual([]);
    expect(performanceHistories({ ...source, totalIndex: [] }, false).index).toHaveLength(2);
  });
});

describe("PERF display units", () => {
  const paired = [
    { date: "2025-01-02", portfolio: 100, benchmark: 100 },
    { date: "2026-01-02", portfolio: 110, benchmark: 112 },
  ];
  // A deposit changes the book's currency value, not its time-weighted return.
  const values = [{ date: "2025-01-02", value: 10_000 }, { date: "2026-01-02", value: 20_000 }];
  const water = new Map([["2026-01-02", -0.05]]);

  it("shows the actual currency value in Price, including changes in shares held", () => {
    const points = performanceChartPoints(paired, values, water, false);
    expect(points.at(-1)).toMatchObject({ date: "2026-01-02", book: 20_000, under: -0.05 });
    expect(points.at(-1)!.index).toBeCloseTo(11_200);
    expect(points[0].book).toBe(points[0].index);
  });

  it("keeps the total-return series in a percentage basis", () => {
    expect(performanceChartPoints(paired, values, water, true).at(-1)).toEqual({ date: "2026-01-02", book: 110, index: 112, under: -0.05 });
  });

  it("anchors the comparison on the first displayed date, not an older value", () => {
    const older = [{ date: "2024-01-02", value: 1_000 }, ...values];
    expect(performanceChartPoints(paired, older, water, false)[0].index).toBe(10_000);
    expect(performanceChartPoints(paired, [], water, false)).toEqual([]);
  });
});
