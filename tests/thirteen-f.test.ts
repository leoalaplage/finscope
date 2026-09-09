import { describe, expect, it } from "vitest";
import { impliedPrice, pricingDisagreement, valueInDollars } from "../lib/thirteen-f.js";

/**
 * Reading a 13F value in the unit its filer used.
 *
 * The form used to be filed in thousands of dollars and is now filed in whole
 * ones, and nothing in the file says which convention a row is on. T. Rowe
 * Price reported 33m shares of Meta at $18.9m — fifty-seven cents for a share
 * that traded at $572 — and it went onto the page, because this logic lived
 * inside a build script where nothing could test it.
 */
describe("a 13F value", () => {
  const META = 572.13;

  it("finds the price from what the filers themselves implied", () => {
    // No price is fetched: the median of thousands of filers is the price.
    expect(impliedPrice([560, 572.13, 571, 0.57, 580])).toBeCloseTo(571, 6);
    expect(impliedPrice([])).toBeNull();
    expect(impliedPrice([0, -3, Number.NaN])).toBeNull();
  });

  it("takes a value that agrees with everybody else as filed", () => {
    const filed = valueInDollars(32_985_340 * META, 32_985_340, META);
    expect(filed.state).toBe("as-filed");
    expect(filed.value).toBeCloseTo(32_985_340 * META, 0);
  });

  it("rescales the filing that broke it", () => {
    /*
     * The real row: T. Rowe Price, 32,985,340 shares of Meta, reported as
     * 18,871,903 — which is the position in thousands of dollars.
     */
    const { value, state } = valueInDollars(18_871_903, 32_985_340, META);
    expect(state).toBe("rescaled");
    expect(value).toBe(18_871_903_000);
    expect(value! / 32_985_340).toBeCloseTo(META, 2);
  });

  it("withholds a value it cannot account for rather than guessing", () => {
    // A hundredth is neither convention, so there is no correction to make.
    expect(valueInDollars(META * 100, 10_000, META).state).toBe("withheld");
    // And with no company price to compare against there is nothing to test.
    expect(valueInDollars(1_000, 10, Number.NaN).state).toBe("withheld");
  });

  it("says nothing at all where the filing says nothing", () => {
    expect(valueInDollars(0, 10, META)).toEqual({ value: null, state: "absent" });
    expect(valueInDollars(100, 0, META)).toEqual({ value: null, state: "absent" });
  });

  it("keeps a value a fifth away, because a quarter end is not a single day", () => {
    // A filer may value a holding a few days off the quarter end, and a
    // volatile share moves. The band is wide on purpose and nowhere near the
    // thousandfold one.
    expect(valueInDollars(10_000 * META * 0.8, 10_000, META).state).toBe("as-filed");
    expect(valueInDollars(10_000 * META * 1.3, 10_000, META).state).toBe("as-filed");
  });
});

describe("a finished company record", () => {
  const holder = (name: string, shares: number, price: number) => ({ name, shares, value: shares * price });

  it("passes when every manager quotes one quarter-end price", () => {
    expect(pricingDisagreement([
      holder("BlackRock, Inc.", 168_800_000, 572.13),
      holder("VANGUARD CAPITAL MANAGEMENT LLC", 142_100_000, 572.13),
      holder("FMR LLC", 116_600_000, 570.11),
      holder("STATE STREET CORP", 88_500_000, 572.13),
    ])).toBeNull();
  });

  it("names the manager whose price disagrees, so a build can stop", () => {
    /*
     * This is the check the pipeline had no way of failing. Every manager in
     * one company's table is quoting the same quarter-end price; where one is
     * not, a convention has changed again and the right move is to stop rather
     * than to publish.
     */
    const found = pricingDisagreement([
      holder("BlackRock, Inc.", 168_800_000, 572.13),
      holder("VANGUARD CAPITAL MANAGEMENT LLC", 142_100_000, 572.13),
      holder("FMR LLC", 116_600_000, 572.13),
      holder("PRICE T ROWE ASSOCIATES INC /MD/", 32_985_340, 0.5721),
    ]);
    expect(found?.name).toBe("PRICE T ROWE ASSOCIATES INC /MD/");
    expect(found?.distance).toBeGreaterThan(900);
  });

  it("judges nothing on too few priced holders", () => {
    // Two managers cannot disagree with a majority that does not exist.
    expect(pricingDisagreement([holder("A", 10, 5), holder("B", 10, 5000)])).toBeNull();
  });

  it("ignores the managers whose value was withheld", () => {
    expect(pricingDisagreement([
      holder("A", 10, 572), holder("B", 10, 572), holder("C", 10, 572),
      { name: "D", shares: 10, value: 0 },
    ])).toBeNull();
  });
});
