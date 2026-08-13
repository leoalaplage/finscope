import { describe, expect, it } from "vitest";
import { adjustPeriodsForSplits, buildTtmPeriods, normalizeQuarterlyPeriods } from "../lib/periods";
import type { MetricKey, RawFinancialFact } from "../lib/types";

function raw(metric: MetricKey, value: number, start: string | undefined, end: string, fiscalPeriod: RawFinancialFact["fiscalPeriod"], fiscalYear = 2025, filed = "2025-11-01"): RawFinancialFact {
  return { metric, value, start, end, fiscalPeriod, fiscalYear, filed, accession: `acc-${fiscalPeriod}-${filed}`, form: fiscalPeriod === "FY" ? "10-K" : "10-Q", concept: `us-gaap:${metric}`, currency: "USD", unit: metric.includes("Shares") || ["basicShares", "dilutedShares", "sharesOutstanding"].includes(metric) ? "shares" : "currency", sourceUrl: "https://sec.test/filing", retrievedAt: "2026-08-13" };
}

function standardYear(start = "2025-01-01", fiscalYear = 2025) {
  const dates = [
    [start, "2025-03-31", "Q1", 10],
    [start, "2025-06-30", "Q2", 25],
    [start, "2025-09-30", "Q3", 45],
    [start, "2025-12-31", "FY", 70],
  ] as const;
  const facts: RawFinancialFact[] = [];
  for (const metric of ["revenue", "operatingCashFlow", "capitalExpenditures"] as MetricKey[]) {
    for (const [periodStart, end, fp, value] of dates) facts.push(raw(metric, metric === "capitalExpenditures" ? value / 5 : value, periodStart, end, fp, fiscalYear));
  }
  for (const [quarterStart, end, fp, shares] of [
    ["2025-01-01", "2025-03-31", "Q1", 100], ["2025-04-01", "2025-06-30", "Q2", 101],
    ["2025-07-01", "2025-09-30", "Q3", 102], ["2025-10-01", "2025-12-31", "FY", 103],
  ] as const) facts.push(raw("dilutedShares", shares, quarterStart, end, fp, fiscalYear));
  return facts;
}

describe("quarterly SEC normalization", () => {
  it("isolates cumulative cash-flow and annual Q4 facts without dividing by four", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear(), "USD");
    expect(quarters.map((period) => period.facts.operatingCashFlow?.value)).toEqual([10, 15, 20, 25]);
    expect(quarters[1].facts.operatingCashFlow?.provenance.status).toBe("calculated");
    expect(quarters[1].facts.operatingCashFlow?.provenance.formula).toContain("cumulative through Q2");
    expect(quarters[3].fiscalQuarter).toBe("Q4");
  });

  it("selects the latest restated value for a duplicated context", () => {
    const facts = standardYear();
    facts.push(raw("revenue", 11, "2025-01-01", "2025-03-31", "Q1", 2025, "2025-11-15"));
    const quarter = normalizeQuarterlyPeriods(facts, "USD")[0];
    expect(quarter.facts.revenue?.value).toBe(11);
    expect(quarter.facts.revenue?.provenance.status).toBe("restated");
  });

  it("supports shifted fiscal years by using actual context dates", () => {
    const facts = standardYear("2024-10-01", 2025).map((fact) => {
      const ends = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30"];
      const position = ["Q1", "Q2", "Q3", "FY"].indexOf(fact.fiscalPeriod);
      return { ...fact, start: fact.fiscalPeriod === "Q1" || fact.start === "2025-01-01" ? "2024-10-01" : fact.start, end: ends[position] ?? fact.end };
    });
    const quarters = normalizeQuarterlyPeriods(facts, "USD");
    expect(quarters.at(-1)?.periodEnd).toBe("2025-09-30");
    expect(quarters.at(-1)?.fiscalYear).toBe(2025);
  });
});

describe("TTM construction", () => {
  it("sums four consecutive quarters and day-weights diluted shares", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear(), "USD");
    const ttm = buildTtmPeriods(quarters, "USD");
    expect(ttm).toHaveLength(1);
    expect(ttm[0].facts.revenue?.value).toBe(70);
    expect(ttm[0].ttmQuarterEnds).toEqual(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"]);
    expect(ttm[0].facts.dilutedShares?.value).toBeGreaterThan(101);
  });

  it("accepts a 53-week fiscal year", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear(), "USD");
    quarters[3].periodEnd = "2026-01-07";
    quarters[3].facts.revenue!.periodEnd = "2026-01-07";
    quarters[3].durationDays = 99;
    expect(buildTtmPeriods(quarters, "USD")).toHaveLength(1);
  });

  it("rejects a missing quarter, overlaps and insufficient data", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear(), "USD");
    expect(buildTtmPeriods(quarters.slice(0, 3), "USD")).toHaveLength(0);
    expect(buildTtmPeriods([quarters[0], quarters[1], quarters[1], quarters[3]], "USD")).toHaveLength(0);
    expect(buildTtmPeriods([quarters[0], quarters[1], quarters[3]], "USD")).toHaveLength(0);
  });

  it("rejects a window when a fiscal-year change creates a gap", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear(), "USD");
    quarters[2].periodStart = "2025-08-01";
    expect(buildTtmPeriods(quarters, "USD")).toHaveLength(0);
  });

  it("makes historical share counts comparable across subsequent stock splits", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear().map((fact)=>({...fact,filed:"2026-01-01"})), "USD");
    const adjusted = adjustPeriodsForSplits(quarters, [{ date: "2026-01-15", ratio: 4 }]);
    expect(adjusted[0].facts.dilutedShares?.value).toBe(400);
    expect(adjusted[0].facts.dilutedShares?.provenance.formula).toContain("4:1");
  });

  it("never split-adjusts currency facts and does not double-adjust later restatements", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear().map((fact)=>({...fact,filed:"2026-02-01"})), "USD");
    quarters[0].facts.cashAndEquivalents = { ...quarters[0].facts.revenue!, metric:"cashAndEquivalents", value:50, unit:"currency" };
    const adjusted = adjustPeriodsForSplits(quarters, [{ date:"2026-01-15", ratio:4 }]);
    expect(adjusted[0].facts.cashAndEquivalents?.value).toBe(50);
    expect(adjusted[0].facts.dilutedShares?.value).toBe(100);
  });
});
