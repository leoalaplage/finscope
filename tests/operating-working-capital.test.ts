import { describe, expect, it } from "vitest";
import { derivedValue, operatingWorkingCapitalReading } from "../lib/finance";
import { companyView } from "../lib/io/view";
import type { CompanyDataset, FinancialPeriod, MetricKey, NormalizedFact } from "../lib/types";

function period(values: Partial<Record<MetricKey, number>>): FinancialPeriod {
  return {
    label: "FY2025", fiscalYear: 2025, periodEnd: "2025-12-31", periodicity: "annual",
    filingDate: "2026-02-01", accession: "test", currency: "USD",
    facts: Object.fromEntries(Object.entries(values).map(([metric, value]) => [metric, {
      metric, value, currency: "USD", unit: "currency", periodEnd: "2025-12-31", periodicity: "annual", fiscalYear: 2025,
      provenance: { provider: "SEC", sourceUrl: "https://www.sec.gov/test", retrievedAt: "2026-02-01", concept: metric, status: "reported" },
    }])) as Partial<Record<MetricKey, NormalizedFact>>,
  };
}

const balances = {
  currentAssets: 1_000, cashAndEquivalents: 200, shortTermInvestments: 100,
  currentLiabilities: 600, longTermDebtCurrent: 120, shortTermBorrowings: 30,
  financeLeaseLiabilityCurrent: 10,
};

function dataset(filed: FinancialPeriod, businessType: "operating" | "bank" = "operating"): CompanyDataset {
  return {
    company: { ticker: "TEST", name: "Test", cik: "1", exchange: "NASDAQ", currency: "USD", sector: "Technology", description: "", businessType },
    periods: [filed], warnings: [], retrievedAt: "2026-02-01",
  };
}

describe("operating working capital for unlevered cash flows", () => {
  it("excludes liquidity and current financing while preserving legacy NWC", () => {
    const filed = period(balances);
    expect(operatingWorkingCapitalReading(filed)).toMatchObject({ value: 260, currentDebt: 160, complete: true, issues: [] });
    expect(derivedValue(filed, "operatingWorkingCapital")).toBe(260);
    expect(derivedValue(filed, "netWorkingCapital")).toBe(200);
  });

  it("never adds a short-term component twice when current debt is a broad total", () => {
    const filed = period({ ...balances, longTermDebtCurrent: 150 });
    filed.facts.longTermDebtCurrent!.provenance.concept = "us-gaap:DebtCurrent";
    expect(operatingWorkingCapitalReading(filed)).toMatchObject({ value: 260, currentDebt: 160 });
  });

  it("does not add current maturities to the IFRS broad current-borrowings total", () => {
    const filed = period({ ...balances, shortTermBorrowings: 150 });
    filed.facts.shortTermBorrowings!.provenance.concept = "ifrs-full:CurrentBorrowings";
    expect(operatingWorkingCapitalReading(filed)).toMatchObject({ value: 260, currentDebt: 160 });
  });

  it("does not double-count finance leases inside a combined debt-and-lease line", () => {
    const filed = period({ ...balances, longTermDebtCurrent: 130 });
    filed.facts.longTermDebtCurrent!.provenance.concept = "us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent";
    expect(operatingWorkingCapitalReading(filed)).toMatchObject({ value: 260, currentDebt: 160 });
  });

  it("distinguishes absent adjustments from a reported zero, with explicit incomplete coverage", () => {
    const filed = period({ currentAssets: 1_000, cashAndEquivalents: 200, currentLiabilities: 600 });
    const absent = operatingWorkingCapitalReading(filed);
    expect(absent).toMatchObject({ value: 200, currentDebt: null, shortTermInvestments: null, complete: false });
    expect(absent.issues.join(" ")).toContain("not separately available");
    const zeros = period({ currentAssets: 1_000, cashAndEquivalents: 200, currentLiabilities: 600, totalDebt: 0, shortTermInvestments: 0 });
    expect(operatingWorkingCapitalReading(zeros)).toMatchObject({ value: 200, currentDebt: 0, shortTermInvestments: 0, complete: true, issues: [] });
  });

  it("requires all core aggregates instead of filling missing current liabilities with zero", () => {
    const filed = period(balances);
    delete filed.facts.currentLiabilities;
    expect(operatingWorkingCapitalReading(filed).value).toBeNull();
  });

  it.each(["periodEnd", "currency", "unit", "value", "validation"] as const)("rejects incompatible or invalid observed adjustments (%s)", (field) => {
    const filed = period(balances);
    const investment = filed.facts.shortTermInvestments!;
    if (field === "periodEnd") investment.periodEnd = "2024-12-31";
    if (field === "currency") investment.currency = "EUR";
    if (field === "unit") investment.unit = "shares";
    if (field === "value") investment.value = Number.NaN;
    if (field === "validation") investment.validation = { status: "Confirmed invalid", checkedAt: "2026-02-01" };
    expect(operatingWorkingCapitalReading(filed).value).toBeNull();
  });

  it("allows negative operating working capital but rejects impossible aggregate mappings", () => {
    expect(operatingWorkingCapitalReading(period({ ...balances, currentLiabilities: 1_000 })).value).toBe(-140);
    expect(operatingWorkingCapitalReading(period({ ...balances, currentAssets: 250 })).value).toBeNull();
    expect(operatingWorkingCapitalReading(period({ ...balances, currentLiabilities: 100 })).value).toBeNull();
  });

  it("projects the value, formula and coverage into the company view", () => {
    const view = companyView(dataset(period(balances)));
    expect(view.annual[0].values.operatingWorkingCapital).toBe(260);
    expect(view.annual[0].operatingWorkingCapitalBasis).toMatchObject({ currentDebt: 160, complete: true });
    expect(view.annual[0].basis?.operatingWorkingCapital).toContain("may retain taxes");
    expect(view.metrics.find((metric) => metric.key === "operatingWorkingCapital")?.formula).toContain("Short-term investments");
  });

  it("withholds the operating-company proxy from banks", () => {
    const view = companyView(dataset(period(balances), "bank"));
    expect(view.annual[0].values.operatingWorkingCapital).toBeNull();
    expect(view.annual[0].operatingWorkingCapitalBasis).toBeUndefined();
  });
});
