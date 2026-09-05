import { describe, expect, it } from "vitest";
import { netDebt, reportedDebt } from "../lib/finance";
import type { FinancialPeriod, MetricKey } from "../lib/types";

/**
 * The borrowings behind an enterprise value.
 *
 * Copart's is the case this exists for: $2.7m of finance leases stated in the
 * annual note at 31 July 2025, nothing tagged on the quarterly balance sheet at
 * 30 April 2026 — and a company with $3.3bn of cash and no borrowings to speak
 * of had no enterprise value at all, while the Quality Score on the same page
 * ranked it on a net debt it had worked out for itself.
 */
const period = (
  label: string,
  end: string,
  periodicity: FinancialPeriod["periodicity"],
  values: Partial<Record<MetricKey, number>>,
): FinancialPeriod => ({
  label, fiscalYear: Number(end.slice(0, 4)), periodEnd: end, periodicity,
  filingDate: end, accession: `a-${end}`, currency: "USD",
  facts: Object.fromEntries(Object.entries(values).map(([metric, value]) => [metric, {
    metric: metric as MetricKey, value: value as number, currency: "USD", unit: "currency",
    periodEnd: end, periodicity, fiscalYear: Number(end.slice(0, 4)),
    provenance: { provider: "SEC", sourceUrl: "x", retrievedAt: "x", concept: metric, status: "reported" },
  }])) as FinancialPeriod["facts"],
});

const copart = () => {
  const annual = period("FY 2025", "2025-07-31", "annual", { totalDebt: 2_705_000, cashAndEquivalents: 2_780_531_000 });
  const trailing = period("TTM Q3 FY2026", "2026-04-30", "ttm", { cashAndEquivalents: 3_354_142_000 });
  return { annual, trailing, periods: [annual, trailing] };
};

describe("the borrowings an enterprise value is struck on", () => {
  it("uses the period's own balance where it states one", () => {
    const { annual, periods } = copart();
    expect(reportedDebt(periods, annual)).toEqual({ value: 2_705_000, label: "FY 2025", periodEnd: "2025-07-31", carried: false });
  });

  it("reads back to the last annual filing that states one, and says it did", () => {
    const { trailing, periods } = copart();
    const read = reportedDebt(periods, trailing)!;
    expect(read.value).toBe(2_705_000);
    expect(read.label).toBe("FY 2025");
    expect(read.carried).toBe(true);
    // The cash stays this period's: it is the balance that moves, and every
    // filing states it.
    expect(read.value - 3_354_142_000).toBeCloseTo(-3_351_437_000, 0);
  });

  it("never reads a balance filed after the period being valued", () => {
    const older = period("TTM Q1 FY2024", "2023-10-31", "ttm", { cashAndEquivalents: 1_000 });
    const { periods } = copart();
    expect(reportedDebt(periods, older)).toBeNull();
  });

  it("states nothing where no filing carries a borrowing balance at all", () => {
    const bare = period("FY 2025", "2025-12-31", "annual", { cashAndEquivalents: 500 });
    expect(reportedDebt([bare], bare)).toBeNull();
    // Which is the rule net debt has always held: an absent balance is not a
    // zero one, and this changes nothing about that.
    expect(netDebt(bare)).toBeNull();
  });
});
