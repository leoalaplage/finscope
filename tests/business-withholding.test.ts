import { describe, expect, it } from "vitest";
import { balanceSheetIsTheBusiness, isFinancialBusiness } from "../lib/business-type";

/**
 * One question, asked in one place.
 *
 * Two predicates existed and they were not interchangeable. "Is this a
 * financial company" is about sector; "is the balance sheet the business" is
 * about whether free cash flow, net debt and return on invested capital are
 * measures or category errors. Every withholding on the site is the second
 * question, and most of them were asking the first.
 *
 * Cboe and CME were the cost. Both earn fees, buy ordinary equipment and carry
 * a clean decade of free cash flow on their own company pages — which read the
 * narrow predicate — while the score read the wide one and refused all of it.
 * They came out at 36% and 26% coverage, under any floor, unrated.
 */
describe("which filers have their cash-flow measures withheld", () => {
  it("withholds them where the balance sheet is the business", () => {
    for (const type of ["bank", "broker", "insurer", "financial"] as const) {
      expect(balanceSheetIsTheBusiness(type), type).toBe(true);
    }
  });

  it("does not withhold them from an exchange or a holding company", () => {
    // Cboe's capital expenditure is equipment and CME's is equipment; Berkshire's
    // is railways and utilities. All three are exactly what they look like.
    expect(balanceSheetIsTheBusiness("exchange")).toBe(false);
    expect(balanceSheetIsTheBusiness("holding")).toBe(false);
    expect(balanceSheetIsTheBusiness("operating")).toBe(false);
    expect(balanceSheetIsTheBusiness(undefined)).toBe(false);
  });

  it("keeps the wider question available, and different", () => {
    // It still has one caller: whether to strike an operating income out of
    // pre-tax income and interest expense, which is a question about sector.
    expect(isFinancialBusiness("exchange")).toBe(true);
    expect(balanceSheetIsTheBusiness("exchange")).toBe(false);
  });
});
