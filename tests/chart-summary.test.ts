import { describe, expect, it } from "vitest";
import { summariseSeries, summaryKindFor } from "../lib/chart-summary";

const series = (values: Array<number | null>, startYear = 2021) =>
  values.map((value, index) => ({ date: `${startYear + index}-12-31`, value }));

describe("which summary a measure deserves", () => {
  it("compounds a quantity and counts points for a rate", () => {
    expect(summaryKindFor("revenue")).toBe("cagr");
    expect(summaryKindFor("freeCashFlowPerShare")).toBe("cagr");
    expect(summaryKindFor("dilutedShares")).toBe("cagr");
    expect(summaryKindFor("operatingMargin")).toBe("points");
    expect(summaryKindFor("cashReturnOnCapital")).toBe("points");
    expect(summaryKindFor("debtToEquity")).toBe("points");
  });
});

describe("summarising the drawn series", () => {
  it("recovers the rate a quantity was built with", () => {
    const values = Array.from({ length: 5 }, (_, index) => 100 * 1.1 ** index);
    const summary = summariseSeries(series(values), "revenue");
    expect(summary.kind).toBe("cagr");
    expect(summary.value!).toBeCloseTo(.1, 3);
    expect(summary.display).toBe("+10.0%");
    expect(summary.label).toBe("4-year CAGR");
  });

  it("states a margin move in points, not as a growth rate", () => {
    const summary = summariseSeries(series([.2, .22, .25]), "operatingMargin");
    expect(summary.kind).toBe("points");
    // Twenty to twenty-five percent is five points. Quoting it as 7.7% a year
    // would be arithmetically true and completely uninformative.
    expect(summary.value!).toBeCloseTo(.05, 10);
    expect(summary.display).toBe("+5.0 pp");
  });

  it("signs a decline", () => {
    expect(summariseSeries(series([.25, .2]), "operatingMargin").display).toBe("-5.0 pp");
    expect(summariseSeries(series([100, 90]), "revenue").display).toBe("-10.0%");
  });

  it("measures only the window that is drawn", () => {
    // Three points span two years, so the badge must say two, not ten.
    expect(summariseSeries(series([100, 110, 121]), "revenue").label).toBe("2-year CAGR");
  });

  it("uses months when the drawn window is under a year", () => {
    const points = [{ date: "2025-01-31", value: 100 }, { date: "2025-07-31", value: 110 }];
    expect(summariseSeries(points, "revenue").label).toBe("6-month CAGR");
  });

  it("skips gaps rather than treating them as zero", () => {
    const summary = summariseSeries([
      { date: "2021-12-31", value: null },
      { date: "2022-12-31", value: 100 },
      { date: "2023-12-31", value: 110 },
      { date: "2024-12-31", value: null },
    ], "revenue");
    expect(summary.label).toBe("1-year CAGR");
    expect(summary.value!).toBeCloseTo(.1, 3);
  });

  it("defers to the shared CAGR rule on endpoints it will not compound", () => {
    const summary = summariseSeries(series([-50, 120]), "revenue");
    expect(summary.value).toBeNull();
    expect(summary.display).toBe("—");
    expect(summary.reason).toBeTruthy();
  });

  it("says nothing at all when there is nothing to compare", () => {
    expect(summariseSeries([{ date: "2025-12-31", value: 100 }], "revenue").display).toBe("—");
    expect(summariseSeries([], "revenue").display).toBe("—");
  });
});
