import { describe, expect, it } from "vitest";
import {
  annualizedDilution, cagr, dilutionRate, freeCashFlow, margin,
  perShare, splitAdjustedShares, ttm, cagrForPeriods, derivedValue,
} from "../lib/finance";
import { APPLE_DATASET } from "../lib/demo-data";
import type { FinancialPeriod, MetricKey, NormalizedFact } from "../lib/types";

describe("financial calculations", () => {
  it("calculates free cash flow with positive or negative capex conventions", () => {
    expect(freeCashFlow(100, 25)).toBe(75);
    expect(freeCashFlow(100, -25)).toBe(75);
    expect(freeCashFlow(null, 25)).toBeNull();
  });

  it("calculates every margin and rejects zero revenue", () => {
    expect(margin(40, 100)).toBeCloseTo(.4);
    expect(margin(25, 100)).toBeCloseTo(.25);
    expect(margin(-10, 100)).toBeCloseTo(-.1);
    expect(margin(10, 0)).toBeNull();
  });

  it("calculates per-share values from diluted weighted average shares", () => {
    expect(perShare(1_000, 100)).toBe(10);
    expect(perShare(1_000, null)).toBeNull();
  });

  it("rejects incompatible per-share units or period contexts",()=>{const period:FinancialPeriod={label:"FY",fiscalYear:2025,periodEnd:"2025-12-31",periodicity:"annual",filingDate:"2026-02-01",accession:"x",currency:"USD",facts:{revenue:{metric:"revenue",value:100,currency:"USD",unit:"currency",periodEnd:"2025-12-31",periodicity:"annual",fiscalYear:2025,provenance:{provider:"SEC",sourceUrl:"x",retrievedAt:"x",concept:"revenue",status:"reported"}},dilutedShares:{metric:"dilutedShares",value:10,currency:"USD",unit:"shares",periodEnd:"2024-12-31",periodicity:"annual",fiscalYear:2025,provenance:{provider:"SEC",sourceUrl:"x",retrievedAt:"x",concept:"shares",status:"reported"}}}};expect(derivedValue(period,"revenuePerShare")).toBeNull();period.facts.dilutedShares!.periodEnd="2025-12-31";expect(derivedValue(period,"revenuePerShare")).toBe(10)});

  it("calculates dilution and annualized dilution", () => {
    expect(dilutionRate(110, 100)).toBeCloseTo(.1);
    expect(dilutionRate(90, 100)).toBeCloseTo(-.1);
    expect(annualizedDilution(121, 100, 2)).toBeCloseTo(.1);
  });

  it("calculates CAGR only for positive comparable endpoints", () => {
    expect(cagr(100, 121, 2)).toBeCloseTo(.1);
    expect(cagr(-100, 121, 2)).toBeNull();
    expect(cagr(100, 121, 0)).toBeNull();
  });

  it("sums exactly four complete quarters for TTM", () => {
    expect(ttm([10, 20, 30, 40])).toBe(100);
    expect(ttm([5, 10, 20, 30, 40])).toBe(100);
    expect(ttm([10, null, 30, 40])).toBeNull();
    expect(ttm([10, 20, 30])).toBeNull();
  });

  it("adjusts share counts for stock splits", () => {
    expect(splitAdjustedShares(100, 4)).toBe(400);
    expect(splitAdjustedShares(100, 0)).toBeNull();
  });
});

