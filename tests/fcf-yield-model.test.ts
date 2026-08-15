import { describe, expect, it } from "vitest";
import { calculateFcfYieldModel, multipleToYield, suggestedGrowth, yieldToMultiple, type FcfYieldInputs } from "../lib/fcf-yield-model";

const inputs = (over: Partial<FcfYieldInputs> = {}): FcfYieldInputs => ({
  fcfPerShare: 17.21, growthRate: .07, exitYield: .03, exitMultiple: 25,
  useMultiple: false, desiredReturn: .1, years: 5, ...over,
});

describe("reverse DCF on free cash flow per share", () => {
  // Anchored to a worked example: 17.21 growing at 7% for five years is 24.14,
  // valued at a 3% yield is 804.6, discounted at 10% for five years is 499.59.
  it("reproduces the worked example end to end", () => {
    const result = calculateFcfYieldModel(inputs(), 245)!;
    expect(result.exitFcfPerShare).toBeCloseTo(24.138, 2);
    expect(result.exitPrice).toBeCloseTo(804.6, 0);
    expect(result.entryPrice).toBeCloseTo(499.59, 1);
    expect(result.returnFromCurrentPrice!).toBeCloseTo(.2684, 3);
  });

  it("treats a yield and a multiple as the same assumption", () => {
    const byYield = calculateFcfYieldModel(inputs({ exitYield: .04 }), 200)!;
    const byMultiple = calculateFcfYieldModel(inputs({ useMultiple: true, exitMultiple: 25 }), 200)!;
    expect(byMultiple.exitPrice).toBeCloseTo(byYield.exitPrice, 6);
    expect(yieldToMultiple(.04)).toBe(25);
    expect(multipleToYield(25)).toBe(.04);
  });

  it("returns exactly the desired return when bought at the entry price", () => {
    const first = calculateFcfYieldModel(inputs(), 100)!;
    const atEntry = calculateFcfYieldModel(inputs(), first.entryPrice)!;
    expect(atEntry.returnFromCurrentPrice!).toBeCloseTo(.1, 10);
  });

  it("still gives an entry price when no market price is available", () => {
    const result = calculateFcfYieldModel(inputs(), null)!;
    expect(result.entryPrice).toBeCloseTo(499.59, 1);
    expect(result.returnFromCurrentPrice).toBeNull();
    expect(result.marginOfSafety).toBeNull();
  });

  it("draws a path that starts at today's price and ends at the exit price", () => {
    const result = calculateFcfYieldModel(inputs(), 245)!;
    expect(result.projection).toHaveLength(6);
    expect(result.projection[0].price).toBeCloseTo(245, 6);
    expect(result.projection.at(-1)!.price).toBeCloseTo(result.exitPrice, 6);
    // Free cash flow compounds at the growth rate independently of the price.
    expect(result.projection.at(-1)!.fcfPerShare).toBeCloseTo(result.exitFcfPerShare, 8);
  });

  it("reports a margin of safety only against a real price", () => {
    const cheap = calculateFcfYieldModel(inputs(), 400)!;
    // The entry price for 10% is 499.59, so 400 is comfortably below it.
    expect(cheap.marginOfSafety!).toBeGreaterThan(0);
    const dear = calculateFcfYieldModel(inputs(), 600)!;
    expect(dear.marginOfSafety!).toBeLessThan(0);
  });

  it("refuses a model it cannot state honestly", () => {
    expect(calculateFcfYieldModel(inputs({ fcfPerShare: 0 }), 100)).toBeNull();
    expect(calculateFcfYieldModel(inputs({ fcfPerShare: -3 }), 100)).toBeNull();
    expect(calculateFcfYieldModel(inputs({ exitYield: 0 }), 100)).toBeNull();
    expect(calculateFcfYieldModel(inputs({ useMultiple: true, exitMultiple: 0 }), 100)).toBeNull();
  });

  it("handles a shrinking business without inventing a positive path", () => {
    const result = calculateFcfYieldModel(inputs({ growthRate: -.1 }), 245)!;
    expect(result.exitFcfPerShare).toBeLessThan(17.21);
    expect(result.returnFromCurrentPrice!).toBeLessThan(.2684);
  });
});

describe("growth seeding", () => {
  it("takes the more conservative of the two horizons", () => {
    expect(suggestedGrowth(.18, .09)).toBeCloseTo(.09, 10);
    expect(suggestedGrowth(.05, .12)).toBeCloseTo(.05, 10);
  });

  it("caps an extrapolated boom, because nothing compounds at 40% for a decade", () => {
    expect(suggestedGrowth(.62, .55)).toBe(.2);
    expect(suggestedGrowth(-.9, -.8)).toBe(-.2);
  });

  it("falls back to a stated default when there is no usable history", () => {
    expect(suggestedGrowth(null, null)).toBe(.07);
    expect(suggestedGrowth(null, .11)).toBeCloseTo(.11, 10);
  });
});
