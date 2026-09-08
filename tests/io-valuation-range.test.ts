import { describe, expect, it } from "vitest";
import { historicalValuationPoint, historicalValuationRange } from "../lib/io/valuation-range";
import type { IoPeriod } from "../lib/io/view";

const period = (over: Partial<IoPeriod> = {}): IoPeriod => ({
  label: "TTM Q4 2025",
  end: "2025-12-31",
  start: "2025-01-01",
  fiscalYear: 2025,
  fiscalQuarter: "Q4",
  filingDate: "2026-02-10",
  publishedAt: "2026-02-10",
  accession: "x",
  currency: "USD",
  values: { freeCashFlow: 100 },
  valuationBasis: {
    shares: 10,
    sharesBasis: "outstanding",
    sharesNote: null,
    netDebt: 50,
    debtFrom: null,
  },
  ...over,
});

describe("historical valuation ranges", () => {
  it("prices each period on its own filed share and net-debt basis", () => {
    const point = historicalValuationPoint(period(), { price: 20, date: "2026-02-10", currency: "USD" })!;
    expect(point.metrics.priceToFreeCashFlow).toBe(2);
    expect(point.metrics.enterpriseToFreeCashFlow).toBe(2.5);
    expect(point.metrics.freeCashFlowYield).toBe(.5);
  });

  it("withholds a currency mismatch and an enterprise multiple without net debt", () => {
    expect(historicalValuationPoint(period(), { price: 20, date: "2026-02-10", currency: "EUR" })).toBeNull();
    const withoutDebt = period({ valuationBasis: { ...period().valuationBasis!, netDebt: null } });
    const point = historicalValuationPoint(withoutDebt, { price: 20, date: "2026-02-10", currency: "USD" })!;
    expect(point.metrics.enterpriseToFreeCashFlow).toBeNull();
    expect(point.metrics.priceToFreeCashFlow).toBe(2);
  });

  it("states a negative capital return rather than withholding it", () => {
    /*
     * A multiple struck on negative earnings is meaningless, so every ratio
     * here refuses one. Cash returned is not a multiple: Palantir bought back
     * nothing and issued $43.7m, so it returned less than nothing, and that is
     * the reading a reader came for. Only the price has to be positive.
     */
    const point = historicalValuationPoint(
      period({ values: { freeCashFlow: 1_000, dividendsPaid: null, netShareRepurchases: -200 } }),
      { price: 10, date: "2026-02-12", currency: "USD" },
    )!;
    expect(point.metrics.buybackYield).toBeCloseTo(-200 / 100, 10);
    expect(point.metrics.shareholderYield).toBeCloseTo(-200 / 100, 10);
    // Nothing paid and nothing bought back is not a nought per cent yield.
    expect(point.metrics.dividendYield).toBeNull();
  });

  it("adds a dividend to a buyback without inventing either", () => {
    const both = historicalValuationPoint(
      period({ values: { dividendsPaid: 300, netShareRepurchases: 200 } }),
      { price: 10, date: "2026-02-12", currency: "USD" },
    )!;
    expect(both.metrics.shareholderYield).toBeCloseTo(500 / 100, 10);
    const neither = historicalValuationPoint(
      period({ values: { dividendsPaid: null, netShareRepurchases: null } }),
      { price: 10, date: "2026-02-12", currency: "USD" },
    )!;
    expect(neither.metrics.shareholderYield).toBeNull();
  });

  it("keeps five- and ten-year windows separate and reports the observed range", () => {
    const make = (date: string, value: number) => ({
      date, publishedAt: date, periodEnd: date, periodLabel: date,
      metrics: {
        enterpriseToFreeCashFlow: value, priceToFreeCashFlow: value, freeCashFlowYield: 1 / value,
        dividendYield: null, buybackYield: null, shareholderYield: null,
      },
    });
    const history = [make("2017-02-10", 10), make("2022-02-10", 20), make("2025-02-10", 30)];
    const five = historicalValuationRange(history, "priceToFreeCashFlow", 25, 5, "2026-09-05");
    const ten = historicalValuationRange(history, "priceToFreeCashFlow", 25, 10, "2026-09-05");
    expect(five).toMatchObject({ low: 20, high: 30, median: 25, observations: 2, percentile: .5 });
    expect(ten).toMatchObject({ low: 10, high: 30, median: 20, observations: 3 });
  });
});
