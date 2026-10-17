import { ema, sma, rsi, type Line } from "./indicators";

/**
 * The rest of the standard toolkit, as charting platforms define each one:
 * trend (ADX/DMI, Supertrend, Parabolic SAR, Aroon, Hull MA), channels
 * (Keltner, Donchian, the TTM squeeze), momentum (Williams %R, CCI, ROC,
 * Stochastic RSI), volume (OBV, Chaikin money flow, money flow index), floor
 * pivots, and Heikin-Ashi candles.
 *
 * Every output lines up with its input by index and is null until it is
 * defined. Wilder's smoothing where Wilder defined the indicator (ADX, the
 * ATR inside Supertrend and Keltner), as the reference platforms do.
 *
 * Pure.
 */

export interface Ohlcv { o: number[]; h: number[]; l: number[]; c: number[]; v?: number[] }

const empty = (length: number): Line => new Array(length).fill(null);

/** Wilder's running average: the simple average of the first window, then (previous × (n − 1) + value) / n. */
function wilder(values: Line, period: number): Line {
  const out = empty(values.length);
  let previous: number | null = null;
  let seed = 0;
  let seeded = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value == null) continue;
    if (previous == null) {
      seed += value; seeded++;
      if (seeded === period) { previous = seed / period; out[index] = previous; }
      continue;
    }
    previous = (previous * (period - 1) + value) / period;
    out[index] = previous;
  }
  return out;
}

const trueRange = (bars: Ohlcv): Line => bars.c.map((_, index) => (index === 0
  ? bars.h[0] - bars.l[0]
  : Math.max(bars.h[index] - bars.l[index], Math.abs(bars.h[index] - bars.c[index - 1]), Math.abs(bars.l[index] - bars.c[index - 1]))));

export function atrWilder(bars: Ohlcv, period = 14): Line {
  return wilder(trueRange(bars), period);
}

/** Highest and lowest of the last `period` values at each index. */
function rolling(values: number[], period: number, pick: (a: number, b: number) => number): Line {
  return values.map((_, index) => {
    if (index < period - 1) return null;
    let out = values[index];
    for (let back = 1; back < period; back++) out = pick(out, values[index - back]);
    return out;
  });
}
export const highest = (values: number[], period: number) => rolling(values, period, Math.max);
export const lowest = (values: number[], period: number) => rolling(values, period, Math.min);

/* ---- Trend --------------------------------------------------------------- */

export interface Dmi { adx: Line; plus: Line; minus: Line }

/** Wilder's directional movement: +DI and −DI, and the ADX that measures how strongly either leads. */
export function adx(bars: Ohlcv, period = 14): Dmi {
  const n = bars.c.length;
  const up: Line = empty(n), down: Line = empty(n);
  for (let index = 1; index < n; index++) {
    const move = bars.h[index] - bars.h[index - 1];
    const fall = bars.l[index - 1] - bars.l[index];
    up[index] = move > fall && move > 0 ? move : 0;
    down[index] = fall > move && fall > 0 ? fall : 0;
  }
  const range = trueRange(bars);
  range[0] = null;
  const tr = wilder(range, period), plusDm = wilder(up, period), minusDm = wilder(down, period);
  const plus = tr.map((value, index) => (value && plusDm[index] != null ? (100 * plusDm[index]!) / value : null));
  const minus = tr.map((value, index) => (value && minusDm[index] != null ? (100 * minusDm[index]!) / value : null));
  const dx = plus.map((value, index) => {
    const other = minus[index];
    if (value == null || other == null || value + other === 0) return null;
    return (100 * Math.abs(value - other)) / (value + other);
  });
  return { adx: wilder(dx, period), plus, minus };
}

export interface Trail { line: Line; up: Array<boolean | null> }

