import { describe, expect, it } from "vitest";
import { runDatasetInvariants } from "@/lib/accounting-invariants";
import { deriveBankRevenue, deriveLiabilities } from "@/lib/adapters/sec";
import { derivedValue, earningsToCommon, liquidAssets, netDebt } from "@/lib/finance";
import { companyView } from "@/lib/io/view";
import type { CompanyDataset, FinancialPeriod } from "@/lib/types";

/** A period from plain figures, each a filed fact unless told otherwise. */
function period(values: Record<string, number>, extra: Partial<FinancialPeriod> = {}, concepts: Record<string, string> = {}): FinancialPeriod {
  const facts = Object.fromEntries(Object.entries(values).map(([metric, value]) => [metric, {
    metric, value, currency: "USD", unit: metric.endsWith("Shares") ? "shares" : "currency", periodEnd: "2025-12-31", periodicity: "annual", fiscalYear: 2025,
    provenance: { provider: "SEC", sourceUrl: "", retrievedAt: "", status: "reported", concept: concepts[metric] ?? `us-gaap:${metric}`, accession: "a" },
  }]));
  return { label: "FY 2025", fiscalYear: 2025, periodStart: "2025-01-01", periodEnd: "2025-12-31", periodicity: "annual", filingDate: "2026-02-01", accession: "a", currency: "USD", durationDays: 365, facts, ...extra } as unknown as FinancialPeriod;
}

describe("net debt nets cash and short-term investments", () => {
  it("states Microsoft's June 2026 balance as net cash", () => {
    // 20.9bn cash, 55.9bn short-term investments, 40.3bn of borrowings.
    const msft = period({ cashAndEquivalents: 20_935e6, shortTermInvestments: 55_908e6, totalDebt: 40_294e6 });
    expect(liquidAssets(msft)).toBe(76_843e6);
    expect(netDebt(msft)).toBe(40_294e6 - 76_843e6);
    expect(derivedValue(msft, "netDebt")).toBeLessThan(0);
  });
  it("needs the cash balance, and takes the investments only where filed", () => {
    expect(netDebt(period({ totalDebt: 100, shortTermInvestments: 50 }))).toBeNull();
    expect(netDebt(period({ totalDebt: 100, cashAndEquivalents: 30 }))).toBe(70);
  });
});

describe("earnings per share on what belongs to the common shareholder", () => {
  it("strikes JPMorgan's on net income less preferred dividends, as it reports", () => {
    const jpm = period({ netIncome: 57_048e6, netIncomeToCommon: 55_681e6, dilutedShares: 2_781e6, dilutedEpsReported: 20.02 });
    expect(earningsToCommon(jpm)).toBe(55_681e6);
    expect(derivedValue(jpm, "netIncomePerShare")).toBeCloseTo(20.02, 2);
  });
  it("refuses a mis-dated line the filer's own EPS contradicts (Southwest, fourth quarter of 2021)", () => {
    const luv = period({ netIncome: 68e6, netIncomeToCommon: 977e6, dilutedShares: 606e6, dilutedEpsReported: 0.12 });
    expect(earningsToCommon(luv)).toBeNull();
    // And the guard holds for every reader: no fallback to the raw line it rejected.
    expect(derivedValue(luv, "netIncomeToCommon")).toBeNull();
    expect(derivedValue(luv, "netIncomePerShare")).toBeCloseTo(0.112, 3);
  });
  it("keeps a figure well away from net income where the reported EPS confirms it (General Motors 2024)", () => {
    const gm = period({ netIncome: 6_008e6, netIncomeToCommon: 7_010e6, dilutedShares: 1_101e6, dilutedEpsReported: 6.37 });
    expect(earningsToCommon(gm)).toBe(7_010e6);
  });
});

describe("liabilities where a filer states no total", () => {
  it("strikes McDonald's from the balance sheet's own totals, and says how", () => {
    const [mcd] = deriveLiabilities([period({ liabilitiesAndEquity: 59_515e6, totalEquity: -1_791e6, totalAssets: 59_515e6 })]);
    expect(mcd.facts.totalLiabilities?.value).toBe(61_306e6);
    expect(mcd.facts.totalLiabilities?.provenance.status).toBe("calculated");
    expect(mcd.facts.totalLiabilities?.provenance.note).toMatch(/no minority interest is tagged/);
  });
  it("takes minority interest and mezzanine equity out, and never overwrites a filed total", () => {
    const [spgi] = deriveLiabilities([period({ liabilitiesAndEquity: 61_200e6, totalEquity: 31_127e6, minorityInterest: 1_600e6, temporaryEquity: 3_425e6 })]);
    expect(spgi.facts.totalLiabilities?.value).toBe(61_200e6 - 31_127e6 - 1_600e6 - 3_425e6);
    const [filed] = deriveLiabilities([period({ liabilitiesAndEquity: 10, totalEquity: 4, totalLiabilities: 6 })]);
    expect(filed.facts.totalLiabilities?.provenance.status).toBe("reported");
  });
});

describe("a bank's revenue", () => {
  it("is net interest plus noninterest income where the bank's revenue line is only its fees (Regions 2021)", () => {
    const [rf] = deriveBankRevenue([period({ revenue: 104e6, netInterestIncome: 3_914e6, noninterestIncome: 2_524e6 }, {}, { revenue: "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax" })], "bank");
    expect(rf.facts.revenue?.value).toBe(6_438e6);
  });
  it("keeps a total the bank states itself", () => {
    const [bank] = deriveBankRevenue([period({ revenue: 6_400e6, netInterestIncome: 3_914e6, noninterestIncome: 2_524e6 }, {}, { revenue: "us-gaap:Revenues" })], "bank");
    expect(bank.facts.revenue?.value).toBe(6_400e6);
  });
});

describe("accounting identities", () => {
  const dataset = (values: Record<string, number>) => ({ company: { ticker: "TEST" }, periods: [period(values)] } as unknown as CompanyDataset);
  const balance = (values: Record<string, number>) => runDatasetInvariants(dataset(values)).find((result) => result.metric === "liabilitiesAndEquity")!;
  it("balances a balance sheet with mezzanine equity (S&P Global)", () => {
    expect(balance({ liabilitiesAndEquity: 61_200e6, totalLiabilities: 25_048e6, totalEquity: 31_127e6, minorityInterest: 1_600e6, temporaryEquity: 3_425e6 }).status).toBe("passed");
  });
  it("fails one that does not balance", () => {
    const result = balance({ liabilitiesAndEquity: 100e9, totalLiabilities: 40e9, totalEquity: 30e9 });
    expect(result.status).toBe("failed");
    expect(result.severity).toBe("error");
  });
});

describe("the page view says how each figure was arrived at", () => {
  it("marks a calculated figure with its formula and leaves a filed one plain", () => {
    const calculated = period({ revenue: 100, liabilitiesAndEquity: 50, totalEquity: 20 });
    const [withLiabilities] = deriveLiabilities([calculated]);
    const view = companyView({ company: { ticker: "T", name: "T", cik: "1", exchange: "", sector: "", currency: "USD", description: "" }, retrievedAt: "", periods: [withLiabilities], warnings: [] } as unknown as CompanyDataset);
    expect(view.annual[0].basis?.totalLiabilities).toMatch(/Liabilities and equity − shareholders' equity/);
    expect(view.annual[0].basis?.revenue).toBeUndefined();
  });
});
