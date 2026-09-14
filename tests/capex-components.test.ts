import { describe, expect, it } from "vitest";
import { capexFromComponents, capexFromOtherProductiveAssets, capexUnderEitherName } from "../lib/adapters/sec";
import type { RawFinancialFact } from "../lib/types";

const fact = (concept: string, value: number, start: string, end: string, accession: string, fiscalPeriod: RawFinancialFact["fiscalPeriod"] = "Q1"): RawFinancialFact => ({
  metric: "capitalExpenditures", value, currency: "USD", unit: "currency", start, end,
  filed: "2024-01-01", accession, fiscalYear: Number(end.slice(0, 4)), fiscalPeriod,
  form: fiscalPeriod === "FY" ? "10-K" : "10-Q", concept: `us-gaap:${concept}`, sourceUrl: "", retrievedAt: "",
});

describe("capital expenditure from its parts", () => {
  // Hims & Hers: the annual report tags the total and both parts; the quarters tag only the parts.
  const annual = [
    fact("PaymentsToAcquireProductiveAssets", 7.2e6, "2022-01-01", "2022-12-31", "10k-2022", "FY"),
    fact("PaymentsForSoftware", 4.5e6, "2022-01-01", "2022-12-31", "10k-2022", "FY"),
    fact("PaymentsToAcquireOtherProductiveAssets", 2.7e6, "2022-01-01", "2022-12-31", "10k-2022", "FY"),
  ];
  const quarter = [
    fact("PaymentsForSoftware", 1.9e6, "2023-01-01", "2023-03-31", "10q-2023q1"),
    fact("PaymentsToAcquireOtherProductiveAssets", 0.6e6, "2023-01-01", "2023-03-31", "10q-2023q1"),
  ];
  const split = (facts: RawFinancialFact[]) => [
    facts.filter((each) => /ProductiveAssets$|PropertyPlantAndEquipment$/.test(each.concept) && !/Other/.test(each.concept)),
    facts.filter((each) => !/PaymentsToAcquireProductiveAssets$/.test(each.concept)),
  ] as const;

  it("sums the parts of a period under the total the filer reconciles them to", () => {
    const [totals, parts] = split([...annual, ...quarter]);
    const summed = capexFromComponents(totals, parts);
    expect(summed).toHaveLength(1);
    expect(summed[0].concept).toBe("us-gaap:PaymentsToAcquireProductiveAssets");
    expect(summed[0].value).toBeCloseTo(2.5e6);
    expect(summed[0].end).toBe("2023-03-31");
    expect(summed[0].summedFrom).toEqual(["us-gaap:PaymentsForSoftware", "us-gaap:PaymentsToAcquireOtherProductiveAssets"]);
  });

  it("sums nothing for a filer that never shows its parts adding up to its total", () => {
    const unreconciled = annual.map((each) => each.concept.endsWith("PaymentsForSoftware") ? { ...each, value: 1e6 } : each);
    const [totals, parts] = split([...unreconciled, ...quarter]);
    expect(capexFromComponents(totals, parts)).toEqual([]);
  });

  it("never reads a missing part as zero", () => {
    const [totals, parts] = split([...annual, quarter[0]]);
    expect(capexFromComponents(totals, parts)).toEqual([]);
  });

  it("leaves a period that tags its own total alone", () => {
    const withTotal = [...quarter, fact("PaymentsToAcquireProductiveAssets", 2.5e6, "2023-01-01", "2023-03-31", "10q-2023q1")];
    const [totals, parts] = split([...annual, ...withTotal]);
    expect(capexFromComponents(totals, parts)).toEqual([]);
  });
});

describe("capital expenditure under another name", () => {
  const ppe = (value: number, start: string, end: string, accession = "a") => fact("PaymentsToAcquirePropertyPlantAndEquipment", value, start, end, accession);
  const productive = (value: number, start: string, end: string, accession = "b") => fact("PaymentsToAcquireProductiveAssets", value, start, end, accession, "FY");

  it("reads a year's quarters under the name of the year's own figure, where the filer shows the two agree", () => {
    // Arista: both names at one figure in 2019; in 2025 the quarters under one name, the year under the other.
    const facts = [ppe(1.7e7, "2019-01-01", "2019-12-31"), productive(1.7e7, "2019-01-01", "2019-12-31"), ppe(2.8e7, "2025-01-01", "2025-03-31"), productive(1.2e8, "2025-01-01", "2025-12-31")];
    const copies = capexUnderEitherName(facts);
    expect(copies.map((each) => `${each.concept.replace("us-gaap:", "")} ${each.end}`)).toEqual(["PaymentsToAcquireProductiveAssets 2025-03-31"]);
    expect(copies[0].summedFrom).toEqual(["us-gaap:PaymentsToAcquirePropertyPlantAndEquipment"]);
  });

  it("copies nothing into a year that already has its own figures under its own name", () => {
    // Fortive: complete years under both names, older quarters under one.
    const facts = [ppe(8.6e7, "2024-01-01", "2024-12-31"), productive(8.6e7, "2024-01-01", "2024-12-31"), ppe(2e7, "2024-01-01", "2024-03-31")];
    expect(capexUnderEitherName(facts)).toEqual([]);
  });

  it("copies nothing when the two names disagree, or were never tagged together", () => {
    expect(capexUnderEitherName([ppe(1e7, "2019-01-01", "2019-12-31"), productive(1.3e7, "2019-01-01", "2019-12-31"), ppe(2e6, "2025-01-01", "2025-03-31")])).toEqual([]);
    expect(capexUnderEitherName([ppe(2e6, "2025-01-01", "2025-03-31"), productive(9e6, "2025-01-01", "2025-12-31")])).toEqual([]);
  });

  it("reads other productive assets only where it is the filer's sole capital expenditure", () => {
    const other = (value: number, start: string, end: string) => fact("PaymentsToAcquireOtherProductiveAssets", value, start, end, "v");
    // Verizon: a part of a wider total in 2010, the whole of it from 2011 on.
    const early = other(5.96e9, "2010-01-01", "2010-12-31");
    const verizon = [early, other(4.1e9, "2025-01-01", "2025-03-31"), other(1.7e10, "2025-01-01", "2025-12-31")];
    expect(capexFromOtherProductiveAssets([productive(1.7e10, "2010-01-01", "2010-12-31")], verizon)).toEqual(verizon.slice(1));
    expect(capexFromOtherProductiveAssets([], verizon.slice(1))).toEqual(verizon.slice(1));
    // Delta: tagged beside its productive-assets total, so it is a part of it.
    const delta = [other(9.78e8, "2025-01-01", "2025-12-31"), other(4.14e8, "2026-01-01", "2026-06-30")];
    expect(capexFromOtherProductiveAssets([productive(4.499e9, "2025-01-01", "2025-12-31")], delta)).toEqual([]);
  });
});
