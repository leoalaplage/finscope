import { describe, expect, it } from "vitest";
import { candlesFromChart, type Candles } from "@/lib/adapters/candles";
import type { MarketWindow } from "@/lib/adapters/intraday";
import { areaFromCandles, areaFromWindow } from "@/lib/term/area-price";

const at = (iso: string) => Date.parse(iso) / 1000;
const candles: Candles = {
  symbol: "^GSPC", name: "S&P 500", currency: "USD", exchange: null, timezone: "America/New_York", interval: "5m",
  t: [at("2026-10-12T15:55:00Z"), at("2026-10-13T09:30:00Z"), at("2026-10-13T09:35:00Z")],
  o: [99, 105, 103], h: [100, 106, 104], l: [99, 103, 102], c: [100, 103, 102],
  last: 102, previousClose: 100,
};

describe("MKT 1D area reference", () => {
  it("includes the overnight gap: a decline from the open can still be a daily gain", () => {
    const area = areaFromCandles(candles, "1D");
    expect(area.baseline).toBe(100);
    expect((area.c.at(-1)! - area.baseline!) / area.baseline! * 100).toBe(2);
    expect(area.reference).toBe("previous close");
  });

  it("never includes yesterday's candle when today has only one bar", () => {
    const area = areaFromCandles({ ...candles, t: candles.t.slice(0, 2), c: candles.c.slice(0, 2) }, "1D");
    expect(area.t).toEqual([candles.t[1]]);
    expect(area.c).toEqual([103]);
  });

  it("keeps the period open for longer windows and does not invent a missing daily reference", () => {
    expect(areaFromCandles(candles, "1W").baseline).toBe(99);
    expect(areaFromCandles({ ...candles, previousClose: null }, "1D").baseline).toBeNull();
  });

  const snapshot: MarketWindow = {
    symbol: "^GSPC", name: "S&P 500", currency: "USD", timezone: "America/New_York", range: "1D",
    points: [{ time: at("2026-10-13T13:30:00Z"), label: "09:30", close: 103 }],
    baseline: 100, last: 102, change: 2, changePercent: 0.02, open: true,
    asOf: at("2026-10-13T13:32:17Z"), sessionDate: "2026-10-13",
  };

  it("shares WEI's live quote, baseline and exchange-local times", () => {
    const area = areaFromWindow(snapshot);
    expect(area.t).toEqual([at("2026-10-13T09:30:00Z"), at("2026-10-13T09:32:17Z")]);
    expect(area.c).toEqual([103, snapshot.last]);
    expect((area.c.at(-1)! - area.baseline!) / area.baseline!).toBe(snapshot.changePercent);
    expect(areaFromWindow({ ...snapshot, last: 104 }).c.at(-1)).toBe(104);
  });

  it("replaces a simultaneous quote without adding a duplicate timestamp", () => {
    const area = areaFromWindow({ ...snapshot, asOf: snapshot.points[0].time });
    expect(area.c).toEqual([102]);
    expect(area.t).toHaveLength(1);
  });

  it("does not attach an older quote to a newer session", () => {
    expect(areaFromWindow({ ...snapshot, asOf: snapshot.points[0].time - 60 }).c).toEqual([103]);
  });
});

describe("intraday previous close", () => {
  function payload(previousClose?: number) {
    return { chart: { error: null, result: [{
      meta: { symbol: "^GSPC", gmtoffset: -4 * 3600, chartPreviousClose: 80, previousClose },
      timestamp: [at("2026-10-12T19:55:00Z"), at("2026-10-13T13:30:00Z")],
      indicators: { quote: [{ open: [99, 105], high: [100, 106], low: [99, 103], close: [100, 103] }] },
    }] } };
  }

  it("uses the official previous close when supplied", () => {
    expect(candlesFromChart(payload(100.25), "5m")!.previousClose).toBe(100.25);
  });

  it("falls back to the preceding session, never the start of the 30-day history", () => {
    expect(candlesFromChart(payload(), "5m")!.previousClose).toBe(100);
  });

  it("leaves the reference unavailable if no previous session exists", () => {
    const input = payload();
    input.chart.result[0].timestamp = [at("2026-10-13T13:25:00Z"), at("2026-10-13T13:30:00Z")];
    expect(candlesFromChart(input, "5m")!.previousClose).toBeNull();
  });
});
