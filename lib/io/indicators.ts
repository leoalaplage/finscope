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

export interface Bars { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v?: number[] }

/** Lane's stochastic: where the close sits in the range of the last n bars, %K smoothed, and %D its average. */
export function stochastic(bars: Bars, period = 14, smoothK = 3, smoothD = 3): { k: Line; d: Line } {
  const raw: Line = bars.c.map((close, index) => {
    if (index < period - 1) return null;
    let high = -Infinity;
    let low = Infinity;
    for (let back = index - period + 1; back <= index; back++) {
      high = Math.max(high, bars.h[back]);
      low = Math.min(low, bars.l[back]);
    }
    return high === low ? 50 : ((close - low) / (high - low)) * 100;
  });
  const k = sma(raw, smoothK);
  return { k, d: sma(k, smoothD) };
}

export interface Ichimoku { tenkan: Line; kijun: Line; spanA: Line; spanB: Line }

const midpoint = (bars: Bars, index: number, period: number) => {
  if (index < period - 1) return null;
  let high = -Infinity;
  let low = Infinity;
  for (let back = index - period + 1; back <= index; back++) {
    high = Math.max(high, bars.h[back]);
    low = Math.min(low, bars.l[back]);
  }
  return (high + low) / 2;
};

/**
 * Hosoda's Ichimoku: the 9- and 26-bar midpoints, and the cloud between their
 * average and the 52-bar midpoint, each plotted 26 bars ahead — so the cloud
 * under a candle is the one computed 26 bars earlier.
 */
export function ichimoku(bars: Bars, conversion = 9, base = 26, leading = 52): Ichimoku {
  const tenkan = bars.c.map((_, index) => midpoint(bars, index, conversion));
  const kijun = bars.c.map((_, index) => midpoint(bars, index, base));
  const spanA: Line = bars.c.map((_, index) => {
    const from = index - base;
    return from >= 0 && tenkan[from] != null && kijun[from] != null ? (tenkan[from]! + kijun[from]!) / 2 : null;
  });
  const spanB: Line = bars.c.map((_, index) => (index - base >= 0 ? midpoint(bars, index - base, leading) : null));
  return { tenkan, kijun, spanA, spanB };
}

/**
 * Volume-weighted average price from an anchor.
 *
 * With `sessions`, it starts again at each new trading day, the intraday VWAP
 * desks watch; without, it runs from the first bar given, an anchored VWAP.
 */
export function vwap(bars: Bars, sessions: boolean): Line {
  const out: Line = new Array(bars.c.length).fill(null);
  if (!bars.v) return out;
  let price = 0;
  let volume = 0;
  let day = -1;
  for (let index = 0; index < bars.c.length; index++) {
    const today = Math.floor(bars.t[index] / 86_400);
    if (sessions && today !== day) { price = 0; volume = 0; day = today; }
    const typical = (bars.h[index] + bars.l[index] + bars.c[index]) / 3;
    price += typical * (bars.v[index] ?? 0);
    volume += bars.v[index] ?? 0;
    out[index] = volume > 0 ? price / volume : null;
  }
  return out;
}

export interface ProfileBin { low: number; high: number; volume: number }

/**
 * Volume at price: each bar's volume spread evenly over the part of its range
 * that falls in each bin. The bin with the most is the point of control.
 */
export function volumeProfile(bars: Bars, low: number, high: number, bins = 24): ProfileBin[] {
  const size = (high - low) / bins;
  const out: ProfileBin[] = Array.from({ length: bins }, (_, index) => ({ low: low + index * size, high: low + (index + 1) * size, volume: 0 }));
  if (!bars.v || size <= 0) return out;
  for (let index = 0; index < bars.c.length; index++) {
    const top = bars.h[index];
    const bottom = bars.l[index];
    const traded = bars.v[index] ?? 0;
    if (!traded) continue;
    if (top === bottom) {
      const bin = Math.min(bins - 1, Math.max(0, Math.floor((top - low) / size)));
      out[bin].volume += traded;
      continue;
    }
    for (const bin of out) {
      const overlap = Math.min(top, bin.high) - Math.max(bottom, bin.low);
      if (overlap > 0) bin.volume += traded * (overlap / (top - bottom));
    }
  }
  return out;
}

export type Pattern = "bullEngulfing" | "bearEngulfing" | "hammer" | "shootingStar" | "doji" | "morningStar" | "eveningStar";

export const PATTERN_NAMES: Record<Pattern, { short: string; name: string; bullish: boolean | null }> = {
  bullEngulfing: { short: "BE", name: "Bullish engulfing", bullish: true },
  bearEngulfing: { short: "BE", name: "Bearish engulfing", bullish: false },
  hammer: { short: "H", name: "Hammer", bullish: true },
  shootingStar: { short: "SS", name: "Shooting star", bullish: false },
  doji: { short: "D", name: "Doji", bullish: null },
  morningStar: { short: "MS", name: "Morning star", bullish: true },
  eveningStar: { short: "ES", name: "Evening star", bullish: false },
};

/**
 * The classic candle patterns at one bar, by their textbook definitions.
 *
 * A hammer or shooting star has to come after a move the other way (the close
 * below or above its 10-bar average), because a hammer at the top of a rise is
 * a hanging man and means the opposite.
 */
export function patternsAt(bars: Bars, index: number, trend?: Line): Pattern[] {
  if (index < 2) return [];
  const o = bars.o[index], h = bars.h[index], l = bars.l[index], c = bars.c[index];
  const range = h - l;
  if (range <= 0) return [];
  const body = Math.abs(c - o);
  const upper = h - Math.max(o, c);
  const lower = Math.min(o, c) - l;
  const po = bars.o[index - 1], pc = bars.c[index - 1];
  const average = trend?.[index] ?? null;
  const falling = average != null && c < average;
  const rising = average != null && c > average;
  const found: Pattern[] = [];

  if (pc < po && c > o && o <= pc && c >= po && body > Math.abs(pc - po)) found.push("bullEngulfing");
  if (pc > po && c < o && o >= pc && c <= po && body > Math.abs(pc - po)) found.push("bearEngulfing");
  if (body <= range * 0.35 && lower >= body * 2 && upper <= range * 0.15 && falling) found.push("hammer");
  if (body <= range * 0.35 && upper >= body * 2 && lower <= range * 0.15 && rising) found.push("shootingStar");
  if (body <= range * 0.08) found.push("doji");

  const ao = bars.o[index - 2], ac = bars.c[index - 2];
  const firstBody = Math.abs(ac - ao);
  const middleBody = Math.abs(pc - po);
  if (ac < ao && middleBody < firstBody * 0.4 && Math.max(po, pc) < ac && c > o && c > (ao + ac) / 2) found.push("morningStar");
  if (ac > ao && middleBody < firstBody * 0.4 && Math.min(po, pc) > ac && c < o && c < (ao + ac) / 2) found.push("eveningStar");
  return found;
}
