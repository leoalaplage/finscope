import { describe, expect, it } from "vitest";
import { validateChart, validateSeries, type ChartSeriesSpec } from "../lib/chart-spec";
import type { SeriesFrequency, SeriesObservation } from "../lib/types";

const spec = (over: Partial<ChartSeriesSpec> = {}): ChartSeriesSpec => ({
  id: "s1", ticker: "TEST", metric: "revenue", frequency: "annual", transformation: "none", ...over,
});

const obs = (date: string, value: number | null, over: Partial<SeriesObservation> = {}): SeriesObservation => ({
  date, value, frequency: "annual", currency: "USD", unit: "currency",
  source: "SEC", status: "Verified", rawObservation: true, ...over,
});

const years = (values: Array<number | null>, from = 2020) =>
  values.map((value, index) => obs(`${from + index}-12-31`, value));

describe("a series that can be drawn", () => {
  it("passes a clean one through untouched", () => {
    const result = validateSeries(spec(), years([100, 110, 120]));
    expect(result.usable).toBe(true);
    expect(result.observations).toHaveLength(3);
    expect(result.problems).toEqual([]);
    expect(result.unit).toBe("currency");
    expect(result.currency).toBe("USD");
  });

  it("keeps the gaps, because a missing year is information", () => {
    const result = validateSeries(spec(), years([100, null, 120]));
    expect(result.usable).toBe(true);
    expect(result.observations.map((item) => item.value)).toEqual([100, null, 120]);
  });

  it("returns observations in date order whatever order they arrived in", () => {
    const result = validateSeries(spec(), [obs("2022-12-31", 3), obs("2020-12-31", 1), obs("2021-12-31", 2)]);
    expect(result.observations.map((item) => item.date)).toEqual(["2020-12-31", "2021-12-31", "2022-12-31"]);
  });
});

describe("observations that cost their own point, not the series", () => {
  it("drops an infinity and says where it came from", () => {
    const result = validateSeries(spec(), [...years([100, 110]), obs("2022-12-31", Infinity)]);
    expect(result.usable).toBe(true);
    expect(result.observations).toHaveLength(2);
    const problem = result.problems.find((item) => item.code === "non-finite")!;
    expect(problem.dropped).toBe(1);
    expect(problem.detail).toMatch(/division by zero/);
  });

  it("drops a NaN the same way", () => {
    const result = validateSeries(spec(), [...years([100, 110]), obs("2022-12-31", Number.NaN)]);
    expect(result.observations).toHaveLength(2);
    expect(result.problems.some((item) => item.code === "non-finite")).toBe(true);
  });

  it("drops an observation whose date is unusable", () => {
    const result = validateSeries(spec(), [...years([100, 110]), obs("not-a-date", 120), obs("2022-13-45", 130)]);
    expect(result.usable).toBe(true);
    expect(result.observations).toHaveLength(2);
    expect(result.problems.find((item) => item.code === "invalid-date")!.dropped).toBe(2);
  });

  it("keeps the most recently filed of two facts claiming one period", () => {
    const result = validateSeries(spec(), [
      obs("2021-12-31", 100, { filingDate: "2022-02-01" }),
      obs("2021-12-31", 105, { filingDate: "2023-02-01" }),
      obs("2022-12-31", 120),
    ]);
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0].value).toBe(105);
    expect(result.problems.find((item) => item.code === "duplicate-period")!.detail).toMatch(/most recently filed/);
  });
});

describe("a series that cannot be drawn honestly", () => {
  it("refuses an empty one", () => {
    const result = validateSeries(spec(), []);
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/no observation/);
  });

  it("refuses one where every value is missing", () => {
    const result = validateSeries(spec(), years([null, null, null]));
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/missing a value/);
  });

  it("refuses a share price asked for annually", () => {
    const result = validateSeries(spec({ metric: "stockPrice", frequency: "annual" }), years([10, 20]));
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/cannot be reported annual/);
  });

  it("refuses revenue asked for weekly", () => {
    const result = validateSeries(spec({ frequency: "weekly" as SeriesFrequency }), years([10, 20]));
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/filed annually or quarterly/);
  });

  it("accepts a share price weekly, which is the point of the distinction", () => {
    const weekly = [
      obs("2025-01-06", 100, { frequency: "weekly", unit: "perShare", source: "Yahoo Finance" }),
      obs("2025-01-13", 102, { frequency: "weekly", unit: "perShare", source: "Yahoo Finance" }),
    ];
    const result = validateSeries(spec({ metric: "stockPrice", frequency: "weekly" }), weekly);
    expect(result.usable).toBe(true);
    expect(result.unit).toBe("perShare");
  });

  it("refuses a unit and a currency it does not recognise", () => {
    expect(validateSeries(spec(), [obs("2021-12-31", 10, { unit: "furlongs" })]).reason).toMatch(/Unrecognised unit/);
    expect(validateSeries(spec(), [obs("2021-12-31", 10, { currency: "Dollars" })]).reason).toMatch(/Unrecognised currency/);
  });
});