/** Supertrend: an ATR band that flips side when the close crosses it; `up` while it trails below the price. */
export function supertrend(bars: Ohlcv, period = 10, multiplier = 3): Trail {
  const n = bars.c.length;
  const atr = atrWilder(bars, period);
  const line = empty(n);
  const up: Array<boolean | null> = new Array(n).fill(null);
  let upper: number | null = null, lower: number | null = null, rising = true;
  for (let index = 0; index < n; index++) {
    const range = atr[index];
    if (range == null) continue;
    const middle = (bars.h[index] + bars.l[index]) / 2;
    const basicUpper = middle + multiplier * range;
    const basicLower = middle - multiplier * range;
    const close = bars.c[index - 1] ?? bars.c[index];
    upper = upper == null || basicUpper < upper || close > upper ? basicUpper : upper;
    lower = lower == null || basicLower > lower || close < lower ? basicLower : lower;
    if (rising && bars.c[index] < lower) rising = false;
    else if (!rising && bars.c[index] > upper) rising = true;
    line[index] = rising ? lower : upper;
    up[index] = rising;
  }
  return { line, up };
}

/** Wilder's Parabolic SAR: a stop that accelerates toward the price by 0.02 a new extreme, up to 0.2. */
export function parabolicSar(bars: Ohlcv, step = 0.02, maximum = 0.2): Trail {
  const n = bars.c.length;
  const line = empty(n);
  const up: Array<boolean | null> = new Array(n).fill(null);
  if (n < 2) return { line, up };
  let rising = bars.c[1] >= bars.c[0];
  let sar = rising ? bars.l[0] : bars.h[0];
  let extreme = rising ? bars.h[1] : bars.l[1];
  let factor = step;
  for (let index = 1; index < n; index++) {
    sar = sar + factor * (extreme - sar);
    if (rising) {
      sar = Math.min(sar, bars.l[index - 1], bars.l[index - 2] ?? bars.l[index - 1]);
      if (bars.l[index] < sar) { rising = false; sar = extreme; extreme = bars.l[index]; factor = step; }
      else if (bars.h[index] > extreme) { extreme = bars.h[index]; factor = Math.min(maximum, factor + step); }
    } else {
      sar = Math.max(sar, bars.h[index - 1], bars.h[index - 2] ?? bars.h[index - 1]);
      if (bars.h[index] > sar) { rising = true; sar = extreme; extreme = bars.h[index]; factor = step; }
      else if (bars.l[index] < extreme) { extreme = bars.l[index]; factor = Math.min(maximum, factor + step); }
    }
    line[index] = sar;
    up[index] = rising;
  }
  return { line, up };
}

/** Aroon: how recently, as a share of the window, the highest high and the lowest low were made. */
export function aroon(bars: Ohlcv, period = 25): { up: Line; down: Line } {
  const n = bars.c.length;
  const up = empty(n), down = empty(n);
  for (let index = period; index < n; index++) {
    let high = index, low = index;
    for (let back = index - period; back <= index; back++) {
      if (bars.h[back] >= bars.h[high]) high = back;
      if (bars.l[back] <= bars.l[low]) low = back;
    }
    up[index] = (100 * (period - (index - high))) / period;
    down[index] = (100 * (period - (index - low))) / period;
  }
  return { up, down };
}

/** A weighted average, the most recent value weighing `period`, the oldest 1. */
function wma(values: Line, period: number): Line {
  const out = empty(values.length);
  const weight = (period * (period + 1)) / 2;
  for (let index = period - 1; index < values.length; index++) {
    let sum = 0, ok = true;
    for (let back = 0; back < period; back++) {
      const value = values[index - back];
      if (value == null) { ok = false; break; }
      sum += value * (period - back);
    }
    if (ok) out[index] = sum / weight;
  }
  return out;
}

/** Hull's moving average: little lag, little noise — WMA(2·WMA(n/2) − WMA(n), √n), both halves rounded down as Hull and the platforms do. */
export function hullMa(values: Line, period = 21): Line {
  const half = wma(values, Math.max(1, Math.floor(period / 2)));
  const full = wma(values, period);
  const raw = half.map((value, index) => (value == null || full[index] == null ? null : 2 * value - full[index]!));
  return wma(raw, Math.max(1, Math.floor(Math.sqrt(period))));
}

/* ---- Channels ------------------------------------------------------------ */

