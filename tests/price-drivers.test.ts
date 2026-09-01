import { describe, expect, it } from "vitest";
import { priceDriverReading, priceDrivers } from "../lib/price-drivers";
import type { FinancialPeriod, MetricKey, PricePoint } from "../lib/types";

/*
 * The four cases from The Quality Growth Investor, chapter on valuation.
 *
 * A share price is free cash flow per share divided by the yield the market
 * accepts on it, so the book walks the same company through four years to show
 * that the identical price move can mean opposite things: cash per share
 * doubling, the multiple doubling, the two cancelling, or the two compounding.
 * Its own figures are used here as the fixture, so the split this module
 * reports is checked against the source it comes from.
 */

const provenance = { provider: "SEC" as const, sourceUrl: "sec", retrievedAt: "now", concept: "Test", status: "reported" as const };

/** A year whose free cash flow per share is `perShare`, on 100 shares. */
function year(end: string, filed: string, perShare: number, currency = "USD"): FinancialPeriod {
  const facts: Partial<Record<MetricKey, number>> = { revenue: 10_000, operatingCashFlow: perShare * 100, capitalExpenditures: 0, dilutedShares: 100 };
  return {
    label: `FY ${end.slice(0, 4)}`, fiscalYear: Number(end.slice(0, 4)), periodEnd: end, periodicity: "annual",
    filingDate: filed, accession: `a-${end}`, currency,
    facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
      metric, value, currency, unit: metric === "dilutedShares" ? "shares" : "currency",
      periodEnd: end, periodicity: "annual", fiscalYear: Number(end.slice(0, 4)), provenance,
    }])) as FinancialPeriod["facts"],
  };
}

const at = (date: string, close: number, currency = "USD"): PricePoint => ({
  close, priceClose: close, totalReturnClose: close, adjustedClose: close, date, requestedDate: date,
  currency, ticker: "TEST", type: "split-adjusted close", fallback: "exact date", distanceDays: 0, sourceUrl: "yahoo",
});

/**
 * Two years a year apart, priced at their own year ends.
 *
 * Not at their filing dates: a year restated by a later report carries that
 * report's date, so Apple's 2015 is dated November 2017 in this data and
 * pairing on it would divide a 2015 cash flow by a 2017 share price.
 */
function book(startPerShare: number, endPerShare: number, startPrice: number, endPrice: number) {
  const periods = [year("2024-12-31", "2025-02-01", startPerShare), year("2025-12-31", "2026-02-01", endPerShare)];
  return { periods, prices: { "2024-12-31": at("2024-12-31", startPrice), "2025-12-31": at("2025-12-31", endPrice) } };
}

describe("what moved the share price", () => {
  it("credits the business when cash per share doubles and the yield holds", () => {
    // $10 → $20 at a 5% yield: $200 → $400.
    const { periods, prices } = book(10, 20, 200, 400);
    const { drivers } = priceDrivers(periods, prices, 1);
    expect(drivers!.totalReturn).toBeCloseTo(1, 10);
    expect(drivers!.businessReturn).toBeCloseTo(1, 10);
    expect(drivers!.valuationReturn).toBeCloseTo(0, 10);
    expect(drivers!.start.yield).toBeCloseTo(.05, 10);
    expect(drivers!.end.yield).toBeCloseTo(.05, 10);
    expect(priceDriverReading(drivers!)).toContain("business");
  });

  it("shows a doubling of cash per share taken back by the multiple", () => {
    // The same growth, but the yield doubles to 10%: the price does not move.
    const { periods, prices } = book(10, 20, 200, 200);
    const { drivers } = priceDrivers(periods, prices, 1);
    expect(drivers!.totalReturn).toBeCloseTo(0, 10);
    expect(drivers!.businessReturn).toBeCloseTo(1, 10);
    expect(drivers!.valuationReturn).toBeCloseTo(-.5, 10);
  });

  it("names a rise that came from the multiple alone", () => {
    // Cash per share stands still while the yield halves to 2.5%: $200 → $400.
    const { periods, prices } = book(10, 10, 200, 400);
    const { drivers } = priceDrivers(periods, prices, 1);
    expect(drivers!.totalReturn).toBeCloseTo(1, 10);
    expect(drivers!.businessReturn).toBeCloseTo(0, 10);
    expect(drivers!.valuationReturn).toBeCloseTo(1, 10);
    // The book calls this a warning, and so does the reading.
    expect(priceDriverReading(drivers!)).toContain("next buyer");
  });

  it("compounds the two when both work in your favour", () => {
    // Cash per share doubles and the yield halves: $200 → $800, not $400.
    const { periods, prices } = book(10, 20, 200, 800);
    const { drivers } = priceDrivers(periods, prices, 1);
    expect(drivers!.totalReturn).toBeCloseTo(3, 10);
    expect(drivers!.businessReturn).toBeCloseTo(1, 10);
    expect(drivers!.valuationReturn).toBeCloseTo(1, 10);
    // The identity is exact, which is what makes the split a fact rather than
    // an attribution: (1 + total) = (1 + business) × (1 + valuation).
    expect(1 + drivers!.totalReturn).toBeCloseTo((1 + drivers!.businessReturn) * (1 + drivers!.valuationReturn), 10);
    expect(drivers!.share).toMatchObject({ business: .5, valuation: .5 });
  });

  it("refuses a price quoted in another currency", () => {
    const periods = [year("2024-12-31", "2025-02-01", 10, "EUR"), year("2025-12-31", "2026-02-01", 20, "EUR")];
    const result = priceDrivers(periods, { "2024-12-31": at("2024-12-31", 200), "2025-12-31": at("2025-12-31", 400) }, 1);
    expect(result.drivers).toBeNull();
    // Named for what it is, so a euro filer is not told it reports no cash flow.
    expect(result.reason).toContain("does not convert");
  });

  it("says how much history it actually has rather than reporting a shorter span as the answer", () => {
    const { periods, prices } = book(10, 20, 200, 400);
    const result = priceDrivers(periods, prices, 5);
    expect(result.drivers).toBeNull();
    expect(result.reason).toContain("longest available is 1.0");
  });
});
