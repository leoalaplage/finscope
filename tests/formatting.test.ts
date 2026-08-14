import { describe, expect, it } from "vitest";
import { formatChartValue, unitFamily } from "../lib/auto-chart";
import { chartDomain, niceBound, niceTicks } from "../lib/charting";

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

describe("readable axis bounds", () => {
  it("rounds a bound to a number a reader would have chosen", () => {
    expect(niceBound(9.99)).toBe(10);
    expect(niceBound(314)).toBe(500);
    expect(niceBound(1.4)).toBe(2);
    expect(niceBound(2.3)).toBe(2.5);
    expect(niceBound(-9.99)).toBe(-10);
    expect(niceBound(0)).toBe(0);
  });

  it("ends a zero-anchored axis on a round number, not on the data", () => {
    // The old bound was max x 1.08, so an axis over nine dollars of cash flow
    // per share read $0, $3, $6, $9, $9.99.
    expect(chartDomain([1, 9.25], "zero").domain).toEqual([0, 10]);
    // Covers the data with the least wasted space, not the roundest big number:
    // 350 in steps of 50 wastes less than 400 in steps of 100.
    expect(chartDomain([10, 314], "zero").domain).toEqual([0, 350]);
    expect(chartDomain([0.02, 0.293], "zero").domain[1]).toBe(0.3);
  });

  it("still shows both sides when the data crosses zero", () => {
    const domain = chartDomain([-4.2, 9.25], "zero").domain as [number, number];
    expect(domain[0]).toBeLessThanOrEqual(-4.2);
    expect(domain[1]).toBeGreaterThanOrEqual(9.25);
  });
});

describe("evenly spaced ticks", () => {
  it("gives every interval the same round step", () => {
    // The library's own algorithm produced 0, 3, 6, 10 over this range: three
    // equal steps and a wider one, which reads as a change of scale.
    const ticks = niceTicks(0, 10);
    expect(ticks).toEqual([0, 2, 4, 6, 8, 10]);
    const steps = ticks.slice(1).map((value, index) => Number((value - ticks[index]).toFixed(10)));
    expect(new Set(steps).size).toBe(1);
  });

  it("covers the data and stops on a round number", () => {
    expect(niceTicks(0, 500)).toEqual([0, 100, 200, 300, 400, 500]);
    expect(niceTicks(0, 0.5)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    // Between three and six intervals, always.
    for (const [low, high] of [[0, 9.25], [0, 314], [0, 0.293], [0, 466_823_000_000]]) {
      const ticks = niceTicks(low, high);
      expect(ticks.length).toBeGreaterThanOrEqual(4);
      expect(ticks.length).toBeLessThanOrEqual(9);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(high);
    }
  });

  it("spans zero without drifting off the round step", () => {
    const ticks = niceTicks(-5, 10);
    expect(ticks[0]).toBeLessThanOrEqual(-5);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(10);
    const steps = ticks.slice(1).map((value, index) => Number((value - ticks[index]).toFixed(10)));
    expect(new Set(steps).size).toBe(1);
  });

  it("does not leak binary rounding into a label", () => {
    for (const value of niceTicks(0, 0.3)) expect(String(value)).not.toMatch(/\d{6,}/);
  });
});

describe("ratio labels", () => {
  it("drops a decimal the value does not need", () => {
    expect(formatChartValue(10, "ratio")).toBe("10×");
    expect(formatChartValue(38.8, "ratio")).toBe("38.8×");
    expect(formatChartValue(0, "ratio")).toBe("0×");
  });
});

describe("percentage labels", () => {
  it("drops decimals a rebased series does not need", () => {
    expect(formatChartValue(0.293, "percent")).toBe("29.3%");
    expect(formatChartValue(1.5, "percent")).toBe("150%");
    expect(formatChartValue(62.354, "percent")).toBe("6235%");
    expect(formatChartValue(-20, "percent")).toBe("-2000%");
    // One axis must not mix precisions.
    for (const value of [-2, 2, 6, 10, 14]) expect(formatChartValue(value, "percent")).not.toMatch(/\./);
    // The tooltip may be finer than the axis.
    expect(formatChartValue(11.234, "percent", "USD", true)).toBe("1123.4%");
  });
});