describe("a split nobody registered", () => {
  it("reports a share count that steps by a whole ratio, and still draws", () => {
    const result = validateSeries(spec({ metric: "dilutedShares" }), [
      obs("2020-12-31", 1_000, { unit: "shares" }),
      obs("2021-12-31", 1_010, { unit: "shares" }),
      obs("2022-12-31", 4_040, { unit: "shares" }),
    ]);
    expect(result.usable).toBe(true);
    const problem = result.problems.find((item) => item.code === "unadjusted-split")!;
    expect(problem.detail).toMatch(/4×/);
    expect(problem.detail).toMatch(/registry entry does not record/);
  });

  it("reports a per-share amount stepping the other way, because a split divides it", () => {
    const result = validateSeries(spec({ metric: "netIncomePerShare" }), [
      obs("2020-12-31", 40, { unit: "perShare" }),
      obs("2021-12-31", 10, { unit: "perShare" }),
    ]);
    expect(result.problems.some((item) => item.code === "unadjusted-split")).toBe(true);
  });

  it("says nothing about ordinary growth", () => {
    const result = validateSeries(spec({ metric: "dilutedShares" }), [
      obs("2020-12-31", 1_000, { unit: "shares" }),
      obs("2021-12-31", 1_150, { unit: "shares" }),
    ]);
    expect(result.problems).toEqual([]);
  });

  it("says nothing about revenue that happens to double", () => {
    const result = validateSeries(spec(), years([100, 200]));
    expect(result.problems).toEqual([]);
  });
});

describe("one bad series never takes the chart with it", () => {
  it("draws the good ones and explains the rest", () => {
    const chart = validateChart([
      { spec: spec({ id: "a", metric: "revenue" }), observations: years([100, 110, 120]) },
      { spec: spec({ id: "b", metric: "stockPrice", frequency: "annual" }), observations: years([10, 20]) },
      { spec: spec({ id: "c", metric: "freeCashFlow" }), observations: years([30, 40]) },
      { spec: spec({ id: "d", metric: "netIncome" }), observations: [] },
    ]);
    expect(chart.series.map((item) => item.spec.id)).toEqual(["a", "c"]);
    expect(chart.rejected.map((item) => item.spec.id)).toEqual(["b", "d"]);
    for (const rejected of chart.rejected) expect(rejected.reason).toBeTruthy();
  });

  it("surfaces warnings from series that still drew", () => {
    const chart = validateChart([
      { spec: spec({ id: "a" }), observations: [...years([100, 110]), obs("2022-12-31", Infinity)] },
    ]);
    expect(chart.series).toHaveLength(1);
    expect(chart.warnings).toHaveLength(1);
    expect(chart.warnings[0]).toMatchObject({ id: "a", ticker: "TEST", metric: "revenue" });
  });

  it("survives a series that makes the validator itself throw", () => {
    const hostile = { get date() { throw new Error("provider returned a booby trap"); } } as unknown as SeriesObservation;
    const chart = validateChart([
      { spec: spec({ id: "a" }), observations: years([100, 110]) },
      { spec: spec({ id: "b" }), observations: [hostile] },
    ]);
    expect(chart.series.map((item) => item.spec.id)).toEqual(["a"]);
    expect(chart.rejected[0].reason).toMatch(/could not be validated/);
  });

  it("returns an empty chart rather than throwing when asked for nothing", () => {
    expect(validateChart([])).toEqual({ series: [], rejected: [], warnings: [] });
  });
});
