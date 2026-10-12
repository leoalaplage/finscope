import type { Pivot, Point, Series } from "./technicals";

/**
 * Chart patterns found in the candles on screen, the way a technician draws
 * them: a line through the recent highs and one through the recent lows, and
 * what their slopes make — a triangle, a wedge, a channel — or a sequence of
 * swings that makes a double top or bottom, or a head and shoulders.
 *
 * Every test is in average true ranges, so the same rule reads a calm utility
 * and a volatile chip maker. A pattern the price has already left by more
 * than a breakout is not drawn; one it is leaving says so, with the measured
 * target the textbooks give (the pattern's height from the breakout).
 *
 * Pure: candles and their pivots in, patterns out.
 */

export type ChartPatternKind =
  | "symmetricalTriangle" | "ascendingTriangle" | "descendingTriangle"
  | "risingWedge" | "fallingWedge"
  | "channelUp" | "channelDown" | "range"
  | "doubleTop" | "doubleBottom" | "headAndShoulders" | "inverseHeadAndShoulders";

export const CHART_PATTERN_NAMES: Record<ChartPatternKind, { name: string; bullish: boolean | null }> = {
  symmetricalTriangle: { name: "Symmetrical triangle", bullish: null },
  ascendingTriangle: { name: "Ascending triangle", bullish: true },
  descendingTriangle: { name: "Descending triangle", bullish: false },
  risingWedge: { name: "Rising wedge", bullish: false },
  fallingWedge: { name: "Falling wedge", bullish: true },
  channelUp: { name: "Channel up", bullish: true },
  channelDown: { name: "Channel down", bullish: false },
  range: { name: "Range", bullish: null },
  doubleTop: { name: "Double top", bullish: false },
  doubleBottom: { name: "Double bottom", bullish: true },
  headAndShoulders: { name: "Head and shoulders", bullish: false },
  inverseHeadAndShoulders: { name: "Inverse head and shoulders", bullish: true },
};

export interface Segment { a: Point; b: Point }

export interface ChartPattern {
  kind: ChartPatternKind;
  /** The pattern's lines: upper and lower bound, or the neckline. */
  lines: Segment[];
  /** The swings that make it, for the markers. */
  points: Point[];
  start: number;
  /** Where the price has left it, on the last candle; null while it is still inside. */
  breakout: "up" | "down" | null;
  /** The measured move from the breakout level, where the pattern has one. */
  target: number | null;
}

const at = (line: Segment, index: number) => line.a.price + ((line.b.price - line.a.price) * (index - line.a.index)) / (line.b.index - line.a.index || 1);

/** A least-squares line through some pivots, written as its two ends. */
function fit(points: Point[], from: number, to: number): Segment {
  const n = points.length;
  const sx = points.reduce((sum, point) => sum + point.index, 0);
  const sy = points.reduce((sum, point) => sum + point.price, 0);
  const sxx = points.reduce((sum, point) => sum + point.index * point.index, 0);
  const sxy = points.reduce((sum, point) => sum + point.index * point.price, 0);
  const slope = n > 1 ? (n * sxy - sx * sy) / (n * sxx - sx * sx || 1) : 0;
  const intercept = (sy - slope * sx) / n;
  return { a: { index: from, price: intercept + slope * from }, b: { index: to, price: intercept + slope * to } };
}

const slopeOf = (line: Segment) => (line.b.price - line.a.price) / (line.b.index - line.a.index || 1);

/**
 * Triangles, wedges, channels and ranges: the bounds through the last two or
 * three swing highs and lows, kept only where the candles respect them.
 */
function bounded(series: Series, found: Pivot[], atr: number, window: number): ChartPattern | null {
  const n = series.c.length;
  const last = n - 1;
  const from = Math.max(0, n - window);
  const highs = found.filter((pivot) => pivot.kind === "high" && pivot.index >= from);
  const lows = found.filter((pivot) => pivot.kind === "low" && pivot.index >= from);
  if (highs.length < 2 || lows.length < 2) return null;
  const tolerance = atr * 0.6;
  let best: { pattern: ChartPattern; score: number } | null = null;

  for (const countHigh of [3, 2]) {
    for (const countLow of [3, 2]) {
      const top = highs.slice(-countHigh), bottom = lows.slice(-countLow);
      if (top.length < countHigh || bottom.length < countLow) continue;
      const start = Math.min(top[0].index, bottom[0].index);
      if (last - start < 15) continue;
      const upper = fit(top, start, last);
      const lower = fit(bottom, start, last);
      // The swings must sit on their line.
      if (top.some((point) => Math.abs(point.price - at(upper, point.index)) > tolerance)) continue;
      if (bottom.some((point) => Math.abs(point.price - at(lower, point.index)) > tolerance)) continue;
      // And the candles between them, all but the last three (a breakout), inside the lines.
      let inside = true;
      for (let index = start; index <= last - 3 && inside; index++) {
        if (series.h[index] > at(upper, index) + tolerance || series.l[index] < at(lower, index) - tolerance) inside = false;
      }
      if (!inside) continue;
      const widthStart = at(upper, start) - at(lower, start);
      const widthEnd = at(upper, last) - at(lower, last);
      if (widthStart <= atr || widthEnd <= 0) continue;

      const span = last - start;
      const rise = (line: Segment) => slopeOf(line) * span;
      const flat = (line: Segment) => Math.abs(rise(line)) < atr * 1.2;
      const up = (line: Segment) => rise(line) >= atr * 1.2;
      const down = (line: Segment) => rise(line) <= -atr * 1.2;
      const converging = widthEnd < widthStart * 0.7;
      const parallel = Math.abs(widthEnd - widthStart) < widthStart * 0.3;

      let kind: ChartPatternKind | null = null;
      if (converging && down(upper) && up(lower)) kind = "symmetricalTriangle";
      else if (converging && flat(upper) && up(lower)) kind = "ascendingTriangle";
      else if (converging && down(upper) && flat(lower)) kind = "descendingTriangle";
      else if (converging && up(upper) && up(lower)) kind = "risingWedge";
      else if (converging && down(upper) && down(lower)) kind = "fallingWedge";
      else if (parallel && up(upper) && up(lower)) kind = "channelUp";
      else if (parallel && down(upper) && down(lower)) kind = "channelDown";
      else if (parallel && flat(upper) && flat(lower)) kind = "range";
      if (!kind) continue;

      const close = series.c[last];
      const breakout = close > at(upper, last) + tolerance * 0.5 ? "up" : close < at(lower, last) - tolerance * 0.5 ? "down" : null;
      const target = breakout === "up" ? at(upper, last) + widthStart : breakout === "down" ? at(lower, last) - widthStart : null;
      const score = top.length + bottom.length + span / 50;
      if (!best || score > best.score) {
        best = { pattern: { kind, lines: [upper, lower], points: [...top, ...bottom], start, breakout, target }, score };
      }
    }
  }
  return best?.pattern ?? null;
}

