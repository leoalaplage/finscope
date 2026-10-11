import { describe, expect, it } from "vitest";
import { ichimoku, patternsAt, sma, stochastic, volumeProfile, vwap, type Bars } from "@/lib/io/indicators";

const bars = (rows: Array<[number, number, number, number, number?]>, start = 0, step = 86_400): Bars => ({
  t: rows.map((_, index) => start + index * step),
  o: rows.map((row) => row[0]), h: rows.map((row) => row[1]), l: rows.map((row) => row[2]), c: rows.map((row) => row[3]),
  v: rows.map((row) => row[4] ?? 100),
});

describe("stochastic", () => {
  it("is 100 at the top of the range and 0 at the bottom", () => {
    const rising = bars(Array.from({ length: 20 }, (_, index) => [index, index + 1, index - 1, index + 1] as [number, number, number, number]));
    expect(stochastic(rising, 14, 1, 1).k.at(-1)).toBeCloseTo(100);
    const falling = bars(Array.from({ length: 20 }, (_, index) => [-index, -index + 1, -index - 1, -index - 1] as [number, number, number, number]));
    expect(stochastic(falling, 14, 1, 1).k.at(-1)).toBeCloseTo(0);
  });
});

describe("Ichimoku", () => {
  it("plots the cloud 26 bars ahead of the lines it comes from", () => {
    const series = bars(Array.from({ length: 90 }, (_, index) => [index, index + 2, index - 2, index] as [number, number, number, number]));
    const cloud = ichimoku(series);
    const at = 60;
    expect(cloud.spanA[at]).toBeCloseTo((cloud.tenkan[at - 26]! + cloud.kijun[at - 26]!) / 2);
    expect(cloud.spanA[30]).toBeNull();
    expect(cloud.spanB[76]).toBeNull();
    expect(cloud.spanB[77]).not.toBeNull();
  });
});

describe("VWAP", () => {
  it("weights the typical price by volume and restarts each session when asked", () => {
    const two = bars([[10, 12, 8, 10, 100], [10, 22, 18, 20, 300], [30, 31, 29, 30, 50]], 0, 3600 * 12);
    // Bars 0 and 1 share a day; bar 2 is the next day.
    const session = vwap(two, true);
    expect(session[1]).toBeCloseTo((10 * 100 + 20 * 300) / 400);
    expect(session[2]).toBeCloseTo(30);
    const anchored = vwap(two, false);
    expect(anchored[2]).toBeCloseTo((10 * 100 + 20 * 300 + 30 * 50) / 450);
  });
});

describe("volume profile", () => {
  it("spreads each bar's volume across the bins its range covers", () => {
    const profile = volumeProfile(bars([[1, 2, 0, 1, 100], [3, 4, 3, 3.5, 40]]), 0, 4, 4);
    expect(profile.map((bin) => Math.round(bin.volume))).toEqual([50, 50, 0, 40]);
  });
});

describe("candle patterns", () => {
  const trendDown = sma(Array.from({ length: 12 }, (_, index) => 100 - index), 10);

  it("finds a bullish engulfing bar", () => {
    const series = bars([[10, 11, 9, 10], [10, 10.5, 8.8, 9], [8.9, 10.6, 8.7, 10.4]]);
    expect(patternsAt(series, 2)).toContain("bullEngulfing");
  });

  it("finds a hammer only after a fall", () => {
    const rows: Array<[number, number, number, number]> = Array.from({ length: 11 }, (_, index) => [100 - index, 101 - index, 99 - index, 100 - index]);
    rows.push([89.5, 90, 86, 89.8]);
    const series = bars(rows);
    const fall = sma(series.c, 10);
    expect(patternsAt(series, 11, fall)).toContain("hammer");
    expect(trendDown.at(-1)).not.toBeNull();
  });

  it("finds a doji and nothing on a plain bar", () => {
    expect(patternsAt(bars([[1, 2, 0, 1], [1, 2, 0, 1.5], [5, 6, 4, 5.02]]), 2)).toEqual(["doji"]);
    expect(patternsAt(bars([[1, 2, 0, 1], [1, 2, 0, 1.5], [5, 6, 4, 5.8]]), 2)).toEqual([]);
  });
});
