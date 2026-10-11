import { describe, expect, it } from "vitest";
import { sameListing } from "@/lib/adapters/sec";
import { margin, returnOn } from "@/lib/finance";
import { plausibilityFindings } from "@/lib/io/plausibility";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { withholdImplausibleQuarters } from "@/lib/periods";
import type { FinancialPeriod } from "@/lib/types";

const ENDS = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];

function quarters(series: Record<string, number[]>): FinancialPeriod[] {
  return ENDS.map((end, index) => {
    const fiscalYear = Number(end.slice(0, 4));
    const fiscalQuarter = (["Q1", "Q2", "Q3", "Q4"] as const)[index % 4];
    const facts = Object.fromEntries(Object.entries(series).map(([metric, values]) => [metric, { metric, value: values[index], provenance: {} }]));
    return { label: `${fiscalQuarter} FY${fiscalYear}`, periodEnd: end, fiscalYear, fiscalQuarter, periodicity: "quarterly", facts } as unknown as FinancialPeriod;
  });
}

describe("implausible quarters", () => {
  it("withholds a fourth-quarter share count subtracted across a split", () => {
    const { periods, withheld } = withholdImplausibleQuarters(quarters({ dilutedShares: [13.6, 13.6, 13.5, 3.8, 13.4, 13.3, 13.2, 13.1, 13.0] }));
    expect(periods[3].facts.dilutedShares).toBeUndefined();
    expect(withheld).toEqual(["Q4 FY2024 dilutedShares"]);
    expect(periods[4].facts.dilutedShares?.value).toBe(13.4);
  });

  it("withholds a quarter of revenue a restatement broke, and keeps a seasonal one", () => {
    const broken = withholdImplausibleQuarters(quarters({ revenue: [5.0, 5.4, 5.3, 5.1, 5.2, 5.5, 5.3, 2.0, 5.4] }));
    expect(broken.withheld).toEqual(["Q4 FY2025 revenue"]);
    // Without a year-earlier quarter to witness it, the same figure is left alone.
    expect(withholdImplausibleQuarters(quarters({ revenue: [5.0, 5.4, 5.3, 2.0, 5.2, 5.5, 5.3, 5.6, 5.4] })).withheld).toEqual([]);
    // A tax-season quarter: far above its neighbours, but in line with a year earlier.
    const seasonal = withholdImplausibleQuarters(quarters({ revenue: [3.0, 1.2, 1.1, 1.3, 3.2, 1.3, 1.2, 1.4, 3.4] }));
    expect(seasonal.withheld).toEqual([]);
  });

  it("withholds a weighted count a thousand times its shares outstanding", () => {
    const { periods, withheld } = withholdImplausibleQuarters(quarters({
      dilutedShares: [59.6, 59.6, 59.7, 59.6, 59711, 59656, 59.6, 59.8, 59.7],
      sharesOutstanding: [59.4, 59.4, 59.5, 59.4, 59.5, 59.5, 59.5, 59.5, 59.6],
    }));
    expect(withheld).toEqual(["Q1 FY2025 dilutedShares", "Q2 FY2025 dilutedShares"]);
    expect(periods[6].facts.dilutedShares?.value).toBe(59.6);
  });

  it("leaves a lasting step alone: a merger moves the count and it stays moved", () => {
    const { withheld } = withholdImplausibleQuarters(quarters({ sharesOutstanding: [1, 1, 1, 3, 3, 3, 3, 3, 3] }));
    expect(withheld).toEqual([]);
  });
});

describe("returns and margins on a vanishing base", () => {
  it("states no return when the base is a sliver of the balance sheet", () => {
    // S&P Global, March 2018: 70m of equity against 8.5bn of assets.
    expect(returnOn(1.59e9, 0.07e9, 8.5e9)).toBeNull();
    expect(returnOn(5.14e9, 31.5e9, 62.9e9)).toBeCloseTo(0.163, 3);
    expect(returnOn(1, -2, 10)).toBeNull();
    expect(returnOn(1, 4, null)).toBe(0.25);
  });

  it("states no margin beyond five times revenue", () => {
    expect(margin(-470, 24)).toBeNull();
    expect(margin(30, 100)).toBe(0.3);
  });
});

describe("share-class punctuation", () => {
  it("reads BF-B and BF.B as one listing", () => {
    expect(sameListing("BF-B", "BF.B")).toBe(true);
    expect(sameListing("bf.b", "BF.B")).toBe(true);
    expect(sameListing("BF-A", "BF.B")).toBe(false);
  });
});

describe("plausibility findings", () => {
  const period = (label: string, end: string, values: Record<string, number | null>) =>
    ({ label, end, values } as unknown as IoPeriod);
  const view = (overrides: Partial<IoCompanyView>) => ({
    annual: [], quarterly: [], trailing: [], ttm: null, ...overrides,
  } as unknown as IoCompanyView);

  it("names a spike, a vanishing-base return and missing revenue", () => {
    const quarterly = [
      period("Q1 FY2025", "2025-03-31", { revenue: 10, dilutedShares: 100 }),
      period("Q2 FY2025", "2025-06-30", { revenue: 10, dilutedShares: 25 }),
      period("Q3 FY2025", "2025-09-30", { revenue: 11, dilutedShares: 101 }),
      period("Q4 FY2025", "2025-12-31", { revenue: null, dilutedShares: 102 }),
    ];
    const trailing = [period("TTM Q4 FY2025", "2025-12-31", { returnOnEquity: 24.4 })];
    const checks = plausibilityFindings(view({ quarterly, trailing, ttm: trailing[0] })).map((finding) => finding.check);
    expect(checks).toContain("spike");
    expect(checks).toContain("ratio");
    expect(checks).toContain("missing-revenue");
  });

  it("finds nothing in a company that makes sense", () => {
    const quarterly = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"].map((end, index) => period(`Q${index + 1} FY2025`, end, { revenue: 10 + index, dilutedShares: 100 }));
    const annual = [period("FY 2025", "2025-12-31", { revenue: 46, netIncome: 5, returnOnEquity: 0.2 })];
    const trailing = [period("TTM Q4 FY2025", "2025-12-31", { revenue: 46, netIncome: 5, returnOnEquity: 0.2 })];
    expect(plausibilityFindings(view({ quarterly, annual, trailing, ttm: trailing[0] }))).toEqual([]);
  });
});

describe("a balance under its preferred concept", () => {
  const fact = (concept: string, rank: number | undefined, value: number, filed: string) =>
    ({ metric: "totalEquity", value, concept, rank, filed, end: "2023-10-31" } as unknown as import("@/lib/types").RawFinancialFact);
  it("keeps stockholders' equity over a later-filed equity-including-minority line (Agilent 2023)", async () => {
    const { preferredInstant } = await import("@/lib/periods");
    const chosen = preferredInstant([
      fact("us-gaap:StockholdersEquity", 0, 5_845e6, "2024-12-20"),
      fact("us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", 1, -327e6, "2025-12-22"),
    ]);
    expect(chosen?.value).toBe(5_845e6);
  });
  it("still takes the latest filing within the preferred concept, and lets built figures compete", async () => {
    const { preferredInstant } = await import("@/lib/periods");
    expect(preferredInstant([fact("a", 0, 1, "2024-01-01"), fact("a", 0, 2, "2025-01-01")])?.value).toBe(2);
    expect(preferredInstant([fact("a", 0, 1, "2024-01-01"), fact("built", undefined, 3, "2025-01-01")])?.value).toBe(3);
  });
});
