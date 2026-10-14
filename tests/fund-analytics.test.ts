import { describe, expect, it } from "vitest";
import { effectiveHoldings, fundScore, portfolioQuality, riskReturn, squarify, type ScoredHolding, type WeeklyBar } from "../lib/io/fund-analytics";

const weeks = (count: number, step: (index: number) => number, dividend = 0): WeeklyBar[] => {
  let close = 100; let adjusted = 100;
  return Array.from({ length: count }, (_, index) => {
    if (index) { const move = step(index); close *= 1 + move; adjusted *= 1 + move + dividend; }
    return { date: new Date(Date.UTC(2021, 0, 4 + index * 7)).toISOString().slice(0, 10), close, adjustedClose: adjusted };
  });
};

describe("a fund's risk and return from weekly prices", () => {
  it("separates distributions from the price, and finds the deepest fall from a peak", () => {
    const bars = weeks(261, (index) => (index === 100 ? -0.2 : 0.002), 0.0004);
    const result = riskReturn(bars, bars, 0.04)!;
    expect(result.distributions).toBeGreaterThan(0.015);
    expect(result.maxDrawdown!.value).toBeCloseTo(-0.2, 2);
    // Against itself: beta and correlation are one.
    expect(result.beta).toBeCloseTo(1, 6);
    expect(result.correlation).toBeCloseTo(1, 6);
    expect(result.total.y5).not.toBeNull();
  });
});

describe("what a fund holds, read as companies", () => {
  const row = (weight: number, total: number | null, grade: string | null, cap: number, fcfYield: number): ScoredHolding => ({
    weight, total, grade, pillars: { Quality: total }, roic: total == null ? null : 0.2, operatingMargin: 0.3, revenueGrowth: 0.1, fcfYield, earningsYield: fcfYield, marketCap: cap,
  });
  it("weighs scores over the holdings that have them, and prices the whole as one", () => {
    const quality = portfolioQuality([row(0.6, 80, "A+", 3e12, 0.02), row(0.3, 40, "B", 5e9, 0.06), row(0.1, null, null, 0, 0)], ["Quality"], ["A+", "B"]);
    expect(quality.coverage).toBeCloseTo(0.9);
    expect(quality.total).toBeCloseTo((80 * 0.6 + 40 * 0.3) / 0.9);
    // The fund's FCF yield is the weighted yield; its P/FCF the inverse — not a mean of multiples.
    expect(quality.priceToFcf).toBeCloseTo(1 / ((0.02 * 0.6 + 0.06 * 0.3) / 0.9));
    expect(quality.size.map((band) => band.label)).toEqual(["Mega · over $200bn", "Mid · $2bn–10bn"]);
  });
});

describe("FinScope's fund score", () => {
  it("rewards a cheap, broad, faithful, large fund, and leaves out what does not apply", () => {
    const index = fundScore({ expenseRatio: 0.0003, holdingsQuality: 60, qualityCoverage: 0.95, effectiveHoldings: 120, trackingDifference: -0.0004, netAssets: 1.6e12 });
    expect(index.score!).toBeGreaterThan(85);
    expect(index.stars).toBe(5);
    const active = fundScore({ expenseRatio: 0.0075, holdingsQuality: null, qualityCoverage: 0.3, effectiveHoldings: 25, trackingDifference: null, netAssets: 5e9 });
    expect(active.pillars.find((pillar) => pillar.name === "Tracking")!.score).toBeNull();
    expect(active.score!).toBeLessThan(index.score!);
    expect(effectiveHoldings([0.5, 0.5])).toBeCloseTo(2);
  });
});

describe("a treemap", () => {
  it("covers the whole box with tiles in proportion to their values", () => {
    const tiles = squarify([{ item: "a", value: 6 }, { item: "b", value: 3 }, { item: "c", value: 1 }], 100, 50);
    const area = (item: string) => { const tile = tiles.find((each) => each.item === item)!; return tile.width * tile.height; };
    expect(area("a") + area("b") + area("c")).toBeCloseTo(5000);
    expect(area("a") / area("c")).toBeCloseTo(6);
  });
});
