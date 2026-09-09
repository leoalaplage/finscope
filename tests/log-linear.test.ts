import { describe, expect, it } from "vitest";
import { logLinearRSquared } from "../lib/log-linear.js";

/**
 * How straight a series is on a log scale, which is what steady compounding is.
 *
 * A five-year growth rate says where a measure ended up and nothing about the
 * road. These three companies compound free cash flow per share at exactly
 * twelve per cent a year and are not the same business.
 */
const at = (values: number[]) => values.map((value, index) => ({ x: index, value }));

describe("the log-linear fit", () => {
  const steady = [1, 1.12, 1.25, 1.4, 1.57, 1.76];
  const cyclical = [1, 1.6, 0.9, 1.9, 1.1, 1.76];
  const collapse = [1, 0.4, 0.3, 0.8, 1.4, 1.76];

  it("separates three companies one growth rate cannot", () => {
    const cagr = (values: number[]) => (values.at(-1)! / values[0]) ** (1 / (values.length - 1)) - 1;
    for (const series of [steady, cyclical, collapse]) expect(cagr(series)).toBeCloseTo(0.12, 3);

    expect(logLinearRSquared(at(steady))!).toBeGreaterThan(0.99);
    expect(logLinearRSquared(at(collapse))!).toBeLessThan(0.5);
    expect(logLinearRSquared(at(cyclical))!).toBeLessThan(0.25);
  });

  it("scores a perfect compounder one", () => {
    // Exactly ten per cent a year is a straight line on a log scale.
    expect(logLinearRSquared(at([1, 1.1, 1.21, 1.331, 1.4641]))).toBeCloseTo(1, 10);
  });

  it("scores a straight decline as steady too", () => {
    /*
     * R² measures the fit, not the direction — a company shrinking reliably is
     * a well-described company. The score it earns comes from the anchors,
     * which is where a judgement belongs; this function makes no judgement.
     */
    expect(logLinearRSquared(at([2, 1.8, 1.62, 1.458]))).toBeCloseTo(1, 10);
  });

  it("refuses rather than returning a nought", () => {
    /*
     * "We cannot measure this" and "this is erratic" are opposite statements
     * about a company, and a nought would say the second when the first is
     * true. Two points are a straight line by definition; a zero or negative
     * year has no logarithm; a flat series has no variance to explain.
     */
    expect(logLinearRSquared(at([1, 2]))).toBeNull();
    expect(logLinearRSquared(at([1, -1, 2]))).toBeNull();
    expect(logLinearRSquared(at([1, 0, 2]))).toBeNull();
    expect(logLinearRSquared(at([2, 2, 2]))).toBeNull();
    expect(logLinearRSquared([])).toBeNull();
  });

  it("reads the spacing of the years, not their order in the array", () => {
    // A gap in the filed record is a gap in the fit: the same values at even
    // spacing are a straight line, and at uneven spacing they are not.
    const even = logLinearRSquared([{ x: 0, value: 1 }, { x: 1, value: 2 }, { x: 2, value: 4 }])!;
    const uneven = logLinearRSquared([{ x: 0, value: 1 }, { x: 5, value: 2 }, { x: 6, value: 4 }])!;
    expect(even).toBeCloseTo(1, 10);
    // Doubling every year fits; doubling after five years and again after one
    // does not, and the fit says so rather than reading the array positions.
    expect(uneven).toBeLessThan(even);
    expect(uneven).toBeCloseTo(0.871, 3);
  });
});
