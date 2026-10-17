import { describe, expect, it } from "vitest";
import { alignedWeeklyReturns, adjustedBeta, BETA_FLOOR, costOfEquity, EQUITY_RISK_PREMIUM, rawBeta, returnsOf } from "../lib/io/cost-of-equity";

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
    // Its measured beta stays on record; the rate is struck on the floor of 0.6.
    expect(defensive.beta).toBeCloseTo(adjustedBeta(.2), 6);
    expect(defensive.rate).toBeCloseTo(.0483 + BETA_FLOOR * EQUITY_RISK_PREMIUM, 6);
    // The spread the four buttons were pretending did not exist.
    expect(volatile.rate - defensive.rate).toBeGreaterThan(.04);
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

// Date-aware regression tests protect against an economically plausible beta
// produced from different calendar intervals when one history has missing bars.
describe("matched weekly intervals", () => {
  const bars = (factor: number) => {
    let price = 100;
    return Array.from({ length: 131 }, (_, index) => {
      if (index) price *= 1 + (Math.sin(index / 3) * .02 + .001) * factor;
      return { date: new Date(Date.UTC(2024, 0, 5) + index * 7 * 86_400_000).toISOString().slice(0, 10), adjustedClose: price };
    });
  };

  it("recovers beta with different missing weeks without bridging them", () => {
    const company = bars(1.5).filter((_, index) => index !== 30);
    const benchmark = bars(1).filter((_, index) => index !== 70);
    const paired = alignedWeeklyReturns(company, benchmark);
    expect(paired.company).toHaveLength(126);
    expect(rawBeta(paired.company, paired.market)).toBeCloseTo(1.5, 10);
    expect(paired.startDate).toBe("2024-01-05");
    expect(paired.endDate).toBe(bars(1).at(-1)!.date);
  });

  it("invalidates both adjacent intervals around a missing adjusted close", () => {
    const company = bars(1.5).map((bar, index) => index === 30 ? { ...bar, adjustedClose: null } : bar);
    const paired = alignedWeeklyReturns(company, bars(1));
    expect(paired.company).toHaveLength(128);
    expect(rawBeta(paired.company, paired.market)).toBeCloseTo(1.5, 10);
  });

  it("requires both endpoints to match rather than only the return date", () => {
    const company = bars(1.5);
    company[30] = { ...company[30], date: new Date(Date.parse(company[30].date) - 86_400_000).toISOString().slice(0, 10) };
    expect(alignedWeeklyReturns(company, bars(1)).company).toHaveLength(128);
  });

  it("sorts histories and refuses raw closes instead of mixing adjustment conventions", () => {
    expect(alignedWeeklyReturns(bars(1.5).reverse(), bars(1)).company).toHaveLength(130);
    expect(alignedWeeklyReturns([{ date: "2025-01-03" }, { date: "2025-01-10" }], bars(1)).company).toEqual([]);
  });

  it("rejects non-finite regressions and premiums, and discloses applied beta", () => {
    const invalid = [...market]; invalid[10] = NaN;
    expect(rawBeta(times(1), invalid)).toBeNull();
    expect(costOfEquity(.04, times(1), market, NaN)).toBeNull();
    expect(costOfEquity(.04, times(1), market, -.01)).toBeNull();
    expect(costOfEquity(.01, times(.2), market)!.appliedBeta).toBe(BETA_FLOOR);
    expect(costOfEquity(.005, times(.2), market)!.rate).toBeCloseTo(.035);
  });
});
