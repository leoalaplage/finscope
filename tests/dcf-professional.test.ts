import { describe, expect, it } from "vitest";
import { calculateDcf, defaultDcfAssumptions } from "@/lib/dcf";
import { assumptionsFrom, dcfFoundation, dcfMissingInputs, defaultDrivers, impliedGrowth, scenarioDrivers, valueWith } from "@/lib/io/dcf-model";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";

function period(year: number, extra: Record<string, number | null> = {}): IoPeriod {
  const revenue = 1000 * 1.1 ** (year - 2020);
  return { label: `FY${year}`, end: `${year}-12-31`, start: `${year}-01-01`, fiscalYear: year, fiscalQuarter: null, filingDate: `${year + 1}-02-01`, publishedAt: `${year + 1}-02-01`, accession: `${year}`, currency: "USD", valuationBasis: null,
    values: { revenue, operatingIncome: revenue * .25, dilutedShares: 100, basicShares: 95, sharesOutstanding: 96, cashAndEquivalents: 100, shortTermInvestments: 20, totalDebt: 200, totalEquity: 500, totalAssets: 1000, capitalExpenditures: revenue * .04, depreciationAndAmortization: revenue * .03, depreciation: revenue * .03, effectiveTaxRate: .2, stockBasedCompensation: revenue * .02, interestExpense: 10, operatingCashFlow: revenue * .24, operatingWorkingCapital: revenue * .1, minorityInterest: 0, temporaryEquity: 0, ...extra } };
}
function company(periods = Array.from({ length: 6 }, (_, i) => period(2020 + i))): IoCompanyView {
  return { company: { ticker: "TEST", name: "Test", currency: "USD", businessType: "operating" }, annual: periods, trailing: [], warnings: [] } as unknown as IoCompanyView;
}
const base = { revenue: 1000, operatingMargin: .2, freeCashFlow: 150, dilutedShares: 100, cash: 50, debt: 100 };

describe("DCF accounting and source boundaries", () => {
  it("does not extrapolate shares issued for an acquisition into recurring dilution", () => {
    const view = company(Array.from({ length: 6 }, (_, i) => period(2020 + i, { dilutedShares: i >= 4 ? 180 : 100 })));
    const f = dcfFoundation(view)!;
    expect(f.record.dilution5).toBeGreaterThan(.1);
    const d = defaultDrivers(f, .1, 1000);
    expect(d.dilution).toBe(0);
    expect(valueWith(f, d).valuationShares).toBe(f.base.dilutedShares);
  });
  it("uses a point share count plus observed award dilution, with its basis stated", () => {
    const f = dcfFoundation(company())!;
    expect(f.base.dilutedShares).toBe(101);
    expect(f.shareNote).toMatch(/Period-end.*award/);
  });
  it("never replaces missing cash, debt or capital spending with zero", () => {
    for (const key of ["cashAndEquivalents", "totalDebt", "capitalExpenditures"]) {
      const view = company([period(2025, { [key]: null })]);
      expect(dcfFoundation(view)).toBeNull();
      expect(dcfMissingInputs(view).length).toBeGreaterThan(0);
    }
  });
  it("withholds the new DCF while a previous normalization is being rebuilt", () => {
    const view = company(); view.dcfDataStatus = "rebuilding";
    expect(dcfFoundation(view)).toBeNull();
    expect(dcfMissingInputs(view).join(" ")).toMatch(/updated normalization/);
  });
  it("does not silently use an old trailing period ahead of a newer annual filing", () => {
    const view = company([period(2025)]); view.trailing = [period(2023)];
    expect(dcfFoundation(view)?.basePeriod.label).toBe("FY2025");
  });
  it("normalizes separately reported intangible amortization once, keeps SBC expensed and uses physical depreciation", () => {
    const p = period(2025, { revenue: 1000, operatingIncome: 200, intangibleAmortization: 100, depreciation: 20, depreciationAndAmortization: 130 });
    const f = dcfFoundation(company([p]))!;
    expect(f.startMargin).toBeCloseTo(.3);
    expect(f.now.depreciation).toBeCloseTo(.02);
    expect(f.marginNote).toMatch(/stock compensation remains an expense/);
    const f2 = dcfFoundation(company([{ ...p, values: { ...p.values, operatingIncome: 180, stockBasedCompensation: 40 } }]))!;
    expect(f2.startMargin).toBeCloseTo(.28);
  });
  it("does not accept pre-tax plus interest as proof of operating income", () => {
    const p = period(2025, { incomeBeforeTax: 150, interestExpense: 20, otherIncomeExpense: null });
    p.basis = { operatingIncome: "Income before tax + interest expense" };
    expect(dcfFoundation(company([p]))).toBeNull();
    p.values.otherIncomeExpense = -30;
    expect(dcfFoundation(company([p]))?.startMargin).toBeCloseTo(180 / p.values.revenue!);
  });
  it("reads operating working capital instead of the old financing-contaminated metric", () => {
    const view = company(Array.from({ length: 6 }, (_, i) => { const p = period(2020 + i); p.values.netWorkingCapital = -10000 * i; return p; }));
    expect(dcfFoundation(view)!.record.workingCapital5!).toBeGreaterThan(0);
  });
});

