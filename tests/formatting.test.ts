import { describe, expect, it } from "vitest";
import { formatChartValue, unitFamily } from "../lib/auto-chart";

describe("readable magnitudes", () => {
  it("abbreviates large amounts everywhere, precise or not", () => {
    expect(formatChartValue(466_823_000_000, "currency")).toBe("$466.8B");
    expect(formatChartValue(466_823_000_000, "currency", "USD", true)).toBe("$466.82B");
    expect(formatChartValue(15_000_000, "currency")).toBe("$15M");
    expect(formatChartValue(15_000_000, "currency", "USD", true)).toBe("$15M");
  });
  it("never leaves a stray trailing zero on a currency amount", () => {
    for (const value of [466_823_000_000, 15_000_000, 1_500]) {
      expect(formatChartValue(value, "currency")).not.toMatch(/\.0$/);
      expect(formatChartValue(value, "currency", "USD", true)).not.toMatch(/\.00$/);
    }
  });
  it("keeps small per-share amounts exact", () => {
    expect(formatChartValue(9.25, unitFamily("freeCashFlowPerShare"))).toBe("$9.25");
    expect(formatChartValue(306.13, unitFamily("stockPrice"))).toBe("$306.13");
  });
  it("reads share counts in magnitudes too", () => {
    expect(formatChartValue(12_230_000_000, "shares")).toBe("12.23B");
  });
});
