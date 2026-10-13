import type { Candles } from "@/lib/adapters/candles";
import type { MarketWindow } from "@/lib/adapters/intraday";
import { candlesInRange, type ChartRange } from "@/lib/io/chart-ranges";

/**
 * What GP's area chart draws: the closes over the period, the price its move is
 * measured from, and the period's own open.
 *
 * The move is measured from the close before the period — the previous close
 * on a day, which is how WEI and every board states it, and the last close
 * before the window over a week or a year, which is how a return over it is
 * computed everywhere else on the site. Only where the history starts inside
 * the window is the window's first open the reference. The open is drawn too,
 * as a quieter line: the gap between it and the reference is the night's move.
 */
export interface AreaSeries {
  t: number[];
  c: number[];
  baseline: number | null;
  reference: "previous close" | "prior close" | "open";
  /** The period's first open, drawn beside the reference where it differs. */
  open: number | null;
}

/** Keep exactly the requested session, even at its first bar. */
export function areaFromCandles(candles: Candles, range: ChartRange): AreaSeries {
  const from = candles.t.length - candlesInRange(candles.t, range);
  const open = candles.o[from] ?? candles.c[from] ?? null;
  if (range === "1D") return { t: candles.t.slice(from), c: candles.c.slice(from), baseline: candles.previousClose, reference: "previous close", open };
  const before = from > 0 ? candles.c[from - 1] : null;
  return {
    t: candles.t.slice(from), c: candles.c.slice(from),
    baseline: before != null && before > 0 ? before : open,
    reference: before != null && before > 0 ? "prior close" : "open",
    open,
  };
}

/**
 * WEI and the US index's 1D area consume the very same polled snapshot. The
 * snapshot carries no opening price, so the day's open comes from the session's
 * first candle where the chart has one.
 */
export function areaFromWindow(window: MarketWindow, sessionOpen: number | null = null): AreaSeries {
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
  return { t, c, baseline: window.baseline, reference: "previous close", open: sessionOpen };
}
