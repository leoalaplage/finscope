import { describe, expect, it } from "vitest";
import { impliedGrowth, impliedReturn, presentValue, projectCashFlows, valuePath, type ImpliedGrowthTerms } from "../lib/io/implied-growth";

/**
 * A discounted cash flow run backwards.
 *
 * Nothing here forecasts anything. The price is filed by the market and the
 * cash flow is filed with the SEC; what comes out is the rate that reconciles
 * them, which is a fact about the price rather than an opinion about the
 * company.
 */
const terms = (over: Partial<ImpliedGrowthTerms> = {}): ImpliedGrowthTerms => ({
  marketCap: 1_000, freeCashFlow: 50, discountRate: .1, years: 10, terminalGrowth: .025, ...over,
});

describe("what a price implies", () => {
  it("returns the rate that values the company at exactly its price", () => {
    const solved = impliedGrowth(terms());
    expect(solved.kind).toBe("solved");
    if (solved.kind !== "solved") return;
    // The definition, checked rather than restated: discounting at that rate
    // reproduces the market capitalisation.
    expect(presentValue(terms(), solved.rate)).toBeCloseTo(1_000, 6);
  });

  it("asks more of a dearer price and less of a cheaper one", () => {
    const dear = impliedGrowth(terms({ marketCap: 2_000 }));
    const cheap = impliedGrowth(terms({ marketCap: 500 }));
    expect(dear.kind === "solved" && cheap.kind === "solved").toBe(true);
    if (dear.kind !== "solved" || cheap.kind !== "solved") return;
    expect(dear.rate).toBeGreaterThan(cheap.rate);
  });

  it("implies a decline where the price is below what standing still is worth", () => {
    // Fifty of cash a year, discounted at 10% with 2.5% for ever, is worth far
    // more than three hundred. A price that low is not asking for growth.
    const solved = impliedGrowth(terms({ marketCap: 300 }));
    expect(solved.kind).toBe("solved");
    if (solved.kind !== "solved") return;
    expect(solved.rate).toBeLessThan(0);
  });

  it("says a price is beyond the band rather than clamping it to the edge", () => {
    const absurd = impliedGrowth(terms({ marketCap: 5_000_000 }));
    expect(absurd).toEqual({ kind: "beyond", bound: 1, direction: "above" });
    const rubble = impliedGrowth(terms({ marketCap: 1 }));
    expect(rubble).toEqual({ kind: "beyond", bound: -.5, direction: "below" });
  });

  it("refuses a company with no positive cash flow rather than inventing one", () => {
    const loss = impliedGrowth(terms({ freeCashFlow: -20 }));
    expect(loss.kind).toBe("unavailable");
    if (loss.kind !== "unavailable") return;
    expect(loss.reason).toContain("not positive");
  });

  it("refuses the arithmetic that values every company at infinity", () => {
    expect(impliedGrowth(terms({ discountRate: .02, terminalGrowth: .025 })).kind).toBe("unavailable");
    expect(impliedGrowth(terms({ discountRate: .025, terminalGrowth: .025 })).kind).toBe("unavailable");
  });

  it("asks less of the same price at a lower discount rate", () => {
    // The one number nobody filed moves the answer, which is exactly why it is
    // stated on screen beside it.
    const patient = impliedGrowth(terms({ discountRate: .08 }));
    const demanding = impliedGrowth(terms({ discountRate: .12 }));
    expect(patient.kind === "solved" && demanding.kind === "solved").toBe(true);
    if (patient.kind !== "solved" || demanding.kind !== "solved") return;
    expect(patient.rate).toBeLessThan(demanding.rate);
  });

  it("draws the same cash flows it discounts", () => {
    // The picture and the sum have to be the same claim: discounting the
    // projected flows by hand must reproduce the present value, or the chart
    // would be drawing one thing while the figure states another.
    const rate = .07;
    const flows = projectCashFlows(50, rate, 10);
    expect(flows[0]).toBeCloseTo(53.5, 10);
    expect(flows).toHaveLength(10);
    const discounted = flows.reduce((sum, flow, index) => sum + flow / 1.1 ** (index + 1), 0);
    const terminal = (flows[9] * 1.025) / (.1 - .025) / 1.1 ** 10;
    expect(discounted + terminal).toBeCloseTo(presentValue(terms(), rate), 6);
  });

  it("projects a decline as a decline", () => {
    const shrinking = projectCashFlows(100, -.1, 3);
    expect(shrinking.map((flow) => Math.round(flow))).toEqual([90, 81, 73]);
  });

  it("starts the value path at the value itself", () => {
    // The path's first point is today's valuation: one model, struck at
    // eleven dates rather than two models that could disagree.
    const path = valuePath(terms(), .07);
    expect(path).toHaveLength(11);
    expect(path[0]).toBeCloseTo(presentValue(terms(), .07), 6);
  });

  it("grows the value at the discount rate less the cash paid out", () => {
    // The identity the path is built on, checked forwards: a year's value is
    // the previous year's compounded at the discount rate, less that year's
    // cash, which the holder has received rather than the company kept.
    const rate = .07;
    const path = valuePath(terms(), rate);
    const flows = projectCashFlows(50, rate, 10);
    for (let year = 1; year <= 10; year++) {
      expect(path[year]).toBeCloseTo(path[year - 1] * 1.1 - flows[year - 1], 6);
    }
  });

  it("ends on the perpetuity, which is all that is left by then", () => {
    const rate = .07;
    const path = valuePath(terms(), rate);
    const last = projectCashFlows(50, rate, 10)[9];
    expect(path[10]).toBeCloseTo((last * 1.025) / (.1 - .025), 6);
  });

  it("answers the same question from the other side", () => {
    // Fix what the reader requires and the arithmetic says what the company
    // must do; fix what the company does and it says what the reader earns.
    // The two inversions have to meet: at the growth the price implies for a
    // 10% requirement, the return on that price is 10%.
    const asked = impliedGrowth(terms());
    expect(asked.kind).toBe("solved");
    if (asked.kind !== "solved") return;
    const earned = impliedReturn({ marketCap: 1_000, freeCashFlow: 50, years: 10, terminalGrowth: .025 }, asked.rate);
    expect(earned.kind).toBe("solved");
    if (earned.kind !== "solved") return;
    expect(earned.rate).toBeCloseTo(.1, 5);
  });

  it("earns less on a dearer price for the same record", () => {
    const record = { marketCap: 1_000, freeCashFlow: 50, years: 10, terminalGrowth: .025 };
    const cheap = impliedReturn({ ...record, marketCap: 600 }, .05);
    const dear = impliedReturn({ ...record, marketCap: 2_000 }, .05);
    expect(cheap.kind === "solved" && dear.kind === "solved").toBe(true);
    if (cheap.kind !== "solved" || dear.kind !== "solved") return;
    expect(cheap.rate).toBeGreaterThan(dear.rate);
  });

  it("says a price no return can justify is beyond the band", () => {
    const priced = impliedReturn({ marketCap: 10_000_000, freeCashFlow: 50, years: 10, terminalGrowth: .025 }, 0);
    expect(priced.kind).toBe("beyond");
    if (priced.kind !== "beyond") return;
    // Below the floor: even a return barely above the terminal rate — the
    // lowest the arithmetic can express — does not reach that price.
    expect(priced.direction).toBe("below");
    expect(priced.bound).toBeCloseTo(.03, 10);
  });

  it("values a flat cash flow the way the perpetuity says it should", () => {
    // Ten years at nought growth, then 2.5% for ever, discounted at 10%: the
    // closed form of the same sum, to check the loop against arithmetic.
    const flat = terms({ terminalGrowth: 0 });
    const annuity = 50 * (1 - 1.1 ** -10) / .1;
    const terminal = (50 / .1) / 1.1 ** 10;
    expect(presentValue(flat, 0)).toBeCloseTo(annuity + terminal, 6);
  });
});