describe("DCF operating forecasts and competitive equilibrium", () => {
  const f = dcfFoundation(company())!;
  const d = defaultDrivers(f, .1, 1000);
  it("links investment to additional revenue rather than giving growth away", () => {
    const result = valueWith(f, { ...d, reinvestmentMethod: "capital-efficiency", salesToCapital: 2 });
    let revenue = f.base.revenue;
    for (const row of result.projections.slice(0, 5)) {
      expect(row.netReinvestment).toBeCloseTo(Math.max(0, row.revenue - revenue) / 2, 8);
      expect(row.freeCashFlow).toBeCloseTo(row.nopat - row.netReinvestment, 8);
      revenue = row.revenue;
    }
  });
  it("does not invent an asset liquidation when revenue contracts", () => {
    const result = valueWith(f, { ...d, growthStart: -.1, growthEnd: -.05, reinvestmentMethod: "capital-efficiency" });
    expect(result.projections.slice(0, 5).every(row => row.netReinvestment === 0)).toBe(true);
  });
  it("uses an independently normalized N+1 cash flow and return on new capital equal to WACC by default", () => {
    const result = valueWith(f, d), last = result.projections.at(-1)!;
    const nopat = last.revenue * (1 + d.terminalGrowth) * last.operatingMargin * (1 - d.terminalTaxRate);
    expect(result.terminalReinvestment).toBeCloseTo(nopat * d.terminalGrowth / d.wacc, 8);
    expect(result.terminalValue).toBeCloseTo(nopat * (1 - d.terminalGrowth / d.wacc) / (d.wacc - d.terminalGrowth), 8);
  });
  it("has no terminal value benefit from growth when new capital earns its cost, holding terminal NOPAT fixed", () => {
    const make = (g: number) => {
      const a = defaultDcfAssumptions(base, 1); a.revenueGrowth = [0]; a.operatingMargin = [.2 / (1 + g)]; a.terminalGrowth = g; a.terminalReturnOnCapital = a.wacc; a.terminalTaxRate = .21;
      return calculateDcf(base, a).terminalValue;
    };
    expect(make(.01)).toBeCloseTo(make(.04)!, 10);
  });
  it("exposes the entire 5+fade horizon and applies the same research assumptions everywhere", () => {
    const drivers = { ...d, fadeYears: 15, research: { growth: [.3, .25, .2, .15, .1], margin: [.2, .23, .25, .27, .3] } };
    const a = assumptionsFrom(drivers, f);
    expect(a.forecastYears).toBe(20); expect(a.revenueGrowth.slice(0, 5)).toEqual(drivers.research.growth);
    expect(a.operatingMargin[19]).toBe(.3);
    expect(scenarioDrivers(drivers, "bear").research!.growth[0]).toBeLessThan(.3);
  });
  it("preserves all cases when switching an unchanged automatic path into research mode", () => {
    const a = assumptionsFrom(d, f);
    const research = { ...d, research: { growth: a.revenueGrowth.slice(0, 5), margin: a.operatingMargin.slice(0, 5) } };
    for (const scenario of ["bear", "base", "bull"] as const) {
      expect(valueWith(f, scenarioDrivers(research, scenario)).intrinsicValuePerShare).toBeCloseTo(valueWith(f, scenarioDrivers(d, scenario)).intrinsicValuePerShare!, 8);
    }
  });
  it("holds WACC and perpetual growth constant across business stresses", () => {
    expect(scenarioDrivers(d, "bear").wacc).toBe(d.wacc);
    expect(scenarioDrivers(d, "bull").terminalGrowth).toBe(d.terminalGrowth);
  });
  it("returns no single implied growth when value crosses the price on multiple branches", () => {
    const drivers = { ...d, salesToCapital: .1, reinvestmentMethod: "capital-efficiency" as const };
    expect(impliedGrowth(f, drivers, 20)).toBeNull();
  });
});

describe("DCF invalid assumptions", () => {
  it("does not assume a cash tax refund for operating losses", () => {
    const a = defaultDcfAssumptions(base, 1); a.operatingMargin = [-.2];
    expect(calculateDcf(base, a).projections[0].nopat).toBeCloseTo(-200 * (1 + a.revenueGrowth[0]), 8);
  });
  it("refuses invalid WACC under either terminal method and nonfinite growth", () => {
    for (const method of ["perpetual-growth", "exit-multiple"] as const) {
      const a = defaultDcfAssumptions(base, 1); a.terminalMethod = method; a.wacc = 0;
      expect(calculateDcf(base, a).intrinsicValuePerShare).toBeNull();
    }
    const a = defaultDcfAssumptions(base, 1); a.terminalGrowth = NaN;
    expect(calculateDcf(base, a).intrinsicValuePerShare).toBeNull();
  });
});
