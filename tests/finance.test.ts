import { describe, expect, it } from "vitest";
import {
  annualizedDilution, cagr, convertUnit, dilutionRate, freeCashFlow, margin,
  perShare, splitAdjustedShares, ttm, valuationMetrics,
} from "../lib/finance";
import { APPLE_DATASET } from "../lib/demo-data";
import type { FinancialPeriod } from "../lib/types";

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

  it("converts units without changing the underlying value", () => {
    expect(convertUnit(1_000_000_000, "unit")).toBe(1_000_000_000);
    expect(convertUnit(1_000_000_000, "thousand")).toBe(1_000_000);
    expect(convertUnit(1_000_000_000, "million")).toBe(1_000);
    expect(convertUnit(1_000_000_000, "billion")).toBe(1);
  });

  it("adjusts share counts for stock splits", () => {
    expect(splitAdjustedShares(100, 4)).toBe(400);
    expect(splitAdjustedShares(100, 0)).toBeNull();
  });
});

describe("data integrity and market-dependent calculations", () => {
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

  it("matches valuation to an explicit price date and source", () => {
    const period: FinancialPeriod = {
      label: "FY 2025", fiscalYear: 2025, periodEnd: "2025-12-31", periodicity: "annual",
      filingDate: "2026-02-01", accession: "test", currency: "USD", facts: {
        revenue: { metric: "revenue", value: 1_000, currency: "USD", unit: "currency", periodEnd: "2025-12-31", periodicity: "annual", fiscalYear: 2025, provenance: { provider: "SEC", sourceUrl: "sec", retrievedAt: "now", concept: "Revenue", status: "reported" } },
        netIncome: { metric: "netIncome", value: 100, currency: "USD", unit: "currency", periodEnd: "2025-12-31", periodicity: "annual", fiscalYear: 2025, provenance: { provider: "SEC", sourceUrl: "sec", retrievedAt: "now", concept: "NetIncome", status: "reported" } },
        operatingCashFlow: { metric: "operatingCashFlow", value: 150, currency: "USD", unit: "currency", periodEnd: "2025-12-31", periodicity: "annual", fiscalYear: 2025, provenance: { provider: "SEC", sourceUrl: "sec", retrievedAt: "now", concept: "OCF", status: "reported" } },
        capitalExpenditures: { metric: "capitalExpenditures", value: 50, currency: "USD", unit: "currency", periodEnd: "2025-12-31", periodicity: "annual", fiscalYear: 2025, provenance: { provider: "SEC", sourceUrl: "sec", retrievedAt: "now", concept: "Capex", status: "reported" } },
        dilutedShares: { metric: "dilutedShares", value: 10, currency: "USD", unit: "shares", periodEnd: "2025-12-31", periodicity: "annual", fiscalYear: 2025, provenance: { provider: "SEC", sourceUrl: "sec", retrievedAt: "now", concept: "Shares", status: "reported" } },
      },
    };
    const result = valuationMetrics(period, { close: 20, date: "2025-12-31", currency: "USD", ticker: "TEST", type: "fiscal-period close", sourceUrl: "https://finance.yahoo.com" });
    expect(result?.marketCap).toBe(200);
    expect(result?.priceToSales).toBeCloseTo(.2);
    expect(result?.priceToEarnings).toBe(2);
    expect(result?.priceToFreeCashFlow).toBe(2);
    expect(result?.freeCashFlowYield).toBe(.5);
  });
});
