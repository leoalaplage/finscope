import { describe, expect, it } from "vitest";
import { candlesFromChart } from "../lib/adapters/candles";
import { addIndicator, DEFAULT_INDICATORS, intervalForRange, rangeStart, readDrawings, readSettings } from "../lib/io/chart-page";
import { atr, autoSwing, bollinger, ema, fibonacciLevels, heikinAshi, macd, rsi, sma, stochastic, vwap, type Bar } from "../lib/io/indicators";

const bar = (time: number, open: number, high: number, low: number, close: number, volume: number | null = 100): Bar => ({ time, open, high, low, close, volume });

describe("moving averages", () => {
  it("averages the last window and waits for a full one", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("seeds the EMA with the SMA of its first window", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(3);
    expect(out[4]).toBeCloseTo(4);
  });

  it("follows a constant series exactly", () => {
    expect(ema(new Array(30).fill(10), 9).at(-1)).toBeCloseTo(10);
  });
});

describe("oscillators", () => {
  it("reads RSI at 100 on a steady rise and 0 on a steady fall", () => {
    const rising = Array.from({ length: 30 }, (_, index) => index + 1);
    expect(rsi(rising, 14).at(-1)).toBe(100);
    expect(rsi([...rising].reverse(), 14).at(-1)).toBe(0);
    expect(rsi(rising, 14)[13]).toBeNull();
    expect(rsi(rising, 14)[14]).toBe(100);
  });

  it("matches Wilder's RSI on the textbook series", () => {
    // Wilder's worked example, as reproduced by StockCharts: 70.53 there from averages rounded to two places, 70.46 exactly.
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(closes, 14)[14]).toBeCloseTo(70.46, 2);
  });

  it("draws the MACD as the gap between two EMAs, and the histogram as its gap to the signal", () => {
    const closes = Array.from({ length: 60 }, (_, index) => 100 + Math.sin(index / 4) * 5 + index * 0.2);
    const result = macd(closes, 12, 26, 9);
    const fast = ema(closes, 12), slow = ema(closes, 26);
    expect(result.macd[40]).toBeCloseTo(fast[40]! - slow[40]!);
    expect(result.histogram[40]).toBeCloseTo(result.macd[40]! - result.signal[40]!);
    expect(result.signal[32]).toBeNull();
    expect(result.signal[33]).not.toBeNull();
  });

  it("puts the stochastic at 100 on a close at the top of the window", () => {
    const bars = Array.from({ length: 20 }, (_, index) => bar(index, index, index + 1, index - 1, index + 1));
    expect(stochastic(bars, 14, 1, 1).k.at(-1)).toBe(100);
  });

  it("takes the true range from the previous close across a gap", () => {
    const bars = [bar(0, 10, 11, 9, 10), bar(1, 15, 16, 14, 15)];
    expect(atr(bars, 1)[1]).toBe(6);
  });
});

describe("bands and averages over volume", () => {
  it("puts Bollinger Bands two deviations either side of the average", () => {
    const bands = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(bands.middle[7]).toBe(5);
    expect(bands.upper[7]).toBe(9);
    expect(bands.lower[7]).toBe(1);
  });

  it("restarts VWAP at each session", () => {
    const bars = [bar(0, 10, 10, 10, 10, 1), bar(60, 20, 20, 20, 20, 1), bar(86_400, 30, 30, 30, 30, 5)];
    expect(vwap(bars, (item) => Math.floor(item.time / 86_400))).toEqual([10, 15, 30]);
  });

  it("builds Heikin Ashi bars from the one before", () => {
    const out = heikinAshi([bar(0, 10, 12, 8, 11), bar(1, 11, 13, 10, 12)]);
    expect(out[0].close).toBe(10.25);
    expect(out[1].open).toBe((out[0].open + out[0].close) / 2);
    expect(out[1].high).toBeGreaterThanOrEqual(Math.max(out[1].open, out[1].close));
  });
});

describe("Fibonacci", () => {
  it("measures levels back from where the move ended", () => {
    const levels = fibonacciLevels(100, 200);
    expect(levels.find((level) => level.ratio === 0)?.price).toBe(200);
    expect(levels.find((level) => level.ratio === 0.618)?.price).toBeCloseTo(138.2);
    expect(levels.find((level) => level.ratio === 1)?.price).toBe(100);
    expect(fibonacciLevels(100, 200, true).find((level) => level.ratio === 1.618)?.price).toBeCloseTo(38.2);
  });

  it("reads a stretch that fell after its high as a decline", () => {
    const rise = autoSwing([bar(0, 5, 6, 4, 5), bar(1, 9, 20, 8, 19), bar(2, 15, 16, 12, 13)]);
    expect(rise).toEqual({ from: { time: 0, price: 4 }, to: { time: 1, price: 20 } });
    const fall = autoSwing([bar(0, 19, 20, 18, 19), bar(1, 9, 10, 2, 3)]);
    expect(fall?.to.price).toBe(2);
    expect(autoSwing([bar(0, 1, 1, 1, 1)])).toBeNull();
  });
});

