import { describe, expect, it } from "vitest";
import { candlesForPeriods, closeOn, freeCashFlowYieldOn, periodsWithin } from "../lib/overview-market";
import { valuationSnapshot } from "../lib/valuation-history";
import type { FinancialPeriod, MarketBar, MetricKey, PricePoint } from "../lib/types";

const provenance = { provider: "SEC" as const, sourceUrl: "sec", retrievedAt: "now", concept: "Test", status: "reported" as const };

function period(facts: Partial<Record<MetricKey, number>>, periodEnd = "2025-12-31"): FinancialPeriod {
  return {
    label: "TTM", fiscalYear: 2025, periodEnd, periodicity: "ttm",
    filingDate: "2026-02-01", accession: "acc", currency: "USD",
    facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
      metric, value, currency: "USD", unit: "currency", periodEnd, periodicity: "ttm", fiscalYear: 2025, provenance,
    }])) as FinancialPeriod["facts"],
  };
}

function bar(date: string, periodStart: string, open: number, high: number, low: number, close: number): MarketBar {
  return { date, periodStart, open, high, low, close, adjustedClose: close, volume: null, currency: "USD", ticker: "T", frequency: "weekly", sourceUrl: "yahoo" };
}

describe("candles per reported period", () => {
  const bars = [
    bar("2025-01-31", "2025-01-01", 10, 12, 9, 11),
    bar("2025-02-28", "2025-02-01", 11, 15, 10, 14),
    bar("2025-03-31", "2025-03-01", 14, 16, 8, 9),
    bar("2025-04-30", "2025-04-01", 9, 20, 9, 19),
  ];

  it("opens on the first session of the window and closes on the last", () => {
    const [first, second] = candlesForPeriods([{ periodEnd: "2025-03-31" }, { periodEnd: "2025-04-30" }], bars);
    expect(first).toEqual({ open: 10, high: 16, low: 8, close: 9 });
    expect(second).toEqual({ open: 9, high: 20, low: 9, close: 19 });
  });

  it("takes a bar whose span reaches into the period, not only one that ends inside it", () => {
    // A fiscal quarter closing on a Saturday falls inside the week that
    // contains it. Comparing end dates alone would drop that week entirely.
    const [candle] = candlesForPeriods([{ periodEnd: "2025-03-29" }], bars);
    expect(candle?.close).toBe(9);
  });

  it("never lets the body escape the wick", () => {
    const [candle] = candlesForPeriods([{ periodEnd: "2025-01-31" }], [bar("2025-01-31", "2025-01-01", 40, 12, 9, 50)]);
    expect(candle!.high).toBeGreaterThanOrEqual(Math.max(candle!.open, candle!.close));
    expect(candle!.low).toBeLessThanOrEqual(Math.min(candle!.open, candle!.close));
  });

  it("returns nothing for a period with no sessions rather than a flat candle", () => {
    expect(candlesForPeriods([{ periodEnd: "2024-06-30" }], bars)).toEqual([null]);
  });

  it("gives the first period a quarter of history and no more", () => {
    // Nothing precedes the first period to bound it, so it takes 92 days: from
    // 30 April that reaches the week of 31 January and stops short of anything
    // older, which would stretch one candle across years of trading.
    const [candle] = candlesForPeriods([{ periodEnd: "2025-04-30" }], [bar("2024-06-28", "2024-06-24", 1, 2, 1, 2), ...bars]);
    expect(candle!.open).toBe(10);
    expect(candle!.low).toBe(8);
  });
});

describe("matching a close to a period end", () => {
  const bars = [bar("2025-12-26", "2025-12-22", 5, 6, 4, 5.5), bar("2026-01-02", "2025-12-29", 5.5, 7, 5, 6.5)];

  it("takes the last session on or before the date", () => {
    expect(closeOn(bars, "2025-12-31")).toBe(5.5);
  });

  it("never reaches forward to a session the date did not know about", () => {
    expect(closeOn(bars, "2025-12-20")).toBeNull();
  });

  it("refuses a price staler than the tolerance", () => {
    expect(closeOn(bars, "2026-06-30")).toBeNull();
  });
});

describe("free cash flow yield at a date", () => {
  const full = period({ operatingCashFlow: 300, capitalExpenditures: 100, sharesOutstanding: 1_000 });

  it("is free cash flow over what the company cost that day", () => {
    // 200 of free cash flow against 1,000 shares at $2 = 2,000 of market value.
    expect(freeCashFlowYieldOn(full, 2)).toBeCloseTo(.1, 10);
  });

  it("agrees with the valuation snapshot, which is the same definition", () => {
    const point = {
      close: 2, priceClose: 2, adjustedClose: 2, date: "2025-12-31", requestedDate: "2025-12-31",
      currency: "USD", ticker: "T", type: "split-adjusted close", fallback: "exact date", distanceDays: 0,
      sourceUrl: "yahoo", retrievedAt: "now",
    } as unknown as PricePoint;
    expect(freeCashFlowYieldOn(full, 2)).toBeCloseTo(valuationSnapshot(full, point)!.metrics.freeCashFlowYield!, 12);
  });

  it("is unavailable rather than negative when the year burned cash", () => {
    expect(freeCashFlowYieldOn(period({ operatingCashFlow: 50, capitalExpenditures: 200, sharesOutstanding: 1_000 }), 2)).toBeNull();
  });

  it("is unavailable without a price or a share count", () => {
    expect(freeCashFlowYieldOn(full, null)).toBeNull();
    expect(freeCashFlowYieldOn(period({ operatingCashFlow: 300, capitalExpenditures: 100 }), 2)).toBeNull();
  });
});

describe("how far back the cards reach", () => {
  const periods = ["2016-06-30", "2017-06-30", "2020-06-30", "2024-06-30", "2026-06-30"].map((periodEnd) => ({ periodEnd }));

  it("measures the window in years, not in periods", () => {
    // Four periods back is not four years back when the series has a hole.
    expect(periodsWithin(periods, 10).map((p) => p.periodEnd)).toEqual(["2016-06-30", "2017-06-30", "2020-06-30", "2024-06-30", "2026-06-30"]);
    expect(periodsWithin(periods, 7).map((p) => p.periodEnd)).toEqual(["2020-06-30", "2024-06-30", "2026-06-30"]);
  });

  it("returns everything for an unbounded window", () => {
    // A large finite sentinel is not unbounded: MAX_SAFE_INTEGER years before
    // 2026 is not a representable date, and the whole page went blank on it.
    expect(periodsWithin(periods, Infinity)).toHaveLength(5);
    expect(() => periodsWithin(periods, Number.MAX_SAFE_INTEGER)).not.toThrow();
    expect(periodsWithin(periods, Number.MAX_SAFE_INTEGER)).toHaveLength(5);
  });

  it("survives an empty series", () => {
    expect(periodsWithin([], 10)).toEqual([]);
  });
});
