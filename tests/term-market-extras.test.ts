import { describe, expect, it } from "vitest";
import { breadthOf, median, sectorRuns, unusualVolume, type ExtrasRow } from "@/lib/term/market-extras";

const row = (ticker: string, sector: string, values: Record<string, [number | null, number | null]>): ExtrasRow =>
  ({ ticker, name: ticker, sector, values });

const rows = [
  row("A", "Tech", { close: [110, 100], sma50: [100, 100], sma200: [90, 101], fromHigh52: [-0.5, -2], fromLow52: [40, 30], rsi14: [75, 60], chg5: [2, 1], chg20: [10, 5], chg60: [20, 10], volumeRatio: [3, 1], chg1: [4, 1] }),
  row("B", "Tech", { close: [90, 95], sma50: [100, 100], sma200: [95, 94], fromHigh52: [-20, -15], fromLow52: [0.5, 2], rsi14: [25, 30], chg5: [-4, 0], chg20: [-2, 0], chg60: [4, 0], volumeRatio: [1.2, 1], chg1: [-3, 0] }),
  row("C", "Energy", { close: [50, 50], sma50: [40, 41], sma200: [45, 44], fromHigh52: [-5, -5], fromLow52: [10, 10], rsi14: [50, 50], chg5: [1, 1], chg20: [3, 3], chg60: [-1, -1], volumeRatio: [0.8, 1], chg1: [0, 0] }),
  row("D", "Energy", { close: [null, null] }),
];

describe("market breadth from the snapshot", () => {
  it("counts members above averages, at extremes and crossing", () => {
    const breadth = breadthOf(rows);
    expect(breadth.counted).toBe(3);
    expect(breadth.aboveSma50).toBe(2);
    expect(breadth.aboveSma200).toBe(2);
    expect(breadth.highs52).toBe(1);
    expect(breadth.lows52).toBe(1);
    expect([breadth.overbought, breadth.oversold]).toEqual([1, 1]);
    expect(breadth.goldenCrosses).toEqual(["A"]);
    expect(breadth.deathCrosses).toEqual([]);
  });

  it("ranks sectors by their median month", () => {
    expect(sectorRuns(rows).map((run) => [run.sector, run.companies, run.d20])).toEqual([["Tech", 2, 4], ["Energy", 2, 3]]);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });

  it("lists the heaviest volume against its own average", () => {
    expect(unusualVolume(rows, 2).map((mover) => [mover.ticker, mover.ratio, mover.change])).toEqual([["A", 3, 4], ["B", 1.2, -3]]);
  });
});
