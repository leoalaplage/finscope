import { describe, expect, it } from "vitest";
import { fcfShareGrowthProfile } from "../lib/io/fcf-share-growth";
import type { IoPeriod } from "../lib/io/view";

const year = (value: number | null, fiscalYear: number): IoPeriod => ({
  label: `FY${fiscalYear}`,
  end: `${fiscalYear}-12-31`,
  start: `${fiscalYear}-01-01`,
  fiscalYear,
  fiscalQuarter: "FY",
  filingDate: `${fiscalYear + 1}-02-01`,
  accession: String(fiscalYear),
  currency: "USD",
  values: { freeCashFlowPerShare: value },
  valuationBasis: null,
});

describe("FCF per-share growth profile", () => {
  it("computes 5Y and 10Y CAGR and a perfect R² for steady compounding", () => {
    const periods = Array.from({ length: 11 }, (_, index) => year(2 * 1.1 ** index, 2015 + index));
    const result = fcfShareGrowthProfile(periods);
    expect(result.fiveYearCagr.value).toBeCloseTo(.1, 3);
    expect(result.tenYearCagr.value).toBeCloseTo(.1, 3);
    expect(result.tenYearRSquared.value).toBeCloseTo(1, 6);
    expect(result.tenYearRSquared.observations).toBe(11);
  });

  it("shows a lower R² when the same long-term path is lumpy", () => {
    const smooth = Array.from({ length: 11 }, (_, index) => year(2 * 1.1 ** index, 2015 + index));
    const lumpy = smooth.map((period, index) => year((period.values.freeCashFlowPerShare ?? 0) * (index % 2 ? 1.7 : .65), period.fiscalYear));
    expect(fcfShareGrowthProfile(lumpy).tenYearRSquared.value).toBeLessThan(.5);
  });

  it("refuses CAGR and R² when a required value is non-positive", () => {
    const periods = Array.from({ length: 11 }, (_, index) => year(index === 5 ? -1 : index + 1, 2015 + index));
    const result = fcfShareGrowthProfile(periods);
    expect(result.fiveYearCagr.value).toBeNull();
    expect(result.tenYearRSquared.value).toBeNull();
  });
});
