import { describe, expect, it } from "vitest";
import { buildTtmPeriods, normalizeQuarterlyPeriods } from "../lib/periods";
import type { RawFinancialFact } from "../lib/types";

/**
 * Cboe's operating cash flow, as the SEC actually carries it.
 *
 * The filer reports cumulatively from 1 January, so three of its four quarters
 * are subtractions — and an exchange's operating cash flow swings through zero
 * whenever clearing members take margin back, so those subtractions come out
 * negative. Real figures, filed, and they sum to the year.
 */
const fact = (start: string, end: string, value: number, fp: RawFinancialFact["fiscalPeriod"], form: RawFinancialFact["form"]): RawFinancialFact => ({
  metric: "operatingCashFlow", value, currency: "USD", unit: "currency", start, end,
  filed: end, accession: `acc-${end}`, fiscalYear: Number(end.slice(0, 4)), fiscalPeriod: fp, form,
  concept: "us-gaap:NetCashProvidedByUsedInOperatingActivities",
  sourceUrl: "https://data.sec.gov/", retrievedAt: "2026-09-05T00:00:00.000Z",
});

const CBOE_2024: RawFinancialFact[] = [
  fact("2024-01-01", "2024-03-31", 896_000_000, "Q1", "10-Q"),
  fact("2024-01-01", "2024-06-30", 2_389_000_000, "Q2", "10-Q"),
  fact("2024-01-01", "2024-09-30", 1_811_000_000, "Q3", "10-Q"),
  fact("2024-01-01", "2024-12-31", 1_101_000_000, "FY", "10-K"),
];

describe("a quarter that was genuinely negative", () => {
  it("keeps it, and the four quarters add up to the filed year", () => {
    /*
     * The bug this exists for. Operating cash flow was listed among the
     * quantities that cannot be negative, so every quarter that came out below
     * nought was discarded as failed arithmetic. A trailing figure needs all
     * four quarters, so Cboe's free cash flow vanished from 2010 to 2026 —
     * sixteen years of a profitable business, with nothing on the page saying
     * why. Any company that burns cash in a quarter had the same hole.
     */
    const quarters = normalizeQuarterlyPeriods(CBOE_2024, "USD")
      .filter((period) => period.fiscalYear === 2024)
      .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd));
    const values = quarters.map((period) => period.facts.operatingCashFlow?.value ?? null);

    expect(values).toHaveLength(4);
    expect(values.every((value) => value != null)).toBe(true);
    expect(values[2]!).toBeLessThan(0);
    expect(values[3]!).toBeLessThan(0);
    // The point of keeping them: they reconstruct the year the filer published.
    const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    expect(total).toBeCloseTo(1_101_000_000, -3);
  });

  it("lets the trailing figure exist at all", () => {
    const quarters = normalizeQuarterlyPeriods(CBOE_2024, "USD");
    const trailing = buildTtmPeriods(quarters, "USD");
    const last = trailing.at(-1);
    expect(last?.facts.operatingCashFlow?.value).toBeCloseTo(1_101_000_000, -3);
  });
});
