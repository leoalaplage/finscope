import { describe, expect, it } from "vitest";
import { candlesFromChart } from "../lib/adapters/candles";
import { candlesToShow, dateLabels, dateText, priceScale } from "../lib/io/candle-chart";
import { ema } from "../lib/io/indicators";

describe("exponential moving average", () => {
  it("seeds with the simple average of its first window", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(3);
    expect(out[4]).toBeCloseTo(4);
  });

  it("follows a constant series exactly and states nothing before its window", () => {
    expect(ema(new Array(30).fill(10), 9).at(-1)).toBeCloseTo(10);
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });

  it("weights the newest close by 2/(n+1)", () => {
    const out = ema([10, 10, 10, 20], 3);
    expect(out[3]).toBeCloseTo(10 + (20 - 10) * 0.5);
  });
});

describe("the candle chart", () => {
  it("shows a year of days, three years of weeks and ten years of months, fewer on a narrow screen", () => {
    expect(candlesToShow("1d", 700, 1100)).toBe(252);
    expect(candlesToShow("1wk", 700, 1100)).toBe(156);
    expect(candlesToShow("1mo", 60, 1100)).toBe(60);
    expect(candlesToShow("1d", 700, 300)).toBe(75);
    expect(candlesToShow("1d", 700, null)).toBe(252);
  });

  it("puts round ticks inside a padded scale", () => {
    const scale = priceScale([101, 149])!;
    expect(scale.min).toBeLessThan(101);
    expect(scale.max).toBeGreaterThan(149);
    expect(scale.ticks).toEqual([100, 110, 120, 130, 140, 150]);
    expect(priceScale([])).toBeNull();
    expect(priceScale([5, 5])!.ticks.length).toBeGreaterThan(0);
  });

  it("labels months for days, quarters for weeks and years for months, with January carrying its year", () => {
    const day = (y: number, m: number, d: number) => Date.UTC(y, m, d) / 1000;
    const days = [day(2025, 11, 30), day(2025, 11, 31), day(2026, 0, 2), day(2026, 1, 2)];
    expect(dateLabels(days, "1d")).toEqual([{ index: 2, text: "2026" }, { index: 3, text: "Feb" }]);
    const weeks = [day(2026, 1, 23), day(2026, 2, 30), day(2026, 3, 6)];
    expect(dateLabels(weeks, "1wk")).toEqual([{ index: 2, text: "Apr" }]);
    const months = [day(2024, 11, 1), day(2025, 0, 1), day(2025, 1, 1)];
    expect(dateLabels(months, "1mo")).toEqual([{ index: 1, text: "2025" }]);
    expect(dateLabels(Array.from({ length: 400 }, (_, index) => day(2000, index, 1)), "1d", 8).length).toBeLessThanOrEqual(8);
    expect(dateText(day(2026, 8, 14), "1wk")).toBe("Week of 14 Sep 2026");
    expect(dateText(day(2026, 8, 1), "1mo")).toBe("Sep 2026");
  });
});

describe("candles from Yahoo", () => {
  const payload = (timestamps: number[], rows: Array<[number | null, number, number, number]>) => ({
    chart: { error: null, result: [{
      meta: { currency: "USD", symbol: "AAPL", gmtoffset: -14_400, exchangeTimezoneName: "America/New_York" },
      timestamp: timestamps,
      indicators: { quote: [{ open: rows.map((row) => row[0]), high: rows.map((row) => row[1]), low: rows.map((row) => row[2]), close: rows.map((row) => row[3]) }] },
    }] },
  });

  it("stamps bars at midnight of the exchange's date, drops untraded ones and keeps the later print of a repeated day", () => {
    const open = Date.UTC(2026, 8, 15, 13, 30) / 1000;
    const out = candlesFromChart(payload([open, open + 3600, open + 86_400], [[1, 2, 0.5, 1.5], [1, 3, 0.5, 2.5], [null, 2, 1, 1]]), "1d")!;
    expect(out.t).toEqual([Date.UTC(2026, 8, 15) / 1000]);
    expect(out.c).toEqual([2.5]);
  });

  it("merges the running week or month Yahoo repeats at today's date into one candle", () => {
    const at = (y: number, m: number, d: number) => Date.UTC(y, m, d, 13, 30) / 1000;
    const weeks = candlesFromChart(payload([at(2026, 8, 7), at(2026, 8, 14), at(2026, 8, 16)], [[1, 2, 1, 1.5], [2, 3, 1.8, 2.5], [2.5, 4, 2.4, 3.5]]), "1wk")!;
    expect(weeks.t).toEqual([Date.UTC(2026, 8, 7) / 1000, Date.UTC(2026, 8, 14) / 1000]);
    expect(weeks).toMatchObject({ o: [1, 2], h: [2, 4], l: [1, 1.8], c: [1.5, 3.5] });
    const months = candlesFromChart(payload([at(2026, 7, 1), at(2026, 8, 1), at(2026, 8, 16)], [[1, 2, 1, 1.5], [2, 3, 1.8, 2.5], [2.5, 2.6, 1.2, 2.2]]), "1mo")!;
    expect(months.t).toEqual([Date.UTC(2026, 7, 1) / 1000, Date.UTC(2026, 8, 1) / 1000]);
    expect(months).toMatchObject({ l: [1, 1.2], c: [1.5, 2.2] });
  });

  it("keeps a high and low that contain the open and close", () => {
    const out = candlesFromChart(payload([Date.UTC(2026, 8, 15, 13, 30) / 1000], [[3, 2, 1.5, 1]]), "1d")!;
    expect(out.h[0]).toBe(3);
    expect(out.l[0]).toBe(1);
  });
});
