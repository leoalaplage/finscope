import { describe, expect, it } from "vitest";
import { assumptionsFrom, dcfFoundation, defaultDrivers, impliedGrowth, justifiedBook, scenarioDrivers, sensitivityGrid, valueWith, weightedCost, type Drivers } from "@/lib/io/dcf-model";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";

const year = (fy: number, revenue: number, extra: Record<string, number> = {}): IoPeriod => ({
  label: `FY${fy}`, end: `${fy}-12-31`, start: null, fiscalYear: fy, fiscalQuarter: null, filingDate: `${fy + 1}-02-01`, publishedAt: `${fy + 1}-02-01`,
  accession: "a", currency: "USD", valuationBasis: null,
  values: {
    revenue, operatingIncome: revenue * 0.2, operatingMargin: 0.2, freeCashFlow: revenue * 0.15, dilutedShares: 100,
    cashAndEquivalents: 50, totalDebt: 100, effectiveTaxRate: 0.2, capitalExpenditures: -revenue * 0.05, depreciationAndAmortization: revenue * 0.04,
    netWorkingCapital: revenue * 0.1, interestExpense: 5, totalEquity: 400, returnOnEquity: 0.15, ...extra,
  },
} as IoPeriod);
const view = { annual: [2020, 2021, 2022, 2023, 2024, 2025].map((fy, i) => year(fy, 1000 * 1.1 ** i)), trailing: [], company: { businessType: "operating" } } as unknown as IoCompanyView;

describe("the DCF levers", () => {
  const foundation = dcfFoundation(view)!;
  it("reads the base and the record from the filings", () => {
    expect(foundation.base.revenue).toBeCloseTo(1610.51, 1);
    expect(foundation.startMargin).toBeCloseTo(0.2);
    expect(foundation.record.growth5).toBeCloseTo(0.1, 6);
    expect(foundation.record.capex5).toBeCloseTo(0.05);
    expect(foundation.record.costOfDebt).toBeCloseTo(0.05);
  });
  it("defaults to the company's own record", () => {
    const d = defaultDrivers(foundation, 0.09, 2000);
    expect(d.growthStart).toBeCloseTo(0.1, 6);
    expect(d.growthEnd).toBeLessThanOrEqual(d.growthStart);
    expect(d.marginTarget).toBeCloseTo(0.2);
    expect(d.taxRate).toBeCloseTo(0.2);
    // 2000 of equity at 9%, 100 of debt at 5% less 20% tax.
    expect(d.wacc).toBeCloseTo((2000 / 2100) * 0.09 + (100 / 2100) * 0.04, 6);
  });
  it("shapes growth in two stages and fades it to the terminal rate", () => {
    const d: Drivers = { ...defaultDrivers(foundation, 0.09, 2000), growthStart: 0.2, growthEnd: 0.1, terminalGrowth: 0.02, marginTarget: 0.3 };
    const a = assumptionsFrom(d, foundation);
    expect(a.revenueGrowth[0]).toBeCloseTo(0.2);
    expect(a.revenueGrowth[4]).toBeCloseTo(0.1);
    expect(a.revenueGrowth[9]).toBeCloseTo(0.02);
    expect(a.operatingMargin[4]).toBeCloseTo(0.3);
    expect(a.operatingMargin[0]).toBeCloseTo(0.22);
  });
  it("values the bull case above the base and the bear below", () => {
    const d = defaultDrivers(foundation, 0.09, 2000);
    const value = (s: "bear" | "base" | "bull") => valueWith(foundation, scenarioDrivers(d, s)).intrinsicValuePerShare!;
    expect(value("bull")).toBeGreaterThan(value("base"));
    expect(value("base")).toBeGreaterThan(value("bear"));
  });
  it("finds the growth the price asks for, and the value at it is the price", () => {
    const d = defaultDrivers(foundation, 0.09, 2000);
    const g = impliedGrowth(foundation, d, 30)!;
    expect(valueWith(foundation, { ...d, growthStart: g, growthEnd: g }).intrinsicValuePerShare!).toBeCloseTo(30, 3);
  });
  it("lays out a sensitivity grid that falls as the rate rises", () => {
    const d = defaultDrivers(foundation, 0.09, 2000);
    const grid = sensitivityGrid(foundation, d, { key: "wacc", values: [0.08, 0.1] }, { key: "terminalGrowth", values: [0.02, 0.03] });
    expect(grid[0][0]!).toBeGreaterThan(grid[1][0]!);
    expect(grid[0][1]!).toBeGreaterThan(grid[0][0]!);
  });
  it("weights the cost of capital at market values, and is the cost of equity without debt", () => {
    expect(weightedCost(0.1, 0.06, 0.25, 900, 100)).toBeCloseTo(0.9 * 0.1 + 0.1 * 0.045);
    expect(weightedCost(0.1, 0.06, 0.25, 900, 0)).toBe(0.1);
  });
});

describe("the lender's model", () => {
  it("prices book at (ROE − g) / (r − g)", () => {
    const j = justifiedBook(view, 0.10, 0.03)!;
    expect(j.multiple).toBeCloseTo((0.15 - 0.03) / (0.10 - 0.03));
    expect(j.value).toBeCloseTo(j.multiple * 4);
  });
});
