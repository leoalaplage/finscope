import { describe, expect, it } from "vitest";
import { currentPeriod } from "../lib/current-period";
import type { FinancialPeriod } from "../lib/types";

const period = (periodicity: FinancialPeriod["periodicity"], periodEnd: string): FinancialPeriod => ({
  label: `${periodicity} ${periodEnd}`, fiscalYear: Number(periodEnd.slice(0, 4)), periodEnd, periodicity,
  filingDate: periodEnd, accession: "a", currency: "USD", facts: {},
});

describe("the current period, against the company's own later quarters", () => {
  it("is not a trailing year the quarters have left a year behind, as a merger leaves its predecessor's", () => {
    // Paramount Skydance: its predecessor's last trailing year ends June 2025, its own quarters run to June 2026.
    expect(currentPeriod([period("annual", "2024-12-31"), period("ttm", "2025-06-30"), period("quarterly", "2026-03-31"), period("quarterly", "2026-06-30")])).toBeUndefined();
  });

  it("is still the last annual report three quarters into the next year", () => {
    const annual = period("annual", "2025-12-31");
    expect(currentPeriod([annual, period("quarterly", "2026-09-30")])).toBe(annual);
  });
});
