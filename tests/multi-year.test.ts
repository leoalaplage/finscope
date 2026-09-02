import { describe, expect, it } from "vitest";
import { multiYearAverage } from "@/lib/multi-year";
import type { FinancialPeriod } from "@/lib/types";

function period(periodEnd: string, values: Record<string, number>): FinancialPeriod {
  const facts = Object.fromEntries(Object.entries(values).map(([metric, value]) => [metric, {
    metric, value, currency: "USD", unit: "currency", periodStart: `${periodEnd.slice(0, 4)}-01-01`, periodEnd,
    periodicity: "annual", fiscalYear: Number(periodEnd.slice(0, 4)),
    provenance: { provider: "SEC", sourceUrl: "sec", retrievedAt: "now", concept: "Test", status: "reported" },
  }]));
  return {
    label: `FY${periodEnd.slice(0, 4)}`, periodStart: `${periodEnd.slice(0, 4)}-01-01`, periodEnd,
    periodicity: "annual", fiscalYear: Number(periodEnd.slice(0, 4)), currency: "USD",
    filingDate: periodEnd, accession: "test", facts: facts as FinancialPeriod["facts"],
  };
}

describe("a margin measured over several years", () => {
  /*
   * The case that forced this: a start-up whose first year had almost no
   * revenue. The mean of the yearly margins is dominated by that year; the
   * aggregate is the margin the five years actually produced.
   */
  const startup = [
    period("2021-12-31", { revenue: 55, grossProfit: -465 }),
    period("2022-12-31", { revenue: 1658, grossProfit: -3123 }),
    period("2023-12-31", { revenue: 4434, grossProfit: -2030 }),
    period("2024-12-31", { revenue: 4974, grossProfit: -1202 }),
    period("2025-12-31", { revenue: 5800, grossProfit: 157 }),
  ];

  it("weights each year by the size it actually was", () => {
    const result = multiYearAverage(startup, "grossMargin");
    // −6663 of gross profit on 16,921 of revenue.
    expect(result.value).toBeCloseTo(-6663 / 16921, 6);
    expect(result.periods).toBe(5);
  });

  it("does not return the mean of the yearly ratios", () => {
    const mean = startup.reduce((sum, item) => sum + (item.facts.grossProfit!.value! / item.facts.revenue!.value!), 0) / 5;
    expect(mean).toBeLessThan(-1.5);
    expect(multiYearAverage(startup, "grossMargin").value).toBeGreaterThan(-1);
  });

  it("skips a year that reports only one half of the ratio", () => {
    const result = multiYearAverage([...startup, period("2026-12-31", { revenue: 7000 })], "grossMargin");
    expect(result.periods).toBe(5);
    expect(result.value).toBeCloseTo(-6663 / 16921, 6);
  });

  it("withholds a ratio whose base sums to nothing", () => {
    const lossmaker = [
      period("2024-12-31", { operatingCashFlow: 10, capitalExpenditures: 2, netIncome: -500 }),
      period("2025-12-31", { operatingCashFlow: 20, capitalExpenditures: 4, netIncome: -300 }),
    ];
    const result = multiYearAverage(lossmaker, "cashConversion");
    expect(result.value).toBeNull();
    expect(result.reason).toMatch(/sums to zero or less/);
  });

  it("keeps the ordinary mean for an amount", () => {
    const result = multiYearAverage(startup, "revenue");
    expect(result.value).toBeCloseTo(16921 / 5, 6);
  });

  it("says so when nothing reports the figure", () => {
    expect(multiYearAverage([], "grossMargin").value).toBeNull();
    expect(multiYearAverage([], "revenue").reason).toMatch(/No period/);
  });
});
