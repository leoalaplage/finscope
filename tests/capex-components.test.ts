import { describe, expect, it } from "vitest";
import { capexFromComponents } from "../lib/adapters/sec";
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