export interface Channel { middle: Line; upper: Line; lower: Line }

/** Keltner channel: an EMA of the close with a band of ATR either side (20, 2 × ATR 10). */
export function keltner(bars: Ohlcv, period = 20, multiplier = 2, atrPeriod = 10): Channel {
  const middle = ema(bars.c, period);
  const atr = atrWilder(bars, atrPeriod);
  return {
    middle,
    upper: middle.map((value, index) => (value == null || atr[index] == null ? null : value + multiplier * atr[index]!)),
    lower: middle.map((value, index) => (value == null || atr[index] == null ? null : value - multiplier * atr[index]!)),
  };
}

/** Donchian channel: the highest high and lowest low of the last 20 bars, and their midpoint. */
export function donchian(bars: Ohlcv, period = 20): Channel {
  const upper = highest(bars.h, period), lower = lowest(bars.l, period);
  return { upper, lower, middle: upper.map((value, index) => (value == null || lower[index] == null ? null : (value + lower[index]!) / 2)) };
}

/**
 * The TTM squeeze: on while the Bollinger Bands (20, 2) sit inside the Keltner
 * channel (20, 1.5 ATR); the momentum is the close against the midpoint of the
 * Donchian range and its average, smoothed by a linear regression's last value.
 */
export function squeeze(bars: Ohlcv, period = 20): { on: Array<boolean | null>; momentum: Line } {
  const n = bars.c.length;
  const mid = sma(bars.c, period);
  const deviation = bars.c.map((_, index) => {
    if (index < period - 1 || mid[index] == null) return null;
    let sum = 0;
    for (let back = 0; back < period; back++) sum += (bars.c[index - back] - mid[index]!) ** 2;
    return Math.sqrt(sum / period);
  });
  const channel = keltner(bars, period, 1.5, period);
  const on = bars.c.map((_, index) => (mid[index] == null || deviation[index] == null || channel.upper[index] == null
    ? null
    : mid[index]! + 2 * deviation[index]! < channel.upper[index]! && mid[index]! - 2 * deviation[index]! > channel.lower[index]!));
  const range = donchian(bars, period);
  const delta = bars.c.map((close, index) => (range.middle[index] == null || mid[index] == null ? null : close - (range.middle[index]! + mid[index]!) / 2));
  const momentum = empty(n);
  for (let index = period - 1; index < n; index++) {
    // The value at the end of a least-squares line through the last `period` deltas.
    let sx = 0, sy = 0, sxy = 0, sxx = 0, ok = true;
    for (let k = 0; k < period; k++) {
      const value = delta[index - period + 1 + k];
      if (value == null) { ok = false; break; }
      sx += k; sy += value; sxy += k * value; sxx += k * k;
    }
    if (!ok) continue;
    const slope = (period * sxy - sx * sy) / (period * sxx - sx * sx);
    momentum[index] = (sy - slope * sx) / period + slope * (period - 1);
  }
  return { on, momentum };
}

/* ---- Momentum ------------------------------------------------------------ */

/** Williams %R: where the close sits in the last 14 bars' range, 0 at the top, −100 at the bottom. */
export function williamsR(bars: Ohlcv, period = 14): Line {
  const high = highest(bars.h, period), low = lowest(bars.l, period);
  return bars.c.map((close, index) => (high[index] == null || high[index] === low[index] ? null : (-100 * (high[index]! - close)) / (high[index]! - low[index]!)));
}

/** The commodity channel index: the typical price's distance from its average, in units of 0.015 × the mean deviation. */
export function cci(bars: Ohlcv, period = 20): Line {
  const typical = bars.c.map((close, index) => (bars.h[index] + bars.l[index] + close) / 3);
  const mean = sma(typical, period);
  return typical.map((value, index) => {
    if (mean[index] == null) return null;
    let deviation = 0;
    for (let back = 0; back < period; back++) deviation += Math.abs(typical[index - back] - mean[index]!);
    deviation /= period;
    return deviation ? (value - mean[index]!) / (0.015 * deviation) : null;
  });
}

