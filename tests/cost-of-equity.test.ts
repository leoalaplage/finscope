import { describe, expect, it } from "vitest";
import { adjustedBeta, costOfEquity, EQUITY_RISK_PREMIUM, rawBeta, returnsOf } from "../lib/io/cost-of-equity";

/**
 * The discounted cash flow's one unfiled number, stopped being a guess.
 *
 * Four buttons — six, eight, ten, twelve — decided the answer: moving the
 * required return from eight to twelve changes the growth the price is asking
 * for by seven to twelve points. A cost of equity is the standard way to stop
 * guessing, and every ingredient was already on the site.
 */

/** A market that moves, and a company that moves with it by a known factor. */
const market = Array.from({ length: 260 }, (unused, week) => Math.sin(week / 3) * .02 + .001);
const times = (factor: number, noise = 0) =>
  market.map((move, week) => move * factor + Math.cos(week / 7) * noise);

describe("beta, from the returns this site already serves", () => {
  it("recovers the factor a company moves by", () => {
    expect(rawBeta(times(1.5), market)!).toBeCloseTo(1.5, 6);
    expect(rawBeta(times(.4), market)!).toBeCloseTo(.4, 6);
  });

  it("survives noise that is not the market's", () => {
    // Idiosyncratic movement widens the scatter without tilting the line.
    expect(rawBeta(times(1.2, .01), market)!).toBeCloseTo(1.2, 1);
  });

  it("pairs the two series from the newest end", () => {
    /*
     * A company listed three years ago has three years of weeks and the index
     * has five. Lining them up from the start would pair this company's first
     * week with the index's, five years apart, for the whole run.
     */
    const young = times(1.5).slice(-150);
    expect(rawBeta(young, market)!).toBeCloseTo(1.5, 6);
  });

  it("refuses a series too short to regress", () => {
    expect(rawBeta(times(1.5).slice(-40), market)).toBeNull();
  });

  it("pulls a measured beta a third of the way towards the market", () => {
    /*
     * Betas revert. Johnson & Johnson measures 0.20 on five years of weekly
     * returns, which no provider publishes and no analyst would use; adjusted
     * it is 0.47, which is what everybody else reports.
     */
    expect(adjustedBeta(.20)).toBeCloseTo(.47, 2);
    expect(adjustedBeta(2.07)).toBeCloseTo(1.71, 2);
    expect(adjustedBeta(1)).toBe(1);
  });
});

describe("what the model charges for risk", () => {
  it("prices a defensive company below a volatile one", () => {
    const defensive = costOfEquity(.0483, times(.2), market)!;
    const volatile = costOfEquity(.0483, times(2.1), market)!;
    expect(defensive.rate).toBeLessThan(volatile.rate);
    expect(defensive.rate).toBeCloseTo(.0483 + adjustedBeta(.2) * EQUITY_RISK_PREMIUM, 6);
    // The spread the four buttons were pretending did not exist.
    expect(volatile.rate - defensive.rate).toBeGreaterThan(.05);
  });

  it("carries every ingredient, so the page can state the arithmetic", () => {
    const struck = costOfEquity(.0483, times(1.15), market)!;
    expect(struck.riskFree).toBe(.0483);
    expect(struck.rawBeta).toBeCloseTo(1.15, 6);
    expect(struck.beta).toBeCloseTo(adjustedBeta(1.15), 6);
    expect(struck.premium).toBe(EQUITY_RISK_PREMIUM);
    expect(struck.observations).toBe(260);
  });

  it("hands the choice back rather than approximating a missing ingredient", () => {
    // A cost of equity struck on an assumed risk-free rate is a guess with a
    // formula around it.
    expect(costOfEquity(null, times(1.1), market)).toBeNull();
    expect(costOfEquity(.0483, times(1.1).slice(-20), market)).toBeNull();
  });

  it("refuses a rate a perpetuity cannot live under", () => {
    /*
     * A rate at or below the terminal growth makes the perpetuity infinite,
     * and one below the Treasury is not a required return. Both are handed
     * back rather than clamped to the nearest usable number.
     */
    expect(costOfEquity(.0483, times(-1.5), market)).toBeNull();
    expect(costOfEquity(.24, times(2), market)).toBeNull();
  });
});

describe("returns from closes", () => {
  it("skips a gap rather than treating it as a move", () => {
    expect(returnsOf([100, null, 110])).toHaveLength(1);
    expect(returnsOf([100, null, 110])[0]).toBeCloseTo(.1, 12);
    // A close of nought is not a company that fell to nothing, it is a hole.
    expect(returnsOf([100, 0, 110])).toHaveLength(1);
  });
});
