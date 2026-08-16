import { describe, expect, it } from "vitest";
import { summariseDataset, summaryPeriod } from "../lib/watchlist-summary";
import { derivedValue } from "../lib/finance";
import type { CompanyDataset, FinancialPeriod, MetricKey } from "../lib/types";

const provenance = { provider: "SEC" as const, sourceUrl: "sec", retrievedAt: "now", concept: "Test", status: "reported" as const };

function period(periodicity: FinancialPeriod["periodicity"], periodEnd: string, facts: Partial<Record<MetricKey, number>>): FinancialPeriod {
  return {
    label: `${periodicity} ${periodEnd}`, fiscalYear: Number(periodEnd.slice(0, 4)), periodEnd, periodicity,
    filingDate: "2026-02-01", accession: "acc", currency: "USD",
    facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
      metric, value, currency: "USD", unit: "currency", periodEnd, periodicity, fiscalYear: Number(periodEnd.slice(0, 4)), provenance,
    }])) as FinancialPeriod["facts"],
  };
}

const dataset = (periods: FinancialPeriod[]): CompanyDataset => ({
  company: { ticker: "T", name: "Test Inc.", currency: "USD", exchange: "NYSE", cik: "1", sector: "Test", description: "", businessType: "domestic" } as CompanyDataset["company"],
  periods, retrievedAt: "now", warnings: [],
});

const flows = { revenue: 1_000, operatingCashFlow: 300, capitalExpenditures: 100, netIncome: 200 };
const balances = { totalDebt: 400, totalEquity: 600, cashAndEquivalents: 200, sharesOutstanding: 50 };

describe("the watchlist digest", () => {
  it("reads the trailing window when there is one, the last year otherwise", () => {
    const both = dataset([period("annual", "2025-12-31", flows), period("ttm", "2026-06-30", flows)]);
    expect(summaryPeriod(both)!.periodicity).toBe("ttm");
    const yearly = dataset([period("annual", "2025-12-31", flows)]);
    expect(summaryPeriod(yearly)!.periodicity).toBe("annual");
  });

  it("carries the same numbers the company page computes", () => {
    // The card and the page must never disagree, so the digest defers to the
    // same derivation rather than doing arithmetic of its own.
    const latest = period("ttm", "2026-06-30", { ...flows, ...balances });
    const summary = summariseDataset(dataset([latest]))!;
    expect(summary.freeCashFlowMargin).toBe(derivedValue(latest, "freeCashFlowMargin"));
    expect(summary.cashReturnOnCapital).toBe(derivedValue(latest, "cashReturnOnCapital"));
    expect(summary.revenue).toBe(derivedValue(latest, "revenue"));
    expect(summary.shares).toBe(derivedValue(latest, "sharesOutstanding"));
  });

  it("measures growth between two reported years, never against a trailing window", () => {
    const summary = summariseDataset(dataset([
      period("annual", "2024-12-31", { revenue: 800 }),
      period("annual", "2025-12-31", { revenue: 1_000 }),
      period("ttm", "2026-06-30", { revenue: 1_100 }),
    ]))!;
    expect(summary.revenueGrowth).toBeCloseTo(.25, 10);
  });

  it("leaves a figure unavailable rather than zero when the period lacks it", () => {
    const summary = summariseDataset(dataset([period("ttm", "2026-06-30", { revenue: 1_000 })]))!;
    expect(summary.freeCashFlowMargin).toBeNull();
    expect(summary.cashReturnOnCapital).toBeNull();
    expect(summary.revenueGrowth).toBeNull();
  });

  it("carries no market capitalisation, which needs a price the cache would stale", () => {
    const summary = summariseDataset(dataset([period("ttm", "2026-06-30", { ...flows, ...balances })]))!;
    expect(summary).not.toHaveProperty("marketCap");
    expect(summary.shares).toBe(50);
  });

  it("returns nothing for a company with no reported period", () => {
    expect(summariseDataset(dataset([]))).toBeNull();
  });

  it("stays small enough to send the whole watchlist at once", () => {
    // Twenty-one of these replace twenty-one six-megabyte datasets.
    const summary = summariseDataset(dataset([period("ttm", "2026-06-30", { ...flows, ...balances })]))!;
    expect(JSON.stringify(summary).length).toBeLessThan(400);
  });
});
