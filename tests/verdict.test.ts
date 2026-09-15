import { describe, expect, it } from "vitest";
import { growthOf, qualityOf, valuationOf } from "../lib/io/verdict";
import type { IoCompanyView } from "../lib/io/view";

const year = (end: string, freeCashFlowPerShare: number) => ({ label: `FY ${end.slice(0, 4)}`, end, values: { freeCashFlowPerShare } });

describe("a company in four answers", () => {
  it("calls an A grade a quality business and a B grade not one, and says when there is no grade", () => {
    expect(qualityOf({ grade: "A-", pillars: { Quality: 72 } }).answer).toBe("Yes");
    expect(qualityOf({ grade: "B+", pillars: { Quality: 64 } }).answer).toBe("No");
    expect(qualityOf({ grade: "NR", pillars: { Quality: null } }).answer).toBeNull();
    expect(qualityOf(null, true).note).toBe("Scoring…");
  });

  it("reads historic growth from five years of free cash flow per share, in words", () => {
    const compounding = { company: { businessType: "operating" }, annual: [year("2020-12-31", 10), year("2021-12-31", 11), year("2022-12-31", 12.5), year("2023-12-31", 14), year("2024-12-31", 15.5), year("2025-12-31", 17.6)] } as unknown as IoCompanyView;
    const growth = growthOf(compounding);
    expect(growth.five).toBeCloseTo((17.6 / 10) ** (1 / 5) - 1, 3);
    expect(growth.words).toBe("Strong");
    const shrinking = { ...compounding, annual: compounding.annual.map((period, index) => ({ ...period, values: { freeCashFlowPerShare: 20 - index } })) } as unknown as IoCompanyView;
    expect(growthOf(shrinking).words).toBe("Shrinking");
  });

  it("gives a bank no valuation or growth reading, and says why", () => {
    const bank = { company: { businessType: "bank" }, annual: [], trailing: [], basis: null } as unknown as IoCompanyView;
    expect(valuationOf(bank, null).note).toMatch(/bank/);
    expect(growthOf(bank).five).toBeNull();
  });
});
