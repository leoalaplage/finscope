import { ema, sma, type Line } from "@/lib/io/indicators";

/**
 * A relative rotation graph: where each sector stands against the market on
 * two scales, and which way it is heading.
 *
 * The x scale is relative strength — the sector's price over the market's —
 * against its own recent average; the y scale is the momentum of that, the
 * x value against its own recent average. Both are written as z-scores about
 * 100, which is how the published RRG is centred; the published formula is
 * proprietary and this is the widely used open approximation of it, so the
 * picture is read for its quadrant and its direction, not its decimals.
 *
 * Right and up is leading, right and down weakening, left and down lagging,
 * left and up improving; sectors tend to turn clockwise through them.
 */

export type Quadrant = "leading" | "weakening" | "lagging" | "improving";
export interface RotationPoint { t: number; ratio: number; momentum: number }

function deviation(values: Line, period: number): Line {
  const mean = sma(values, period);
  return values.map((value, index) => {
    if (value == null || mean[index] == null || index < period - 1) return null;
    let squares = 0;
    for (let back = index - period + 1; back <= index; back++) squares += ((values[back] ?? mean[index]!) - mean[index]!) ** 2;
    return Math.sqrt(squares / period);
  });
}

function zScore(values: Line, period: number): Line {
  const mean = sma(values, period);
  const spread = deviation(values, period);
  return values.map((value, index) => (value == null || mean[index] == null || !spread[index] ? null : 100 + (value - mean[index]!) / spread[index]!));
}

/**
 * The sector's path, aligned on the bars both have, newest last.
 *
 * Relative strength is smoothed first and scored against half a year of
 * itself, momentum scored against ten bars of the ratio and smoothed again:
 * raw z-scores over short windows jump a whole quadrant from one bar to the
 * next, and a tail that does that shows noise rather than rotation.
 */
export function rotation(sector: { t: number[]; c: number[] }, market: { t: number[]; c: number[] }, strengthPeriod = 26, momentumPeriod = 10): RotationPoint[] {
  const closes = new Map(market.t.map((time, index) => [time, market.c[index]]));
  const times: number[] = [];
  const relative: number[] = [];
  sector.t.forEach((time, index) => {
    const against = closes.get(time);
    if (against) { times.push(time); relative.push((sector.c[index] / against) * 100); }
  });
  const ratio = zScore(ema(relative, 4), strengthPeriod);
  const momentum = ema(zScore(ratio, momentumPeriod), 3);
  return times.flatMap((t, index) => (ratio[index] != null && momentum[index] != null ? [{ t, ratio: ratio[index]!, momentum: momentum[index]! }] : []));
}

export function quadrantOf(point: { ratio: number; momentum: number }): Quadrant {
  if (point.ratio >= 100) return point.momentum >= 100 ? "leading" : "weakening";
  return point.momentum >= 100 ? "improving" : "lagging";
}
