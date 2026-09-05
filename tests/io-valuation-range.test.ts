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

  it("keeps five- and ten-year windows separate and reports the observed range", () => {
    const make = (date: string, value: number) => ({
      date, filingDate: date, periodEnd: date, periodLabel: date,
      metrics: { enterpriseToFreeCashFlow: value, priceToFreeCashFlow: value, freeCashFlowYield: 1 / value },
    });
    const history = [make("2017-02-10", 10), make("2022-02-10", 20), make("2025-02-10", 30)];
    const five = historicalValuationRange(history, "priceToFreeCashFlow", 25, 5, "2026-09-05");
    const ten = historicalValuationRange(history, "priceToFreeCashFlow", 25, 10, "2026-09-05");
    expect(five).toMatchObject({ low: 20, high: 30, median: 25, observations: 2, percentile: .5 });
    expect(ten).toMatchObject({ low: 10, high: 30, median: 20, observations: 3 });
  });
});
