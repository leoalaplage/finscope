import { describe, expect, it } from "vitest";
import { calculateDcf, defaultDcfAssumptions } from "../lib/dcf";
import { defaultFullDcfScenarios, fullDcfBase, scenarioResults, terminalConsistency } from "../lib/io/full-dcf";
import { decodeFullDcf, encodeFullDcf } from "../components/io/FullDcf";
import type { IoCompanyView, IoPeriod } from "../lib/io/view";

const period = (year: number, values: Record<string, number>): IoPeriod => ({
  label: `FY${year}`,
  end: `${year}-12-31`,
  start: `${year}-01-01`,
  fiscalYear: year,
  fiscalQuarter: "FY",
  filingDate: `${year + 1}-02-01`,
  publishedAt: `${year + 1}-02-01`,
  accession: `${year}-test`,
  currency: "USD",
  values,
  valuationBasis: null,
});

const annual = Array.from({ length: 6 }, (_, index) => {
  const year = 2020 + index;
  const revenue = 80_000_000_000 * 1.08 ** index;
  return period(year, {
    revenue,
    operatingMargin: .28,
    freeCashFlow: revenue * .22,
    dilutedShares: 5_000_000_000 * .995 ** index,
    cashAndEquivalents: 25_000_000_000,
    totalDebt: 15_000_000_000,
    effectiveTaxRate: .19,
    depreciationAndAmortization: revenue * .035,
    capitalExpenditures: revenue * .045,
    netWorkingCapital: revenue * .08,
  });
});

const view = {
  company: { ticker: "TEST", name: "Test Corp", cik: "1", exchange: "NYSE", sector: "Technology", currency: "USD", description: "", businessType: null, resolution: "" },
  retrievedAt: "2026-09-10T00:00:00Z",
  current: null,
  metrics: [],
  annual,
  quarterly: [],
  trailing: [],
  ttm: null,
  basis: null,
  basisReason: null,
  withheldReason: null,
  warnings: [],
} satisfies IoCompanyView;

describe("the unified full DCF", () => {
  it("builds bear, base and bull from the same filed base", () => {
    expect(fullDcfBase(view)).toMatchObject({ operatingMargin: .28, cash: 25_000_000_000, debt: 15_000_000_000 });
    const scenarios = defaultFullDcfScenarios(view);
    expect(scenarios).not.toBeNull();
    const results = scenarioResults(view, scenarios!);
    expect(results?.bear.intrinsicValuePerShare).toBeLessThan(results?.base.intrinsicValuePerShare ?? 0);
    expect(results?.bull.intrinsicValuePerShare).toBeGreaterThan(results?.base.intrinsicValuePerShare ?? Infinity);
  });

  it("round-trips the entire scenario set through one URL token", () => {
    const scenarios = defaultFullDcfScenarios(view)!;
    const token = encodeFullDcf("TEST", "bull", scenarios);
    const restored = decodeFullDcf(`?s=TEST&mode=full&d=${token}`, "TEST");
    expect(restored?.active).toBe("bull");
    expect(restored?.scenarios.base.forecastYears).toBe(scenarios.base.forecastYears);
    expect(restored?.scenarios.base.revenueGrowth[0]).toBeCloseTo(scenarios.base.revenueGrowth[0], 6);
    expect(restored?.scenarios.bear.wacc).toBeCloseTo(scenarios.bear.wacc, 6);
    expect(restored?.scenarios.bull.terminalGrowth).toBeCloseTo(scenarios.bull.terminalGrowth, 6);
  });

  it("flags perpetual growth that has no reinvestment behind it", () => {
    const base = fullDcfBase(view)!;
    const assumptions = defaultDcfAssumptions(base);
    assumptions.depreciationPercentRevenue = Array(10).fill(.05);
    assumptions.capexPercentRevenue = Array(10).fill(.03);
    assumptions.workingCapitalPercentRevenue = Array(10).fill(0);
    const check = terminalConsistency(calculateDcf(base, assumptions), assumptions);
    expect(check.state).toBe("inconsistent");
    expect(check.message).toContain("Positive perpetual growth");
  });
});
