import type { Candles } from "@/lib/adapters/candles";
import type { MarketWindow } from "@/lib/adapters/intraday";
import { candlesInRange, type ChartRange } from "@/lib/io/chart-ranges";

export interface AreaSeries {
  t: number[];
  c: number[];
  baseline: number | null;
  reference: "previous close" | "open";
}

/** Keep exactly the requested session, even at its first bar. */
export function areaFromCandles(candles: Candles, range: ChartRange): AreaSeries {
  const from = candles.t.length - candlesInRange(candles.t, range);
  return {
    t: candles.t.slice(from), c: candles.c.slice(from),
    baseline: range === "1D" ? candles.previousClose : candles.o[from] ?? candles.c[from] ?? null,
    reference: range === "1D" ? "previous close" : "open",
  };
}

/** WEI and the US index's 1D area consume the very same polled snapshot. */
export function areaFromWindow(window: MarketWindow): AreaSeries {
  const t = window.points.map((point) => Date.parse(`${window.sessionDate}T${point.label}:00Z`) / 1000);
  const c = window.points.map((point) => point.close);
  const final = window.points.at(-1);
  // The quote can be newer than the last five-minute close. Keep its actual
  // timestamp, expressed on the same exchange-clock axis as the candles.
  if (final && window.last != null && window.asOf != null && window.asOf >= final.time) {
    const time = window.asOf + (t[t.length - 1] - Math.floor(final.time / 60) * 60);
    if (window.asOf === final.time) c[c.length - 1] = window.last;
    else { t.push(time); c.push(window.last); }
  }
  return { t, c, baseline: window.baseline, reference: "previous close" };
}
