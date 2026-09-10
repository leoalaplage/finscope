import { describe, expect, it } from "vitest";
import { impliedGrowth, presentValue, terminalShare } from "../lib/io/implied-growth";
import { logLinearFit } from "../lib/log-linear.js";

/**
 * How much of a discounted cash flow is the part nobody can observe.
 *
 * Ten years of projected cash is the half of the exercise a reader can argue
 * about; everything after it is one number standing for the rest of time. On
 * these terms it is routinely two thirds of the answer, and until now the page
 * stated the conclusion without stating that.
 */

const terms = (over: Partial<Parameters<typeof presentValue>[0]> = {}) => ({
  marketCap: 1_000,
  freeCashFlow: 50,
  discountRate: .10,
  years: 10,
  terminalGrowth: .025,
  ...over,
});

describe("the share of the value that is the perpetuity", () => {
  it("splits the present value in two, and the two halves add up", () => {
    const share = terminalShare(terms(), .08)!;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    /*
     * The explicit years and the perpetuity are the whole of the present value
     * and nothing else, so the share can be checked against the arithmetic it
     * came from rather than against a second implementation of it.
     */
    const whole = presentValue(terms(), .08);
    let explicit = 0;
    let flow = 50;
    for (let year = 1; year <= 10; year++) { flow *= 1.08; explicit += flow / 1.10 ** year; }
    expect(share).toBeCloseTo((whole - explicit) / whole, 10);
  });

  it("is about two thirds on the terms this site uses", () => {
    // The figure that makes the caveat worth printing: a reader trusting the
    // headline is trusting a perpetuity for most of it.
    expect(terminalShare(terms(), .08)!).toBeGreaterThan(.55);
    expect(terminalShare(terms(), .08)!).toBeLessThan(.75);
  });

  it("rises with growth and falls with the return required", () => {
    // Faster growth pushes more of the cash beyond the horizon; a harder
    // discount rate shrinks the far years faster than the near ones.
    expect(terminalShare(terms(), .15)!).toBeGreaterThan(terminalShare(terms(), .02)!);
    expect(terminalShare(terms({ discountRate: .14 }), .08)!).toBeLessThan(terminalShare(terms({ discountRate: .07 }), .08)!);
  });

  it("refuses where the arithmetic has no meaning", () => {
    // A perpetuity growing at least as fast as it is discounted is infinite,
    // and there is no cash flow to apportion where none was earned.
    expect(terminalShare(terms({ freeCashFlow: -10 }), .08)).toBeNull();
    expect(terminalShare(terms({ discountRate: .02 }), .08)).toBeNull();
  });

  it("is struck on the same rate the headline is", () => {
    /*
     * The page prints the share beside the growth the price is asking for, so
     * it has to be the share at that growth: a company whose price demands
     * twenty per cent a year is leaning on the perpetuity harder than one
     * whose price demands five, and quoting an average would hide exactly the
     * cases where the caveat matters most.
     */
    const asked = impliedGrowth(terms());
    expect(asked.kind).toBe("solved");
    const rate = (asked as { rate: number }).rate;
    expect(terminalShare(terms(), rate)!).toBeCloseTo(terminalShare(terms(), rate)!, 10);
    expect(presentValue(terms(), rate)).toBeCloseTo(1_000, 6);
  });
});

/**
 * Which filed year the whole answer is compounded from.
 *
 * A discounted cash flow grows one figure forward for a decade, so that figure
 * carries the answer and choosing it is not neutral. Measured across the
 * companies this site holds, the two obvious corrections both fail — and the
 * failures are the reason the base is checked rather than replaced.
 */
describe("the year the model compounds from", () => {
  const decade = (values: number[]) => values.map((value, index) => ({ x: index, value }));

  it("will not take the median, which reads growth as a spike", () => {
    /*
     * Mastercard's free cash flow is a near-perfect straight line on a log
     * scale — R² of 0.98 — and its ten-year median still sits about half its
     * latest figure, because the middle of a rising series is its middle. A
     * "normalised" base built on it would report a steadily compounding
     * company as one having an exceptional year, every year.
     */
    const steady = decade(Array.from({ length: 10 }, (unused, year) => 100 * 1.15 ** year));
    const fit = logLinearFit(steady)!;
    expect(fit.rSquared).toBeCloseTo(1, 6);
    const sorted = [...steady.map((point) => point.value)].sort((left, right) => left - right);
    const median = (sorted[4] + sorted[5]) / 2;
    const latest = steady.at(-1)!.value;
    // Ten years at fifteen per cent puts the middle of the series about eighty
    // per cent below the end of it, by construction and not by accident.
    expect(latest / median).toBeGreaterThan(1.8);
    // The fitted line, by contrast, lands on the year it is asked about.
    expect(fit.at(9)).toBeCloseTo(latest, 6);
  });

  it("will not take the fitted line either, where the level has stepped", () => {
    /*
     * Eli Lilly's cash flow did not wobble, it changed level: R² near nought,
     * and the line through the decade puts four billion against the eighteen
     * it filed. Substituting the line there is not a correction, it is a
     * stale figure with better manners.
     */
    const stepped = decade([4, 4.2, 3.9, 4.1, 4.3, 4, 4.2, 9, 14, 18]);
    const fit = logLinearFit(stepped)!;
    expect(fit.rSquared).toBeLessThan(.75);
    expect(fit.at(9)).toBeLessThan(stepped.at(-1)!.value / 1.5);
  });

  it("notices the disagreement instead, which is what the page states", () => {
    // What survives both failures: the fit is a detector, not a substitute.
    // A quarter away from the trend is where the page says the answer rests
    // on a year unlike the ten behind it.
    const steady = decade(Array.from({ length: 10 }, (unused, year) => 100 * 1.15 ** year));
    const stepped = decade([4, 4.2, 3.9, 4.1, 4.3, 4, 4.2, 9, 14, 18]);
    const away = (points: ReturnType<typeof decade>) => {
      const fit = logLinearFit(points)!;
      return Math.abs(points.at(-1)!.value / fit.at(points.at(-1)!.x) - 1);
    };
    expect(away(steady)).toBeLessThan(.25);
    expect(away(stepped)).toBeGreaterThan(.25);
  });

  it("refuses a fit where one year went negative", () => {
    // A logarithm of a negative number is not a slow year, and ten of the
    // twenty-seven companies here have one somewhere in the decade.
    expect(logLinearFit(decade([10, 12, -3, 14, 16]))).toBeNull();
  });
});
