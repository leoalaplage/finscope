/**
 * The averages the chart page draws over its candles.
 *
 * One value per input, null until the average is defined, so an output lines
 * up with its input by index. The EMA is the one charting platforms use:
 * seeded with the simple average of its first window, then weighted 2/(n+1).
 */

export type Line = Array<number | null>;

/** The averages drawn on every chart, shortest first. */
export const CHART_EMAS = [20, 50, 200] as const;

export function ema(values: Line, period: number): Line {
  const out: Line = new Array(values.length).fill(null);
  if (period < 1) return out;
  const k = 2 / (period + 1);
  let previous: number | null = null;
  let seed = 0;
  let seeded = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value == null) continue;
    if (previous == null) {
      seed += value;
      seeded++;
      if (seeded === period) { previous = seed / period; out[index] = previous; }
      continue;
    }
    previous = value * k + previous * (1 - k);
    out[index] = previous;
  }
  return out;
}