describe("data integrity and market-dependent calculations", () => {
  it("never presents a shorter or much longer span as exact 15Y/20Y CAGR",()=>{const periods=Array.from({length:12},(_,index)=>{const year=2014+index;return {label:`FY ${year}`,fiscalYear:year,periodEnd:`${year}-12-31`,periodicity:"annual" as const,filingDate:"",accession:"",currency:"USD",facts:{revenue:{metric:"revenue" as const,value:100*Math.pow(1.1,index),currency:"USD",unit:"currency" as const,periodEnd:`${year}-12-31`,periodicity:"annual" as const,fiscalYear:year,provenance:{provider:"SEC" as const,sourceUrl:"sec",retrievedAt:"now",concept:"Revenue",status:"reported" as const}}}}});const exact=cagrForPeriods(periods,"revenue",15);const maximum=cagrForPeriods(periods,"revenue","max");expect(exact.value).toBeNull();expect(exact.reason).toContain("maximum exact available");expect(maximum.value).toBeCloseTo(.1);expect(maximum.years).toBeCloseTo(11,1)});

  it("excludes confirmed-invalid CAGR endpoints",()=>{const make=(year:number,value:number):FinancialPeriod=>({label:"",fiscalYear:year,periodEnd:`${year}-12-31`,periodicity:"annual",filingDate:"",accession:"",currency:"USD",facts:{revenue:{metric:"revenue",value,currency:"USD",unit:"currency",periodEnd:`${year}-12-31`,periodicity:"annual",fiscalYear:year,provenance:{provider:"SEC",sourceUrl:"sec",retrievedAt:"now",concept:"Revenue",status:"reported"}}}});const periods=[make(2005,10),make(2010,20),make(2025,40)];periods[0].facts.revenue!.validation={status:"Confirmed invalid",checkedAt:"now"};expect(cagrForPeriods(periods,"revenue",20).value).toBeNull()});
  it("preserves missing periods instead of fabricating values", () => {
    const fiscal2016 = APPLE_DATASET.periods.find((period) => period.fiscalYear === 2016)!;
    expect(fiscal2016.facts.operatingCashFlow).toBeUndefined();
  });

  it("preserves regulatory lineage for reported and restated facts", () => {
    const revenue = APPLE_DATASET.periods.at(-1)!.facts.revenue!;
    expect(revenue.provenance.provider).toBe("SEC");
    expect(revenue.provenance.accession).toMatch(/^\d{10}-\d{2}-\d{6}$/);
    expect(["reported", "restated"]).toContain(revenue.provenance.status);
  });

});

describe("gross profit where the filer publishes no subtotal", () => {
  const fact = (metric: MetricKey, value: number): NormalizedFact => ({
    metric, value, currency: "USD", unit: "currency", periodStart: "2025-01-01", periodEnd: "2025-12-31",
    periodicity: "annual", fiscalYear: 2025,
    provenance: { provider: "SEC", sourceUrl: "sec", retrievedAt: "now", concept: "Test", status: "reported" },
  });
  const period = (facts: Partial<Record<MetricKey, NormalizedFact>>): FinancialPeriod => ({
    label: "FY2025", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodicity: "annual",
    fiscalYear: 2025, currency: "USD", filingDate: "2026-02-01", accession: "test",
    facts: facts as FinancialPeriod["facts"],
  });

  it("subtracts the cost of revenue from the revenue", () => {
    /*
     * Alphabet, Meta, Airbnb, Paychex, Zoetis and FactSet tag a cost of
     * revenue and no GrossProfit, so the overview drew an empty card for two
     * of the largest companies in the world while both inputs sat in the same
     * period.
     */
    const filed = period({ revenue: fact("revenue", 402_800), costOfRevenue: fact("costOfRevenue", 162_500) });
    expect(derivedValue(filed, "grossProfit")).toBe(240_300);
    expect(derivedValue(filed, "grossMargin")).toBeCloseTo(0.5966, 4);
  });

  it("prefers the filed subtotal over the subtraction", () => {
    // Verified against NVIDIA, which files all three: 215.9bn less 62.5bn is
    // the 153.5bn GrossProfit it reports. Where they ever disagreed, the
    // filed figure is the one with an accession number behind it.
    const both = period({
      revenue: fact("revenue", 215_900), costOfRevenue: fact("costOfRevenue", 62_500), grossProfit: fact("grossProfit", 153_460),
    });
    expect(derivedValue(both, "grossProfit")).toBe(153_460);
  });

  it("reads a cost filed as a negative the same way", () => {
    const negated = period({ revenue: fact("revenue", 1_000), costOfRevenue: fact("costOfRevenue", -400) });
    expect(derivedValue(negated, "grossProfit")).toBe(600);
  });

  it("stays unavailable where the filer reports no cost of revenue at all", () => {
    // Visa, Mastercard, Booking, S&P Global, CME, Interactive Brokers, MSCI
    // and MSCI present operating expenses by function with no cost-of-sales
    // line. There is nothing to subtract, and inventing a zero would state a
    // 100% gross margin as though it had been filed.
    const noCost = period({ revenue: fact("revenue", 1_000) });
    expect(derivedValue(noCost, "grossProfit")).toBeNull();
    expect(derivedValue(noCost, "grossMargin")).toBeNull();
  });

  it("carries the derived figure into gross profit per share", () => {
    const withShares = period({
      revenue: fact("revenue", 1_000), costOfRevenue: fact("costOfRevenue", 400),
      dilutedShares: { ...fact("dilutedShares", 100), unit: "shares" },
    });
    expect(derivedValue(withShares, "grossProfitPerShare")).toBe(6);
  });
});