/** Double tops and bottoms, and heads and shoulders, from the last swings. */
function reversals(series: Series, found: Pivot[], atr: number, window: number): ChartPattern | null {
  const n = series.c.length;
  const last = n - 1;
  const from = Math.max(0, n - window);
  const swings = found.filter((pivot) => pivot.index >= from);
  const close = series.c[last];
  const near = (a: number, b: number) => Math.abs(a - b) <= atr * 0.8;

  for (const side of ["high", "low"] as const) {
    const peaks = swings.filter((pivot) => pivot.kind === side);
    const troughs = swings.filter((pivot) => pivot.kind !== side);
    const higher = (a: number, b: number) => (side === "high" ? a > b : a < b);
    const deep = (peak: number, trough: number) => Math.abs(peak - trough) >= atr * 2;

    // Head and shoulders: three peaks, the middle beyond both, the shoulders level.
    if (peaks.length >= 3) {
      const [left, head, right] = peaks.slice(-3);
      const dips = [troughs.filter((pivot) => pivot.index > left.index && pivot.index < head.index).at(-1), troughs.filter((pivot) => pivot.index > head.index && pivot.index < right.index).at(-1)];
      if (dips[0] && dips[1] && higher(head.price, left.price) && higher(head.price, right.price) && near(left.price, right.price)
        && deep(head.price, dips[0].price) && deep(head.price, dips[1].price) && head.index - left.index >= 5 && right.index - head.index >= 5) {
        const neckline: Segment = { a: dips[0], b: dips[1] };
        const line: Segment = { a: dips[0], b: { index: last, price: at(neckline, last) } };
        const level = at(neckline, last);
        const height = Math.abs(head.price - at(neckline, head.index));
        const broken = side === "high" ? close < level - atr * 0.3 : close > level + atr * 0.3;
        const kind = side === "high" ? "headAndShoulders" : "inverseHeadAndShoulders";
        return {
          kind, lines: [line], points: [left, dips[0], head, dips[1], right], start: left.index,
          breakout: broken ? (side === "high" ? "down" : "up") : null,
          target: broken ? (side === "high" ? level - height : level + height) : null,
        };
      }
    }
    // Double top or bottom: two level peaks with a real trough between.
    if (peaks.length >= 2) {
      const [first, second] = peaks.slice(-2);
      const dip = troughs.filter((pivot) => pivot.index > first.index && pivot.index < second.index)
        .sort((a, b) => (side === "high" ? a.price - b.price : b.price - a.price))[0];
      if (dip && near(first.price, second.price) && deep(first.price, dip.price) && second.index - first.index >= 8 && last - second.index <= window / 3) {
        const level = dip.price;
        const height = Math.abs((first.price + second.price) / 2 - level);
        const broken = side === "high" ? close < level - atr * 0.3 : close > level + atr * 0.3;
        return {
          kind: side === "high" ? "doubleTop" : "doubleBottom",
          lines: [{ a: { index: first.index, price: level }, b: { index: last, price: level } }],
          points: [first, dip, second], start: first.index,
          breakout: broken ? (side === "high" ? "down" : "up") : null,
          target: broken ? (side === "high" ? level - height : level + height) : null,
        };
      }
    }
  }
  return null;
}

/** The patterns in the last `window` candles: at most one of bounds and one reversal, newest first. */
export function chartPatterns(series: Series, found: Pivot[], atr: number, window = 120): ChartPattern[] {
  if (!(atr > 0) || series.c.length < 30) return [];
  return [bounded(series, found, atr, window), reversals(series, found, atr, window)].filter((pattern): pattern is ChartPattern => pattern != null);
}
