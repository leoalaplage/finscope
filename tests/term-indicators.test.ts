import { describe, expect, it } from "vitest";
import { bollinger, macd, rsi, sma } from "@/lib/io/indicators";
import { candlesFromChart } from "@/lib/adapters/candles";

describe("simple moving average", () => {
  it("averages the last n values and states nothing before", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe("Bollinger Bands", () => {
  it("collapse onto the average for a constant series", () => {
    const bands = bollinger(new Array(25).fill(10), 20, 2);
    expect(bands.middle.at(-1)).toBe(10);
    expect(bands.upper.at(-1)).toBe(10);
    expect(bands.lower.at(-1)).toBe(10);
    expect(bands.upper[18]).toBeNull();
  });

  it("sit two population deviations either side", () => {
    // 1..20: mean 10.5, population variance (n²−1)/12 = 33.25
    const values = Array.from({ length: 20 }, (_, index) => index + 1);
    const bands = bollinger(values, 20, 2);
    expect(bands.middle[19]).toBeCloseTo(10.5);
    expect(bands.upper[19]).toBeCloseTo(10.5 + 2 * Math.sqrt(33.25));
    expect(bands.lower[19]).toBeCloseTo(10.5 - 2 * Math.sqrt(33.25));
  });
});

describe("relative strength index", () => {
  it("is 100 when a series only rises and 0 when it only falls", () => {
    const rising = Array.from({ length: 30 }, (_, index) => index);
    expect(rsi(rising).at(-1)).toBe(100);
    expect(rsi(rising.map((value) => -value)).at(-1)).toBe(0);
    expect(rsi(rising)[13]).toBeNull();
  });

  it("is 50 when gains and losses balance", () => {
    const zigzag = Array.from({ length: 15 }, (_, index) => (index % 2 ? 11 : 10));
    expect(rsi(zigzag)[14]).toBeCloseTo(50, 0);
  });
});

describe("MACD", () => {
  it("is flat at zero for a constant series and starts once both averages and the signal exist", () => {
    const out = macd(new Array(60).fill(50));
    expect(out.macd.at(-1)).toBeCloseTo(0);
    expect(out.histogram.at(-1)).toBeCloseTo(0);
    expect(out.macd[24]).toBeNull();
    expect(out.macd[25]).not.toBeNull();
    expect(out.signal[32]).toBeNull();
    expect(out.signal[33]).not.toBeNull();
  });

  it("turns positive when prices accelerate upward", () => {
    const values = [...new Array(40).fill(100), ...Array.from({ length: 20 }, (_, index) => 100 + index * 2)];
    expect(macd(values).macd.at(-1)!).toBeGreaterThan(0);
  });
});

describe("candle volume", () => {
  it("is read beside the prices, and the running period keeps its volume to date", () => {
    const day = Date.UTC(2026, 8, 7) / 1000;
    const payload = {
      chart: {
        result: [{
          meta: { symbol: "TEST", gmtoffset: 0 },
          timestamp: [day, day + 7 * 86_400, day + 9 * 86_400],
          indicators: { quote: [{ open: [1, 2, 2.5], high: [2, 3, 4], low: [1, 1.8, 2.4], close: [1.5, 2.5, 3.5], volume: [100, 500, 120] }] },
        }],
        error: null,
      },
    };
    const weeks = candlesFromChart(payload, "1wk")!;
    expect(weeks.v).toEqual([100, 500]);
  });
});