/** Rate of change: the percent move over the last 12 bars. */
export function roc(values: number[], period = 12): Line {
  return values.map((value, index) => (index < period || !values[index - period] ? null : (value / values[index - period] - 1) * 100));
}

/** Stochastic RSI: the stochastic of RSI 14 over 14 bars, %K smoothed 3, %D 3. */
export function stochRsi(values: number[], period = 14, smoothK = 3, smoothD = 3): { k: Line; d: Line } {
  const strength = rsi(values, period);
  const raw = strength.map((value, index) => {
    if (value == null || index < period - 1) return null;
    let high = -Infinity, low = Infinity;
    for (let back = 0; back < period; back++) {
      const other = strength[index - back];
      if (other == null) return null;
      high = Math.max(high, other); low = Math.min(low, other);
    }
    return high === low ? 0 : (100 * (value - low)) / (high - low);
  });
  const k = sma(raw, smoothK);
  return { k, d: sma(k, smoothD) };
}

/* ---- Volume -------------------------------------------------------------- */

/** On-balance volume: the volume added on an up close and taken away on a down one. */
export function obv(bars: Ohlcv): Line {
  if (!bars.v?.length) return empty(bars.c.length);
  let total = 0;
  return bars.c.map((close, index) => {
    if (index > 0) total += close > bars.c[index - 1] ? bars.v![index] : close < bars.c[index - 1] ? -bars.v![index] : 0;
    return total;
  });
}

/** Chaikin money flow: the share of the last 20 bars' volume that closed in the upper half of its range, from −1 to 1. */
export function chaikinMoneyFlow(bars: Ohlcv, period = 20): Line {
  if (!bars.v?.length) return empty(bars.c.length);
  const flow = bars.c.map((close, index) => {
    const range = bars.h[index] - bars.l[index];
    return range ? (((close - bars.l[index]) - (bars.h[index] - close)) / range) * bars.v![index] : 0;
  });
  return bars.c.map((_, index) => {
    if (index < period - 1) return null;
    let money = 0, volume = 0;
    for (let back = 0; back < period; back++) { money += flow[index - back]; volume += bars.v![index - back]; }
    return volume ? money / volume : null;
  });
}

/** The money flow index: an RSI of typical price weighted by volume, 0 to 100. */
export function moneyFlowIndex(bars: Ohlcv, period = 14): Line {
  if (!bars.v?.length) return empty(bars.c.length);
  const typical = bars.c.map((close, index) => (bars.h[index] + bars.l[index] + close) / 3);
  return typical.map((_, index) => {
    if (index < period) return null;
    let positive = 0, negative = 0;
    for (let back = 0; back < period; back++) {
      const at = index - back;
      const money = typical[at] * bars.v![at];
      if (typical[at] > typical[at - 1]) positive += money;
      else if (typical[at] < typical[at - 1]) negative += money;
    }
    return negative === 0 ? 100 : 100 - 100 / (1 + positive / negative);
  });
}

/* ---- Levels and candles -------------------------------------------------- */

export interface Pivots { p: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number }

/** Classic floor pivots from one period's high, low and close. */
export function floorPivots(high: number, low: number, close: number): Pivots {
  const p = (high + low + close) / 3;
  return { p, r1: 2 * p - low, s1: 2 * p - high, r2: p + (high - low), s2: p - (high - low), r3: high + 2 * (p - low), s3: low - 2 * (high - p) };
}

/** Heikin-Ashi candles: each the average of the bar and the one before, which smooths a trend into runs of one colour. */
export function heikinAshi(bars: Ohlcv): { o: number[]; h: number[]; l: number[]; c: number[] } {
  const o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [];
  for (let index = 0; index < bars.c.length; index++) {
    const close = (bars.o[index] + bars.h[index] + bars.l[index] + bars.c[index]) / 4;
    const open = index === 0 ? (bars.o[0] + bars.c[0]) / 2 : (o[index - 1] + c[index - 1]) / 2;
    o.push(open); c.push(close);
    h.push(Math.max(bars.h[index], open, close));
    l.push(Math.min(bars.l[index], open, close));
  }
  return { o, h, l, c };
}