describe("the chart page's rules", () => {
  it("moves the interval only when the one in hand cannot draw the range", () => {
    expect(intervalForRange("1D", "1d")).toBe("5m");
    expect(intervalForRange("1D", "15m")).toBe("15m");
    expect(intervalForRange("5D", "1wk")).toBe("15m");
    expect(intervalForRange("5Y", "5m")).toBe("1d");
    expect(intervalForRange("1Y", "1h")).toBe("1h");
    expect(intervalForRange("1M", "1mo")).toBe("1d");
    expect(intervalForRange("All", "1wk")).toBe("1wk");
  });

  it("finds the start of the last sessions and of a calendar range", () => {
    const day = 86_400;
    const times = [0, 3600, day, day + 3600, 2 * day, 2 * day + 3600];
    expect(rangeStart("1D", times)).toBe(2 * day);
    expect(rangeStart("5D", times)).toBe(0);
    expect(rangeStart("1M", [0, 40 * day])).toBe(40 * day - 31 * day);
    expect(rangeStart("YTD", [Date.UTC(2026, 5, 1) / 1000])).toBe(Date.UTC(2026, 0, 1) / 1000);
  });

  it("adds indicators with free colours and does not double the volume", () => {
    const list = addIndicator(DEFAULT_INDICATORS, "ema");
    expect(list.at(-1)).toMatchObject({ kind: "ema", period: 21 });
    expect(new Set(list.filter((item) => item.color).map((item) => item.color)).size).toBe(list.filter((item) => item.color).length);
    expect(addIndicator(list, "volume")).toBe(list);
    expect(addIndicator(addIndicator(list, "sma"), "sma").filter((item) => item.kind === "sma").map((item) => item.id)).toEqual(["sma-50", "sma-200", "sma", "sma-2"]);
  });

  it("trusts nothing it reads back from storage", () => {
    expect(readSettings("{bad")).toMatchObject({ style: "candles", interval: "1d" });
    const read = readSettings(JSON.stringify({ style: "nope", interval: "1h", log: true, indicators: [{ id: "x", kind: "rsi", period: 9999, color: "#fff" }, { id: "y", kind: "evil" }] }));
    expect(read).toMatchObject({ style: "candles", interval: "1h", log: true });
    expect(read.indicators).toEqual([{ id: "x", kind: "rsi", period: 500, color: "#fff" }]);
    expect(readDrawings(JSON.stringify([
      { id: "a", type: "fib", a: { time: 1, price: 2 }, b: { time: 3, price: 4 } },
      { id: "b", type: "trend", a: { time: 1, price: 2 } },
      { id: "c", type: "hline", a: { time: 1, price: 2 } },
    ])).map((item) => item.id)).toEqual(["a", "c"]);
  });
});

describe("candles from Yahoo", () => {
  const payload = (timestamps: number[], rows: Array<[number | null, number, number, number]>) => ({
    chart: { error: null, result: [{
      meta: { currency: "USD", symbol: "AAPL", gmtoffset: -14_400, exchangeTimezoneName: "America/New_York" },
      timestamp: timestamps,
      indicators: { quote: [{ open: rows.map((row) => row[0]), high: rows.map((row) => row[1]), low: rows.map((row) => row[2]), close: rows.map((row) => row[3]), volume: rows.map(() => 10) }] },
    }] },
  });

  it("moves intraday bars to the exchange clock and drops bars that did not trade", () => {
    const out = candlesFromChart(payload([1_750_000_000, 1_750_000_300, 1_750_000_600], [[1, 2, 0.5, 1.5], [null, 2, 1, 1], [1.5, 1.6, 1.4, 1.45]]), "5m")!;
    expect(out.t).toEqual([1_750_000_000 - 14_400, 1_750_000_600 - 14_400]);
    expect(out.c).toEqual([1.5, 1.45]);
  });

  it("stamps daily bars at midnight and keeps the later print of a repeated day", () => {
    const open = Date.UTC(2026, 8, 15, 13, 30) / 1000;
    const out = candlesFromChart(payload([open, open + 3600], [[1, 2, 0.5, 1.5], [1, 3, 0.5, 2.5]]), "1d")!;
    expect(out.t).toEqual([Date.UTC(2026, 8, 15) / 1000]);
    expect(out.c).toEqual([2.5]);
  });
});
