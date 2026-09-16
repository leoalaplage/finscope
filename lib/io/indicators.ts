/**
 * Technical indicators over a series of bars, as the chart page draws them.
 *
 * Every function returns one value per bar, null where the indicator is not
 * yet defined, so an output lines up with its input by index and the chart can
 * drop the nulls rather than draw them at zero. The definitions are the ones
 * charting platforms use: Wilder's smoothing for RSI and ATR, an EMA seeded
 * with the SMA of its first window, a population standard deviation for
 * Bollinger Bands.
 */

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number | null }

export type Line = Array<number | null>;

export function sma(values: Line, period: number): Line {
  const out: Line = new Array(values.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  let count = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value == null) { sum = 0; count = 0; continue; }
    sum += value;
    count++;
    if (count > period) { sum -= values[index - period]!; count = period; }
    if (count === period) out[index] = sum / period;
  }
  return out;
}

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

/** Wilder's moving average, which RSI and ATR are defined on. */
function wilder(values: Line, period: number): Line {
  const out: Line = new Array(values.length).fill(null);
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
    previous = (previous * (period - 1) + value) / period;
    out[index] = previous;
  }
  return out;
}

export function bollinger(values: Line, period: number, width: number): { middle: Line; upper: Line; lower: Line } {
  const middle = sma(values, period);
  const upper: Line = new Array(values.length).fill(null);
  const lower: Line = new Array(values.length).fill(null);
  for (let index = period - 1; index < values.length; index++) {
    const mean = middle[index];
    if (mean == null) continue;
    let squares = 0;
    for (let back = index - period + 1; back <= index; back++) squares += (values[back]! - mean) ** 2;
    const deviation = Math.sqrt(squares / period);
    upper[index] = mean + width * deviation;
    lower[index] = mean - width * deviation;
  }
  return { middle, upper, lower };
}

export function rsi(values: Line, period: number): Line {
  const gains: Line = values.map(() => null);
  const losses: Line = values.map(() => null);
  for (let index = 1; index < values.length; index++) {
    const now = values[index], before = values[index - 1];
    if (now == null || before == null) continue;
    gains[index] = Math.max(now - before, 0);
    losses[index] = Math.max(before - now, 0);
  }
  const up = wilder(gains, period);
  const down = wilder(losses, period);
  return values.map((_, index) => {
    const gain = up[index], loss = down[index];
    if (gain == null || loss == null) return null;
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
  });
}

export function macd(values: Line, fast: number, slow: number, signal: number): { macd: Line; signal: Line; histogram: Line } {
  const quick = ema(values, fast);
  const long = ema(values, slow);
  const line: Line = values.map((_, index) => (quick[index] == null || long[index] == null ? null : quick[index]! - long[index]!));
  const trigger = ema(line, signal);
  return {
    macd: line,
    signal: trigger,
    histogram: line.map((value, index) => (value == null || trigger[index] == null ? null : value - trigger[index]!)),
  };
}

/** Slow stochastic: %K over the window, smoothed, and %D as its average. */
export function stochastic(bars: Bar[], period: number, smoothK: number, smoothD: number): { k: Line; d: Line } {
  const raw: Line = bars.map((bar, index) => {
    if (index < period - 1) return null;
    let high = -Infinity, low = Infinity;
    for (let back = index - period + 1; back <= index; back++) {
      high = Math.max(high, bars[back].high);
      low = Math.min(low, bars[back].low);
    }
    return high === low ? 50 : (100 * (bar.close - low)) / (high - low);
  });
  const k = sma(raw, smoothK);
  return { k, d: sma(k, smoothD) };
}

export function atr(bars: Bar[], period: number): Line {
  const ranges: Line = bars.map((bar, index) => {
    if (index === 0) return bar.high - bar.low;
    const close = bars[index - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - close), Math.abs(bar.low - close));
  });
  return wilder(ranges, period);
}

/**
 * Volume-weighted average price, restarted at each session.
 *
 * `sessionOf` names the period a bar belongs to — its day for intraday bars —
 * and the running totals start again when it changes. Bars without volume
 * leave the average where it was.
 */
export function vwap(bars: Bar[], sessionOf: (bar: Bar) => string | number): Line {
  let session: string | number | null = null;
  let priced = 0;
  let traded = 0;
  return bars.map((bar) => {
    const current = sessionOf(bar);
    if (current !== session) { session = current; priced = 0; traded = 0; }
    const typical = (bar.high + bar.low + bar.close) / 3;
    if (bar.volume != null && bar.volume > 0) { priced += typical * bar.volume; traded += bar.volume; }
    return traded > 0 ? priced / traded : null;
  });
}

/** Heikin Ashi bars, drawn in place of the real ones when asked. */
export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const [index, bar] of bars.entries()) {
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = index === 0 ? (bar.open + bar.close) / 2 : (out[index - 1].open + out[index - 1].close) / 2;
    out.push({ ...bar, open, close, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close) });
  }
  return out;
}

/* ---- Fibonacci ------------------------------------------------------- */

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
export const FIB_EXTENSIONS = [1.272, 1.618] as const;

export interface FibLevel { ratio: number; price: number }

/**
 * Retracement levels of a move from one price to another.
 *
 * Measured back from where the move ended, as every platform labels them: on
 * a rise from 100 to 200, 0% is 200, 61.8% is 138.2 and 100% is 100. The
 * extensions carry on beyond the start.
 */
export function fibonacciLevels(from: number, to: number, extensions = false): FibLevel[] {
  const ratios: number[] = [...FIB_RATIOS, ...(extensions ? FIB_EXTENSIONS : [])];
  return ratios.map((ratio) => ({ ratio, price: to - (to - from) * ratio }));
}

export interface Swing { from: { time: number; price: number }; to: { time: number; price: number } }

/**
 * The move a retracement is drawn on, found in a stretch of bars.
 *
 * The highest high and the lowest low of the stretch; whichever came later is
 * where the move ended. A stretch that fell to its low after its high is read
 * as a decline, and its levels are measured back up from the low.
 */
export function autoSwing(bars: Bar[]): Swing | null {
  if (bars.length < 2) return null;
  let high = 0, low = 0;
  for (let index = 1; index < bars.length; index++) {
    if (bars[index].high > bars[high].high) high = index;
    if (bars[index].low < bars[low].low) low = index;
  }
  if (bars[high].high === bars[low].low) return null;
  const top = { time: bars[high].time, price: bars[high].high };
  const bottom = { time: bars[low].time, price: bars[low].low };
  return high > low ? { from: bottom, to: top } : { from: top, to: bottom };
}
