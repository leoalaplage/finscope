import { describe, expect, it } from "vitest";
import {
  averageTrueRange, fairValueGaps, fibonacci, pivots, priceOnLine, readStudies, supportResistance, trendLines, type Series,
} from "../lib/io/technicals";

/** Candles from (open, high, low, close) rows. */
const series = (rows: Array<[number, number, number, number]>): Series => ({
  t: rows.map((_, index) => index * 86_400),
  o: rows.map((row) => row[0]),
  h: rows.map((row) => row[1]),
  l: rows.map((row) => row[2]),
  c: rows.map((row) => row[3]),
});

/** Candles whose middle follows a list of closes, each one unit tall. */
const path = (closes: number[]) => series(closes.map((close) => [close, close + 0.5, close - 0.5, close]));

describe("pivots", () => {
  it("finds a high above its neighbours on both sides, and not at the edges", () => {
    const found = pivots(path([1, 2, 3, 2, 1, 2, 3, 4, 3]), 2);
    expect(found).toEqual([
      { index: 2, price: 3.5, kind: "high" },
      { index: 4, price: 0.5, kind: "low" },
    ]);
  });

  it("does not count a flat top twice", () => {
    const found = pivots(path([1, 2, 3, 3, 2, 1]), 1);
    expect(found.filter((pivot) => pivot.kind === "high").map((pivot) => pivot.index)).toEqual([2]);
  });
});

describe("average true range", () => {
  it("uses the gap from the previous close", () => {
    const atr = averageTrueRange(series([[10, 11, 9, 10], [15, 16, 14, 15]]), 1);
    expect(atr).toEqual([2, 6]);
  });
});

describe("Fibonacci", () => {
  it("measures a rise back down from its high, and extends it from the pullback", () => {
    const fib = fibonacci(path([100, 120, 150, 200, 180, 160, 170, 175]), 2)!;
    expect(fib.direction).toBe("up");
    expect(fib.from).toEqual({ index: 0, price: 99.5 });
    expect(fib.to).toEqual({ index: 3, price: 200.5 });
    const move = 200.5 - 99.5;
    expect(fib.retracement.find((level) => level.ratio === 0.618)!.price).toBeCloseTo(200.5 - move * 0.618);
    expect(fib.pullback).toEqual({ index: 5, price: 159.5 });
    expect(fib.extension.find((level) => level.ratio === 1)!.price).toBeCloseTo(159.5 + move);
  });

  it("reads a fall as a decline and projects below its low when there has been no bounce yet", () => {
    const fib = fibonacci(path([200, 180, 150, 120, 100]), 2)!;
    expect(fib.direction).toBe("down");
    expect(fib.pullback).toBeNull();
    expect(fib.extension.map((level) => level.ratio)).toEqual([1.272, 1.618]);
    expect(fib.extension[0].price).toBeLessThan(fib.to.price);
  });

  it("leaves out extension levels far beyond the candles", () => {
    const fib = fibonacci(path([100, 120, 150, 200, 180, 190, 199, 198]), 2)!;
    const reach = fib.to.price + (fib.to.price - fib.from.price) * 0.75;
    expect(fib.extension.every((level) => level.price <= reach)).toBe(true);
    expect(fib.extension.length).toBeLessThan(4);
  });

  it("says nothing about a flat line", () => {
    expect(fibonacci(path([5]), 2)).toBeNull();
  });
});

describe("fair value gaps", () => {
  const flatAtr = (n: number) => new Array(n).fill(1);

  it("keeps an untouched bullish gap between the first high and the third low", () => {
    const s = series([[10, 11, 9, 10.5], [11, 14, 10.8, 13.8], [14, 15, 13, 14.5], [14.5, 16, 14, 15]]);
    expect(fairValueGaps(s, flatAtr(4))).toEqual([{ kind: "bullish", index: 1, top: 13, bottom: 11 }]);
  });

  it("shrinks a gap price has entered and drops one it has crossed", () => {
    const rows: Array<[number, number, number, number]> = [[10, 11, 9, 10.5], [11, 14, 10.8, 13.8], [14, 15, 13, 14.5], [14, 14.5, 12, 13]];
    expect(fairValueGaps(series(rows), flatAtr(4))[0]).toMatchObject({ top: 12, bottom: 11 });
    expect(fairValueGaps(series([...rows, [12, 13.2, 10.5, 11]]), flatAtr(5))).toEqual([]);
  });

  it("finds bearish gaps and ignores gaps too small to matter", () => {
    const s = series([[20, 21, 19, 19.5], [19, 19.2, 15, 15.5], [15.5, 16, 14, 14.5]]);
    expect(fairValueGaps(s, flatAtr(3))).toEqual([{ kind: "bearish", index: 1, top: 19, bottom: 16 }]);
    expect(fairValueGaps(s, new Array(3).fill(100))).toEqual([]);
  });
});

describe("trend lines", () => {
  // Three rising lows on a line through (4, 99.5), (12, 103.5), (20, 107.5), with highs in between.
  const zigzag = () => {
    const closes: number[] = [];
    for (let index = 0; index < 26; index++) {
      const phase = index % 8;
      const base = 100 + index * 0.5;
      closes.push(phase === 4 ? base - 2 : base + Math.min(phase, 8 - phase) * 0.1 + (phase === 0 ? 2 : 0));
    }
    return path(closes);
  };

  it("joins rising lows that nothing has broken", () => {
    const s = zigzag();
    const lines = trendLines(s, pivots(s, 2), 1);
    const support = lines.find((line) => line.kind === "support")!;
    expect(support).toBeTruthy();
    expect(support.touches).toBeGreaterThanOrEqual(3);
    expect(priceOnLine(support, 20)).toBeCloseTo(s.l[20], 5);
  });

  it("leaves out a line far from today's price", () => {
    const s = zigzag();
    const lines = trendLines(s, pivots(s, 2), 1, 2, 0.001);
    expect(lines.filter((line) => line.kind === "support")).toEqual([]);
  });

  it("drops a support line once a close has gone through it", () => {
    const s = zigzag();
    s.c[25] = 80; s.l[25] = 79.5; s.o[25] = 80; s.h[25] = 80.5;
    const lines = trendLines(s, pivots(s, 2), 1);
    expect(lines.some((line) => line.kind === "support" && line.b.index < 25 && line.a.index <= 20)).toBe(false);
  });
});

describe("support and resistance", () => {
  it("groups pivots that came back to the same price, on each side of the close", () => {
    const s = path([100, 110, 100, 110, 100, 105]);
    const found = [
      { index: 1, price: 110, kind: "high" as const }, { index: 3, price: 110.2, kind: "high" as const },
      { index: 2, price: 100, kind: "low" as const }, { index: 4, price: 99.9, kind: "low" as const },
      { index: 0, price: 130, kind: "high" as const },
    ];
    const levels = supportResistance(s, found, 1);
    expect(levels.map((level) => [level.kind, Math.round(level.price * 100) / 100, level.touches])).toEqual([
      ["resistance", 110.1, 2],
      ["support", 99.95, 2],
    ]);
  });
});

describe("the reader's choice of studies", () => {
  it("defaults to averages, retracement and trend lines, and trusts only names it knows", () => {
    expect([...readStudies(null)]).toEqual(["ema", "fibRetracement", "trendLines"]);
    expect([...readStudies("[]")]).toEqual([]);
    expect([...readStudies('["fvg","nope","ema"]')]).toEqual(["ema", "fvg"]);
    expect([...readStudies("{bad")]).toEqual(["ema", "fibRetracement", "trendLines"]);
  });
});
