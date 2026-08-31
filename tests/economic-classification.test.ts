import { describe, expect, it } from "vitest";
import { isFinancialBusiness, verifiedBusinessType } from "../lib/business-type";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { derivedValue } from "../lib/finance";
import type { CompanyProfile } from "../lib/types";

const END = "2025-12-31";
const flow = (value: number, concept = "Revenues") => ({
  units: { USD: [{ start: "2025-01-01", end: END, val: value, accn: "0001-26-000001", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-13" }] },
  label: concept, description: concept,
});
const point = (value: number, concept: string) => ({
  units: { USD: [{ end: END, val: value, accn: "0001-26-000001", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-13" }] },
  label: concept, description: concept,
});
const profile = (ticker: string, cik: string): CompanyProfile => ({
  name: ticker, ticker, cik, exchange: "NYSE", currency: "USD", sector: "Unclassified", description: "Test profile", businessType: "operating",
});
const payload = (extra: Record<string, unknown>) => ({ entityName: "Test filer", facts: { "us-gaap": { Revenues: flow(1_000), ...extra } } });

describe("verified economic classification", () => {
  it("classifies audited financial models by CIK, including dynamic SEC companies", () => {
    expect(verifiedBusinessType("19617")).toBe("bank");
    expect(verifiedBusinessType("1067983")).toBe("holding");
    expect(verifiedBusinessType("1156375")).toBe("exchange");
    expect(verifiedBusinessType("1381197")).toBe("broker");
    expect(verifiedBusinessType("320193")).toBeUndefined();
    expect(isFinancialBusiness("bank")).toBe(true);
    expect(isFinancialBusiness("operating")).toBe(false);
  });

  it("rebuilds JPMorgan borrowings from the two non-overlapping filed totals", () => {
    const dataset = normalizeSecPayload(payload({
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: point(435_206, "Long-term debt including current maturities"),
      ShortTermBorrowings: point(64_776, "Short-term borrowings"),
    }), "JPM", "2026-08-31T00:00:00.000Z", profile("JPM", "0000019617"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;
    expect(dataset.company.businessType).toBe("bank");
    expect(annual.facts.totalDebt?.value).toBe(499_982);
    expect(annual.facts.totalDebt?.provenance.formula).toContain("Short-term borrowings");
  });

  it("sums an exchange's long-term, short-term and finance-lease balances", () => {
    const dataset = normalizeSecPayload(payload({
      UnsecuredLongTermDebt: point(3_422.3, "Unsecured long-term debt"),
      ShortTermBorrowings: point(0, "Short-term borrowings"),
      FinanceLeaseLiability: point(46.3, "Finance lease liability"),
    }), "CME", "2026-08-31T00:00:00.000Z", profile("CME", "0001156375"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;
    expect(dataset.company.businessType).toBe("exchange");
    expect(annual.facts.totalDebt?.value).toBeCloseTo(3_468.6, 10);
  });

  it("does not call a lone long-term line total debt", () => {
    const dataset = normalizeSecPayload(payload({ LongTermDebt: point(1_491, "Long-term debt") }), "TEST", "2026-08-31T00:00:00.000Z", profile("TEST", "0000000001"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;
    expect(annual.facts.otherLongTermDebt?.value).toBe(1_491);
    expect(annual.facts.totalDebt).toBeUndefined();
  });

  it("recognizes Adobe's filed current-debt zero and restores its ROIC", () => {
    const dataset = normalizeSecPayload(payload({
      OperatingIncomeLoss: flow(8_706, "Operating income"),
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: flow(8_734, "Income before tax"),
      IncomeTaxExpenseBenefit: flow(1_604, "Income tax expense"),
      LongTermDebt: point(6_210, "Long-term debt"),
      DebtCurrent: point(0, "Current debt"),
      StockholdersEquity: point(11_623, "Stockholders' equity"),
      CashAndCashEquivalentsAtCarryingValue: point(5_431, "Cash and cash equivalents"),
    }), "ADBE", "2026-08-31T00:00:00.000Z", profile("ADBE", "0000796343"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(annual.facts.shortTermBorrowings?.value).toBe(0);
    expect(annual.facts.shortTermBorrowings?.provenance.concept).toBe("us-gaap:DebtCurrent");
    expect(annual.facts.totalDebt?.value).toBe(6_210);
    expect(annual.facts.totalDebt?.provenance.formula).toBe("Reported long-term debt + Short-term borrowings");
    expect(derivedValue(annual, "roic")).toBeCloseTo(.5731, 3);
  });

  it("prefers broad current debt to a narrower short-term borrowing line", () => {
    const dataset = normalizeSecPayload(payload({
      LongTermDebt: point(1_000, "Long-term debt"),
      DebtCurrent: point(100, "Current debt"),
      ShortTermBorrowings: point(60, "Short-term borrowings"),
    }), "TEST", "2026-08-31T00:00:00.000Z", profile("TEST", "0000000001"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(annual.facts.shortTermBorrowings?.value).toBe(100);
    expect(annual.facts.shortTermBorrowings?.provenance.concept).toBe("us-gaap:DebtCurrent");
    expect(annual.facts.totalDebt?.value).toBe(1_100);
  });
});
