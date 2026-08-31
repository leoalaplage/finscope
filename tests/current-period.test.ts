import { describe, expect, it } from "vitest";
import { companyStatistics } from "../lib/company-statistics";
import { currentPeriod } from "../lib/current-period";
import type { CompanyDataset, FinancialPeriod, MetricKey } from "../lib/types";

/*
 * Which period is "now".
 *
 * A trailing twelve months is preferred where it exists, and for JPMorgan it
 * exists only up to December 2014 — the quarterly concepts a bank files stop
 * lining up after that. Preferring it unconditionally dated the entire company
 * page to 2014: 95bn of revenue where the 2025 annual report states 182bn, a
 * decade-old margin on every row, and today's market capitalisation printed
 * beside them.
 */

const provenance = { provider: "SEC" as const, sourceUrl: "sec", retrievedAt: "now", concept: "Test", status: "reported" as const };

function period(end: string, periodicity: FinancialPeriod["periodicity"], facts: Partial<Record<MetricKey, number>>): FinancialPeriod {
  return {
    label: `${periodicity} ${end}`, fiscalYear: Number(end.slice(0, 4)), periodEnd: end, periodicity,
    filingDate: end, accession: `a-${end}`, currency: "USD",
    facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
      metric, value, currency: "USD", unit: metric.toLowerCase().includes("share") ? "shares" : "currency",
      periodEnd: end, periodicity, fiscalYear: Number(end.slice(0, 4)), provenance,
    }])) as FinancialPeriod["facts"],
  };
}

const dataset = (periods: FinancialPeriod[]): CompanyDataset => ({
  company: { name: "Test", ticker: "TEST", cik: "1", exchange: "NYSE", currency: "USD", sector: "T", description: "fixture" },
  periods, retrievedAt: "2026-08-31T00:00:00.000Z", warnings: [],
});

describe("the period a company's current figures come from", () => {
  it("prefers a trailing window that is actually more recent", () => {
    const ttm = period("2026-06-30", "ttm", { revenue: 200 });
    const annual = period("2025-12-31", "annual", { revenue: 180 });
    expect(currentPeriod([annual, ttm])).toBe(ttm);
  });

  it("falls back to the annual report when the trailing window stopped years ago", () => {
    const stale = period("2014-12-31", "ttm", { revenue: 95 });
    const annual = period("2025-12-31", "annual", { revenue: 182 });
    expect(currentPeriod([stale, annual])).toBe(annual);
    // And the statistics panel reads the year rather than the decade-old window.
    const profile = companyStatistics(dataset([stale, annual]), null).find((group) => group.title === "Profile")!;
    expect(profile.stats.find((stat) => stat.label === "Revenue")!.value).toBe(182);
  });

  it("keeps the trailing window when both end on the same day", () => {
    const ttm = period("2025-12-31", "ttm", { revenue: 100 });
    const annual = period("2025-12-31", "annual", { revenue: 100 });
    expect(currentPeriod([annual, ttm])).toBe(ttm);
  });
});