/**
 * The shape of the projection, which used to be a cliff.
 *
 * A rate held flat for ten years and then dropped to two and a half per cent
 * overnight is a path no business has ever taken. Holding it for five and
 * fading it over the next five is the ordinary two-stage form, and it is not
 * cosmetic: the later years are worth less, so the early ones have to carry
 * more, and the rate a price demands rises.
 */
describe("the fade to the terminal rate", () => {
  const flat = { marketCap: 1_000, freeCashFlow: 50, discountRate: .10, years: 10, terminalGrowth: .025 };
  const faded = { ...flat, holdYears: 5 };

  it("holds the rate, then walks it down to the terminal one", () => {
    const flows = projectCashFlows(100, .20, 10, { terminalGrowth: .02, holdYears: 5 });
    const growth = flows.map((flow, index) => (index === 0 ? flow / 100 : flow / flows[index - 1]) - 1);
    // Five years at the rate itself.
    for (let year = 0; year < 5; year++) expect(growth[year], `year ${year + 1}`).toBeCloseTo(.20, 10);
    // Then five steps of equal size down to the terminal rate.
    expect(growth[5]).toBeCloseTo(.164, 3);
    expect(growth[9]).toBeCloseTo(.02, 10);
    for (let year = 6; year < 10; year++) {
      expect(growth[year - 1] - growth[year]).toBeCloseTo(.036, 3);
    }
  });

  it("makes a price demand more of the early years", () => {
    // The same price, the same cash, a shape that gives less away later.
    const onFlat = impliedGrowth(flat);
    const onFade = impliedGrowth(faded);
    expect(onFlat.kind).toBe("solved");
    expect(onFade.kind).toBe("solved");
    expect((onFade as { rate: number }).rate).toBeGreaterThan((onFlat as { rate: number }).rate);
  });

  it("is one shape, read by every function that draws or solves it", () => {
    /*
     * A fade applied to the cash flows and not to the value path is two models
     * on one page: the headline would answer for one projection and the chart
     * would draw another.
     */
    const rate = (impliedGrowth(faded) as { rate: number }).rate;
    expect(presentValue(faded, rate)).toBeCloseTo(1_000, 6);
    expect(valuePath(faded, rate)[0]).toBeCloseTo(1_000, 6);
    const flows = projectCashFlows(50, rate, 10, faded);
    let discounted = 0;
    flows.forEach((flow, index) => { discounted += flow / 1.10 ** (index + 1); });
    const terminal = (flows[9] * 1.025) / (.10 - .025) / 1.10 ** 10;
    expect(discounted + terminal).toBeCloseTo(1_000, 6);
  });

  it("leaves the flat model exactly as it was when no hold is stated", () => {
    // Every caller that does not ask for a fade gets the model it had.
    const rate = .07;
    expect(presentValue(flat, rate)).toBeCloseTo(presentValue({ ...flat, holdYears: 10 }, rate), 10);
    expect(projectCashFlows(50, rate, 10)).toEqual(projectCashFlows(50, rate, 10, { terminalGrowth: .025, holdYears: 10 }));
  });
});
