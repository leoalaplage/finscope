import { describe, expect, it } from "vitest";
import { marketPremium, requiredReturn, terminalGrowthFor, valueOfIndex } from "../lib/implied-erp";

const row = (cap: number, fcfYield: number | null, growth: number | null) => ({ values: { "Market Cap": cap, "FCF Yield": fcfYield, epsGrowth: growth } }) as never;

describe("the premium the S&P 500 pays", () => {
  it("is the rate at which the index's cash, growing as expected, is worth its price", () => {
    const rate = requiredReturn(0.03, 0.12, 0.032)!;
    expect(valueOfIndex(rate, 0.03, 0.12, 0.032)).toBeCloseTo(1, 6);
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.11);
  });

  it("weights the members by market value, leaves lenders out of the yield, and states a fallback", () => {
    const rows = Array.from({ length: 300 }, (_, index) => row(100 + index, index % 10 === 0 ? null : 4, 10));
    const premium = marketPremium({ rows }, 0.052);
    expect(premium.fallback).toBe(false);
    expect(premium.cashYield).toBeCloseTo(0.04);
    expect(premium.premium).toBeGreaterThan(0.035);
    expect(premium.premium).toBeLessThan(0.07);
    expect(marketPremium({ rows: rows.slice(0, 10) }, 0.052).fallback).toBe(true);
    expect(marketPremium({ rows }, null).premium).toBe(0.05);
  });

  it("grows for ever at the Treasury less two points, between 2.5% and 3.5%", () => {
    expect(terminalGrowthFor(0.0521)).toBeCloseTo(0.0321);
    expect(terminalGrowthFor(0.02)).toBe(0.025);
    expect(terminalGrowthFor(0.08)).toBe(0.035);
    expect(terminalGrowthFor(null)).toBe(0.03);
  });
});
