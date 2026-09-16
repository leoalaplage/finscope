import { describe, expect, it } from "vitest";
import { annualRate, GROWTH_YIELD_CEILING, growthYield, growthYieldOutOfTen, growthYieldScore, growthYieldVerdict } from "../lib/io/growth-yield";
import type { IoPeriod } from "../lib/io/view";

const year = (end: string, revenuePerShare: number | null) =>
  ({ end, values: { revenuePerShare } }) as unknown as IoPeriod;

describe("growth yield", () => {
  it("adds the cash yield to the growth, counting growth at no more than the ceiling", () => {
    expect(growthYield(0.04, 0.09).value).toBeCloseTo(0.13);
    const fast = growthYield(0.01, 0.6);
    expect(fast.value).toBeCloseTo(0.01 + GROWTH_YIELD_CEILING);
    expect(fast.capped).toBe(true);
    expect(fast.growth).toBe(0.6);
  });

  it("reads a shrinking or cash-burning company lower rather than not at all", () => {
    expect(growthYield(-0.02, -0.05).value).toBeCloseTo(-0.07);
  });

  it("states nothing when either half is unknown", () => {
    expect(growthYield(null, 0.1).value).toBeNull();
    expect(growthYield(0.03, Number.NaN).value).toBeNull();
  });

  it("marks the rate out of 100 on a fixed scale, clamped at both ends", () => {
    expect(growthYieldScore(-0.1)).toBe(0);
    expect(growthYieldScore(0.07)).toBe(25);
    expect(growthYieldScore(0.14)).toBe(50);
    expect(growthYieldScore(0.21)).toBe(75);
    expect(growthYieldScore(0.5)).toBe(100);
    expect(growthYieldScore(null)).toBeNull();
    expect(growthYieldVerdict(80)).toBe("Cheap for its growth");
    expect(growthYieldOutOfTen(60)).toBe(6);
    expect(growthYieldOutOfTen(98)).toBe(10);
    expect(growthYieldVerdict(50)).toBe("Fairly priced");
    expect(growthYieldVerdict(20)).toBe("Dear for its growth");
  });

  it("strikes the rate between the newest year and the one nearest five years before it", () => {
    const periods = [year("2019-12-31", 10), year("2020-12-31", 11), year("2024-12-31", 16.105), year("2025-12-31", 20)];
    const rate = annualRate(periods, "revenuePerShare", 5);
    expect(rate.startDate).toBe("2020-12-31");
    expect(rate.value).toBeCloseTo((20 / 11) ** (1 / 5) - 1, 3);
  });

  it("refuses a window it does not have and a negative endpoint", () => {
    expect(annualRate([year("2023-12-31", 5), year("2025-12-31", 6)], "revenuePerShare", 5).value).toBeNull();
    expect(annualRate([year("2020-12-31", -1), year("2025-12-31", 6)], "revenuePerShare", 5).reason).toMatch(/negative/);
  });
});
