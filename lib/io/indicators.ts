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

/** The simple average of the last `period` values, null until there are that many. */
export function sma(values: Line, period: number): Line {
  const out: Line = new Array(values.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  const window: number[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value == null) continue;
    window.push(value);
    sum += value;
    if (window.length > period) sum -= window.shift()!;
    if (window.length === period) out[index] = sum / period;
  }
  return out;
}

export interface Bands { middle: Line; upper: Line; lower: Line }

/**
 * Bollinger Bands: a simple average and the population standard deviation of
 * the same window either side of it, the way John Bollinger defines them and
 * every charting platform draws them — 20 periods, 2 deviations.
 */
export function bollinger(values: Line, period = 20, width = 2): Bands {
  const middle = sma(values, period);
  const upper: Line = new Array(values.length).fill(null);
  const lower: Line = new Array(values.length).fill(null);
  for (let index = period - 1; index < values.length; index++) {
    const mean = middle[index];
    if (mean == null) continue;
    let squares = 0;
    let counted = 0;
    for (let back = index; back >= 0 && counted < period; back--) {
      const value = values[back];
      if (value == null) continue;
      squares += (value - mean) ** 2;
      counted++;
    }
    const deviation = Math.sqrt(squares / period);
    upper[index] = mean + width * deviation;
    lower[index] = mean - width * deviation;
  }
  return { middle, upper, lower };
}

/**
 * Wilder's relative strength index: the average gain against the average
 * loss, each smoothed by 1/n after a simple first window, on a 0–100 scale.
 */
export function rsi(values: number[], period = 14): Line {
  const out: Line = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = values[index] - values[index - 1];
    if (change > 0) gain += change; else loss -= change;
  }
  gain /= period;
  loss /= period;
  const index0 = period;
  out[index0] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let index = period + 1; index < values.length; index++) {
    const change = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export interface Macd { macd: Line; signal: Line; histogram: Line }

/** Appel's MACD: the 12-period EMA less the 26, its own 9-period EMA, and the gap between them. */
export function macd(values: number[], fast = 12, slow = 26, smoothing = 9): Macd {
  const quick = ema(values, fast);
  const steady = ema(values, slow);
  const line: Line = values.map((_, index) => (quick[index] == null || steady[index] == null ? null : quick[index]! - steady[index]!));
  const signal = ema(line, smoothing);
  const histogram: Line = line.map((value, index) => (value == null || signal[index] == null ? null : value - signal[index]!));
  return { macd: line, signal, histogram };
}
