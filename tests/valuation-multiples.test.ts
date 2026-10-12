import { describe, expect, it } from "vitest";
import { monthEnds, multipleSeries, multipleStats, multiplesAt } from "@/lib/io/valuation-multiples";
import type { IoPeriod } from "@/lib/io/view";

const period = (end: string, publishedAt: string, values: Record<string, number | null>, netDebt: number | null = 20, shares = 10): IoPeriod => ({
  label: `TTM ${end}`, end, start: null, fiscalYear: Number(end.slice(0, 4)), fiscalQuarter: null, filingDate: publishedAt, publishedAt,
  accession: "a", currency: "USD", values,
  valuationBasis: { shares, sharesBasis: "outstanding", sharesNote: null, netDebt, debtFrom: null },
} as IoPeriod);

describe("valuation multiples", () => {
  const p = period("2025-12-31", "2026-02-01", {
    netIncomeToCommon: 50, freeCashFlow: 40, ebitda: 80, operatingIncome: 60, revenue: 400, totalEquity: 200, goodwill: 50, intangibleAssets: 30, dividendsPaid: -10,
  });
  it("strikes each multiple from the price, the share count and the net debt", () => {
    const m = multiplesAt(p, 100)!; // cap 1000, EV 1020
    expect(m.pe).toBe(20);
    expect(m.pfcf).toBe(25);
    expect(m.evFcf).toBeCloseTo(25.5);
    expect(m.evEbitda).toBeCloseTo(12.75);
    expect(m.evEbit).toBeCloseTo(17);
    expect(m.ps).toBe(2.5);
    expect(m.pb).toBe(5);
    expect(m.ptb).toBeCloseTo(1000 / 120);
    expect(m.fcfYield).toBe(0.04);
    expect(m.dividendYield).toBe(0.01);
  });
  it("draws no multiple on a loss, and no EV multiple where net debt is withheld", () => {
    const loss = multiplesAt(period("2025-12-31", "2026-02-01", { netIncomeToCommon: -5, revenue: 100 }, null), 100)!;
    expect(loss.pe).toBeNull();
    expect(loss.earningsYield).toBeCloseTo(-0.005);
    expect(loss.evSales).toBeNull();
    expect(loss.ps).toBe(10);
  });
  it("prices each date on the figures public that day, never on later ones", () => {
    const older = period("2025-09-30", "2025-11-01", { netIncomeToCommon: 40 });
    const series = multipleSeries([p, older], [
      { date: "2025-12-31", price: 100, currency: "USD" },
      { date: "2026-02-28", price: 100, currency: "USD" },
      { date: "2025-06-30", price: 100, currency: "USD" },
    ]);
    expect(series.map((point) => [point.date, point.values.pe])).toEqual([["2025-12-31", 25], ["2026-02-28", 20]]);
  });
  it("places today in its own history", () => {
    const points = [10, 20, 30, 40, 50].map((pe, index) => ({ date: `2026-0${index + 1}-28`, periodLabel: "x", values: { pe } }));
    const stats = multipleStats(points, "pe");
    expect(stats).toMatchObject({ current: 50, median: 30, mean: 30, low: 10, high: 50, percentile: 1, count: 5 });
    expect(stats.deviation).toBeCloseTo(Math.sqrt(200));
  });
  it("lists the month-ends of the decade, at most 120", () => {
    const ends = monthEnds("2026-10-12");
    expect(ends).toHaveLength(120);
    expect(ends.at(-1)).toBe("2026-09-30");
    expect(ends[0]).toBe("2016-10-31");
  });
});
