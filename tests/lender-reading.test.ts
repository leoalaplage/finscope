import { describe, expect, it } from "vitest";
import { lenderHealth, lenderQuality, lenderValuation, readsAsLender } from "@/lib/io/lender";
import { verdictOf } from "@/lib/io/verdict";
import type { IoCompanyView } from "@/lib/io/view";

// American Express, as filed: ROE about a third, equity about an eleventh of assets.
const year = (y: number, netIncome: number, equity: number, assets: number, revenuePerShare: number) => ({
  label: `FY ${y}`, end: `${y}-12-31`, currency: "USD",
  values: { netIncome, totalEquity: equity, totalAssets: assets, returnOnEquity: netIncome / equity, returnOnAssets: netIncome / assets, revenuePerShare, netIncomePerShare: netIncome / 700 },
});
const annual = [year(2020, 3.1, 22.98, 191.4, 27.3), year(2021, 8.06, 22.18, 188.5, 35.1), year(2022, 7.51, 24.71, 228.4, 45.5), year(2023, 8.37, 28.06, 261.1, 50.6), year(2024, 10.13, 30.26, 271.5, 54.5), year(2025, 10.83, 33.47, 300.1, 59.3)];
const axp = {
  company: { ticker: "AXP", businessType: "financial", currency: "USD" },
  annual, quarterly: [], trailing: [annual[5]], ttm: annual[5],
  basis: { currency: "USD", shares: 675, sharesBasis: "outstanding", netDebt: null },
} as unknown as IoCompanyView;

describe("a lender, read as a lender", () => {
  it("is a quality business on five years of return on equity with no loss", () => {
    const quality = lenderQuality(axp);
    expect(quality.answer).toBe("Yes");
    expect(quality.averageRoe).toBeGreaterThan(0.3);
    const weak = { ...axp, annual: annual.map((period, index) => (index === 3 ? { ...period, values: { ...period.values, netIncome: -1, returnOnEquity: -0.04 } } : period)) } as unknown as IoCompanyView;
    expect(lenderQuality(weak).answer).toBe("No");
  });

  it("reads health from tangible capital and return on assets, the worse of the two", () => {
    const health = lenderHealth(axp);
    expect(health.questions[0].reading).toBeCloseTo(33.47 / 300.1, 4);
    expect(health.questions[0].state).toBe("sound");
    expect(health.questions[1].state).toBe("fortress");
    expect(health.state).toBe("sound");
  });

  it("prices growth on the earnings yield, on the site's own scale", () => {
    const valuation = lenderValuation(axp, { price: 308.17, currency: "USD" });
    expect(valuation.reading.fcfYield).toBeCloseTo(10.83 / (308.17 * 675), 6);
    expect(valuation.score).not.toBeNull();
  });

  it("fills all four answers where the industrial readings gave dashes", () => {
    const verdict = verdictOf(axp, { price: 308.17, currency: "USD" }, null);
    expect(verdict.quality.answer).toBe("Yes");
    expect(verdict.health.state).toBe("sound");
    expect(verdict.valuation.score).not.toBeNull();
    expect(verdict.growth.five).not.toBeNull();
  });

  it("leaves an industrial company and a graded lender's quality to the Quality Score", () => {
    const industrial = { ...axp, company: { ...axp.company, businessType: "operating" } } as unknown as IoCompanyView;
    expect(readsAsLender(industrial, "health", false)).toBe(false);
    expect(readsAsLender(axp, "quality", true)).toBe(false);
    expect(readsAsLender(axp, "quality", false)).toBe(true);
  });
});
