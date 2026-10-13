import { describe, expect, it } from "vitest";
import { portfolioSeries, rebasePair } from "../lib/portfolio";
import { performanceHistories, type Histories } from "../lib/term/portfolio-performance";

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
