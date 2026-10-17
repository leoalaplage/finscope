import { describe, expect, it } from "vitest";
import { depreciationAndAmortizationFacts, normalizeSecPayload } from "../lib/adapters/sec";
import { companyView } from "../lib/io/view";
import type { RawFinancialFact } from "../lib/types";

const fact = (concept: string, value: number, overrides: Partial<RawFinancialFact> = {}): RawFinancialFact => ({
  metric: "depreciationAndAmortization", value, currency: "USD", unit: "currency",
  start: "2025-01-01", end: "2025-12-31", filed: "2026-02-01", accession: "same-filing",
  fiscalYear: 2025, fiscalPeriod: "FY", form: "10-K", concept: `us-gaap:${concept}`,
  sourceUrl: "https://www.sec.gov/Archives/", retrievedAt: "2026-10-17", ...overrides,
});

describe("D&A with separately disclosed intangible amortization", () => {
  it("adds only non-overlapping standard components and preserves their provenance", () => {
    const result = depreciationAndAmortizationFacts([fact("Depreciation", 574)], [fact("AmortizationOfIntangibleAssets", 8062)]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(8636);
    expect(result[0].summedFrom).toEqual(["us-gaap:Depreciation", "us-gaap:AmortizationOfIntangibleAssets"]);
    expect(result[0].normalizationNote).toContain("right-of-use amortization is not added");
  });

  it("retains a filed total, even when a component was repeated in a later filing", () => {
    const total = fact("DepreciationAndAmortization", 9000);
    const result = depreciationAndAmortizationFacts([total, fact("Depreciation", 574, { filed: "2026-05-01", accession: "later" })], [fact("AmortizationOfIntangibleAssets", 8062)]);
    expect(result).toEqual([total]);
  });

  it("does not add components to a reported accretion-bearing total or to residual D&A", () => {
    expect(depreciationAndAmortizationFacts([fact("DepreciationAmortizationAndAccretionNet", 9000)], [fact("AmortizationOfIntangibleAssets", 8062)])[0].value).toBe(9000);
    expect(depreciationAndAmortizationFacts([fact("OtherDepreciationAndAmortization", 600)], [fact("AmortizationOfIntangibleAssets", 8062)])[0].value).toBe(600);
    expect(depreciationAndAmortizationFacts([fact("Depreciation", 574)], [fact("OperatingLeaseRightOfUseAssetAmortizationExpense", 139)])[0].value).toBe(574);
  });

  it.each([
    { accession: "different-filing" }, { start: "2025-04-01" }, { end: "2025-09-30" }, { currency: "EUR" },
  ])("refuses components with different context %j", (overrides) => {
    const result = depreciationAndAmortizationFacts([fact("Depreciation", 574)], [fact("AmortizationOfIntangibleAssets", 8062, overrides)]);
    expect(result[0].value).toBe(574);
    expect(result[0].normalizationNote).toContain("Partial D&A");
  });

  it("rejects conflicting duplicate contexts instead of arbitrarily choosing a value", () => {
    const result = depreciationAndAmortizationFacts([fact("Depreciation", 574)], [fact("AmortizationOfIntangibleAssets", 8062), fact("AmortizationOfIntangibleAssets", 9000)]);
    expect(result[0].value).toBe(574);
    expect(result[0].normalizationNote).toContain("Partial D&A");
  });

  it("keeps explicit zero amortization distinct from missing amortization", () => {
    expect(depreciationAndAmortizationFacts([fact("Depreciation", 574)], [fact("AmortizationOfIntangibleAssets", 0)])[0].value).toBe(574);
    expect(depreciationAndAmortizationFacts([fact("Depreciation", 574)], [])[0].normalizationNote).toContain("Partial D&A");
  });
});

const profile = { ticker: "TEST", name: "Split D&A filer", cik: "0000000001", currency: "USD", exchange: "NASDAQ", sector: "", description: "", businessType: "operating" as const };
const windows = [
  { start: "2024-11-04", end: "2025-08-03", fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-09-01", accn: "q3-25", dep: 426, amort: 6010 },
  { start: "2024-11-04", end: "2025-11-02", fy: 2025, fp: "FY", form: "10-K", filed: "2025-12-18", accn: "fy-25", dep: 574, amort: 8062 },
  { start: "2025-11-03", end: "2026-02-01", fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-03-01", accn: "q1-26", dep: 150, amort: 1969 },
  { start: "2025-11-03", end: "2026-05-03", fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-06-01", accn: "q2-26", dep: 313, amort: 3936 },
  { start: "2025-11-03", end: "2026-08-02", fy: 2026, fp: "Q3", form: "10-Q", filed: "2026-09-10", accn: "q3-26", dep: 484, amort: 5942 },
];
const node = (key: "dep" | "amort") => ({ units: { USD: windows.map((window) => ({ ...window, val: window[key] * 1e6 })) } });

describe("split D&A through annual, quarter and TTM normalization", () => {
  it("carries independently reported tangible depreciation and intangible amortization without including ROU", () => {
    const payload = { entityName: profile.name, facts: { "us-gaap": {
      Depreciation: node("dep"), AmortizationOfIntangibleAssets: node("amort"),
      // The cash-flow adjustment includes lease amortization and must not be
      // used as a second intangible-asset expense on top of the P&L amount.
      OperatingLeaseRightOfUseAssetAmortizationExpense: { units: { USD: windows.map((window) => ({ ...window, val: 139e6 })) } },
    } } };
    const dataset = normalizeSecPayload(payload, "TEST", "2026-10-17", profile);
    const view = companyView(dataset);
    const annual = view.annual.find((period) => period.end === "2025-11-02")!;
    expect(annual.values.depreciationAndAmortization).toBe(8636e6);
    expect(annual.values.depreciation).toBe(574e6);
    expect(annual.values.intangibleAmortization).toBe(8062e6);
    expect(annual.basis?.depreciationAndAmortization).toContain("Combined D&A:");
    const quarter = view.quarterly.find((period) => period.end === "2026-08-02")!;
    expect(quarter.values.depreciationAndAmortization).toBe((171 + 2006) * 1e6);
    expect(quarter.values.intangibleAmortization).toBe(2006e6);
    const trailing = view.trailing.find((period) => period.end === "2026-08-02")!;
    expect(trailing.values.depreciationAndAmortization).toBe(8626e6);
    expect(trailing.values.depreciation).toBe(632e6);
    expect(trailing.values.intangibleAmortization).toBe(7994e6);
    expect(trailing.basis?.depreciationAndAmortization).toContain("Combined D&A:");
    // A different ticker gets exactly the same accounting normalization.
    expect(companyView(normalizeSecPayload(payload, "OTHER", "2026-10-17", { ...profile, ticker: "OTHER" })).annual.at(-1)?.values).toEqual(annual.values);
  });

  it("surfaces an unverified depreciation-only boundary in the company view", () => {
    const payload = { entityName: profile.name, facts: { "us-gaap": { Depreciation: node("dep") } } };
    const annual = companyView(normalizeSecPayload(payload, "TEST", "2026-10-17", profile)).annual.at(-1)!;
    expect(annual.values.intangibleAmortization).toBeNull();
    expect(annual.basis?.depreciationAndAmortization).toContain("Partial D&A:");
  });
});
