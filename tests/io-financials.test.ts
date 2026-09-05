import { describe, expect, it } from "vitest";
import { balanceSheetIsTheBusiness } from "../lib/business-type";
import { companyView } from "../lib/io/view";
import type { CompanyDataset, FinancialPeriod, MetricKey } from "../lib/types";

const period = (end: string, facts: Partial<Record<MetricKey, number>>): FinancialPeriod => ({
  label: `FY ${end.slice(0, 4)}`, fiscalYear: Number(end.slice(0, 4)),
  periodStart: `${Number(end.slice(0, 4)) - 1}-01-01`, periodEnd: end, periodicity: "annual",
  filingDate: end, accession: "0000019617-25-000001", currency: "USD",
  facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
    metric, value, currency: "USD", unit: "currency", periodEnd: end, periodicity: "annual",
    fiscalYear: Number(end.slice(0, 4)),
    provenance: { provider: "SEC" as const, sourceUrl: "x", retrievedAt: "2026-09-05T00:00:00.000Z", concept: metric, status: "reported" as const },
  }])) as FinancialPeriod["facts"],
});

const dataset = (businessType: CompanyDataset["company"]["businessType"]): CompanyDataset => ({
  company: {
    ticker: "TEST", name: "Test", cik: "0000019617", exchange: "NYSE", currency: "USD",
    sector: "Banking", description: "", resolutionStatus: "verified", businessType,
  },
  periods: [period("2025-12-31", {
    revenue: 200_000_000_000, netIncome: 60_000_000_000,
    operatingCashFlow: -160_000_000_000, capitalExpenditures: 2_000_000_000,
    totalDebt: 400_000_000_000, cashAndEquivalents: 180_000_000_000,
    totalAssets: 4_000_000_000_000, currentLiabilities: 100_000_000_000, totalEquity: 350_000_000_000,
    dilutedShares: 2_800_000_000, sharesOutstanding: 2_800_000_000,
  })],
  retrievedAt: "2026-09-05T00:00:00.000Z", warnings: [],
});

describe("measures a bank has no boundary for", () => {
  it("names the filers whose balance sheet is the business", () => {
    for (const type of ["bank", "broker", "insurer", "financial"] as const) {
      expect(balanceSheetIsTheBusiness(type)).toBe(true);
    }
    /*
     * An exchange earns fees, pays ordinary costs and buys ordinary equipment.
     * Its free cash flow is noisy — clearing margin moves through the same line
     * — and noisy is a thing to read carefully, not a thing to withhold.
     */
    for (const type of ["exchange", "holding", "operating"] as const) {
      expect(balanceSheetIsTheBusiness(type)).toBe(false);
    }
  });

  it("withholds them rather than computing an accident", () => {
    /*
     * The bug this exists for. The engine can compute all of these, and where a
     * filer happens to tag a capital expenditure it did: Bank of America
     * carried a free-cash-flow margin of 107% for 2009. A figure that appears
     * only when an unrelated concept happens to be tagged is not a measure.
     */
    const bank = companyView(dataset("bank"));
    const latest = bank.annual.at(-1)!;
    for (const key of ["freeCashFlow", "freeCashFlowMargin", "freeCashFlowPerShare", "roic", "cashReturnOnCapital", "netDebt", "operatingCashFlowMargin"]) {
      expect(latest.values[key]).toBeNull();
    }
    // No net debt means no enterprise value, which is the point.
    expect(bank.basis?.netDebt).toBeNull();
    expect(bank.withheldReason).toContain("raw material");
    // What the filer actually reported is untouched.
    expect(latest.values.revenue).toBe(200_000_000_000);
    expect(latest.values.operatingCashFlow).toBe(-160_000_000_000);
    expect(latest.values.netMargin).toBeCloseTo(0.3, 6);
  });

  it("leaves an operating company alone", () => {
    const operating = companyView(dataset("operating"));
    const latest = operating.annual.at(-1)!;
    expect(latest.values.freeCashFlow).toBe(-162_000_000_000);
    expect(operating.withheldReason).toBeNull();
  });
});
