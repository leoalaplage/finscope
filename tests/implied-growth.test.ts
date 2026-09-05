import { describe, expect, it } from "vitest";
import { impliedGrowth, presentValue, projectCashFlows, valuePath, type ImpliedGrowthTerms } from "../lib/io/implied-growth";

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

  it("values a flat cash flow the way the perpetuity says it should", () => {
    // Ten years at nought growth, then 2.5% for ever, discounted at 10%: the
    // closed form of the same sum, to check the loop against arithmetic.
    const flat = terms({ terminalGrowth: 0 });
    const annuity = 50 * (1 - 1.1 ** -10) / .1;
    const terminal = (50 / .1) / 1.1 ** 10;
    expect(presentValue(flat, 0)).toBeCloseTo(annuity + terminal, 6);
  });
});
