import { describe, expect, it } from "vitest";
import {
  adx, aroon, chaikinMoneyFlow, cci, donchian, floorPivots, heikinAshi, hullMa, keltner, moneyFlowIndex, obv,
  parabolicSar, roc, squeeze, stochRsi, supertrend, williamsR, type Ohlcv,
} from "@/lib/io/indicators-extra";

/** A steady climb then a steady fall, 60 bars each, with a one-point range. */
function trend(): Ohlcv {
  const c = [...Array.from({ length: 60 }, (_, i) => 100 + i), ...Array.from({ length: 60 }, (_, i) => 159 - i)];
  return { o: c.map((x) => x - 0.2), h: c.map((x) => x + 0.5), l: c.map((x) => x - 0.5), c, v: c.map(() => 1000) };
}
const last = (line: Array<number | null>) => [...line].reverse().find((value) => value != null) ?? null;

describe("trend indicators", () => {
  const bars = trend();
  it("ADX is strong in a steady trend, with −DI leading on the way down", () => {
    const dmi = adx(bars);
    expect(last(dmi.adx)!).toBeGreaterThan(40);
    expect(last(dmi.minus)!).toBeGreaterThan(last(dmi.plus)!);
    expect(dmi.adx[50]!).toBeGreaterThan(40);
    expect(dmi.plus[50]!).toBeGreaterThan(dmi.minus[50]!);
  });
  it("Supertrend and the SAR trail below on the way up and flip above on the way down", () => {
    const st = supertrend(bars), sar = parabolicSar(bars);
    expect(st.up[55]).toBe(true);
    expect(st.line[55]!).toBeLessThan(bars.c[55]);
    expect(st.up.at(-1)).toBe(false);
    expect(st.line.at(-1)!).toBeGreaterThan(bars.c.at(-1)!);
    expect(sar.up[55]).toBe(true);
    expect(sar.up.at(-1)).toBe(false);
  });
  it("Aroon up is 100 on a new high and Aroon down 100 on a new low", () => {
    const a = aroon(bars);
    expect(a.up[59]).toBe(100);
    expect(a.down.at(-1)).toBe(100);
  });
  it("Hull's average lags a straight line far less than a simple average", () => {
    // WMA lags (n − 1) / 3; Hull cancels all but the last smoothing's: (5 − 1) / 3 = 1.33 points, against 10 for SMA 21.
    // WMA(10) and WMA(21) as Hull rounds them down, then WMA(4): a third of a bar behind a straight line.
    expect(hullMa(bars.c.slice(0, 60), 21)[59]!).toBeCloseTo(159 - 1 / 3, 6);
  });
});

describe("channels", () => {
  const bars = trend();
  it("Donchian is the window's extremes", () => {
    const d = donchian(bars, 20);
    expect(d.upper[59]).toBe(159.5);
    expect(d.lower[59]).toBe(139.5);
    expect(d.middle[59]).toBe(149.5);
  });
  it("Keltner brackets its average", () => {
    const k = keltner(bars);
    expect(k.upper[80]!).toBeGreaterThan(k.middle[80]!);
    expect(k.lower[80]!).toBeLessThan(k.middle[80]!);
  });
  it("the squeeze fires in a quiet range and its momentum follows the trend", () => {
    const flat: Ohlcv = { o: Array(60).fill(100), h: Array(60).fill(100.1), l: Array(60).fill(99.9), c: Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 0.01 : -0.01)) };
    expect(squeeze(flat).on.at(-1)).toBe(true);
    expect(squeeze(bars).momentum[55]!).toBeGreaterThan(0);
    expect(last(squeeze(bars).momentum)!).toBeLessThan(0);
  });
});

describe("momentum and volume", () => {
  const bars = trend();
  it("Williams %R is near 0 at the top of the range and near −100 at the bottom", () => {
    const w = williamsR(bars);
    expect(w[59]!).toBeGreaterThan(-10);
    expect(last(w)!).toBeLessThan(-90);
  });
  it("CCI is positive rising and negative falling; ROC is the percent move", () => {
    expect(cci(bars)[55]!).toBeGreaterThan(0);
    expect(last(cci(bars))!).toBeLessThan(0);
    expect(roc(bars.c, 12)[20]!).toBeCloseTo((120 / 108 - 1) * 100, 6);
  });
  it("Stochastic RSI stays within 0–100", () => {
    const s = stochRsi(bars.c);
    for (const value of s.k) if (value != null) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(100); }
  });
  it("OBV adds volume on up closes; CMF and MFI read buying in the climb, selling in the fall", () => {
    const o = obv(bars);
    expect(o[59]).toBe(59 * 1000);
    expect(o.at(-1)).toBe(0);
    // Closes near each bar's high are buying, near its low selling.
    const strong: Ohlcv = { ...bars, c: bars.h.map((high) => high - 0.1) };
    const weak: Ohlcv = { ...bars, c: bars.l.map((low) => low + 0.1) };
    expect(chaikinMoneyFlow(strong).at(-1)!).toBeCloseTo(0.8, 6);
    expect(chaikinMoneyFlow(weak).at(-1)!).toBeCloseTo(-0.8, 6);
    expect(moneyFlowIndex(bars)[55]).toBe(100);
    expect(last(moneyFlowIndex(bars))).toBe(0);
  });
});

describe("levels and candles", () => {
  it("floor pivots", () => {
    expect(floorPivots(110, 90, 100)).toEqual({ p: 100, r1: 110, s1: 90, r2: 120, s2: 80, r3: 130, s3: 70 });
  });
  it("Heikin-Ashi averages each bar with the one before", () => {
    const ha = heikinAshi({ o: [10, 11], h: [12, 13], l: [9, 10], c: [11, 12] });
    expect(ha.c).toEqual([10.5, 11.5]);
    expect(ha.o).toEqual([10.5, 10.5]);
    expect(ha.h[1]).toBe(13);
  });
});
