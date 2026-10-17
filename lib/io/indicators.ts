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

export interface Ichimoku { tenkan: Line; kijun: Line; spanA: Line; spanB: Line; lagging: Line; shift: number }

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
 * Hosoda's Ichimoku as the reference platforms plot it: the 9- and 26-bar
 * midpoints; the cloud between their average and the 52-bar midpoint, moved
 * 26 bars on — the bar it is computed on counting as the first, so 25 places —
 * and drawn that far past the last candle; and the lagging span, the close
 * moved as far back. The spans are `shift` longer than the bars.
 */
export function ichimoku(bars: Bars, conversion = 9, base = 26, leading = 52): Ichimoku {
  const shift = Math.max(0, base - 1);
  const n = bars.c.length;
  const tenkan = bars.c.map((_, index) => midpoint(bars, index, conversion));
  const kijun = bars.c.map((_, index) => midpoint(bars, index, base));
  const spanA: Line = Array.from({ length: n + shift }, (_, index) => {
    const from = index - shift;
    return from >= 0 && from < n && tenkan[from] != null && kijun[from] != null ? (tenkan[from]! + kijun[from]!) / 2 : null;
  });
  const spanB: Line = Array.from({ length: n + shift }, (_, index) => {
    const from = index - shift;
    return from >= 0 && from < n ? midpoint(bars, from, leading) : null;
  });
  const lagging: Line = bars.c.map((_, index) => (index + shift < n ? bars.c[index + shift] : null));
  return { tenkan, kijun, spanA, spanB, lagging, shift };
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

export interface ProfileBin { low: number; high: number; volume: number; /** The part traded on bars that closed up. */ up: number }

/**
 * Volume at price over the bars given, in `bins` rows between `low` and
 * `high`: each bar's volume spread evenly over the part of its range that
 * falls in each row, as the platforms build a visible-range profile. Given
 * bars finer than the chart's own (hours under days), the spread is far
 * closer to where the shares actually changed hands; the caller passes the
 * finest it has (volumeSources).
 */
export function volumeProfile(bars: Bars, low: number, high: number, bins = 24): ProfileBin[] {
  const size = (high - low) / bins;
  const out: ProfileBin[] = Array.from({ length: bins }, (_, index) => ({ low: low + index * size, high: low + (index + 1) * size, volume: 0, up: 0 }));
  if (!bars.v || size <= 0) return out;
  for (let index = 0; index < bars.c.length; index++) {
    const top = Math.min(bars.h[index], high);
    const bottom = Math.max(bars.l[index], low);
    const traded = bars.v[index] ?? 0;
    if (!traded || top < bottom) continue;
    const rising = bars.c[index] >= bars.o[index];
    const span = bars.h[index] - bars.l[index];
    const first = Math.min(bins - 1, Math.max(0, Math.floor((bottom - low) / size)));
    const last = Math.min(bins - 1, Math.max(0, Math.floor((top - low) / size)));
    for (let bin = first; bin <= last; bin++) {
      // A bar with no range trades at one price; otherwise in proportion to the overlap.
      const share = span <= 0 ? 1 : Math.max(0, Math.min(bars.h[index], out[bin].high) - Math.max(bars.l[index], out[bin].low)) / span;
      if (share <= 0) continue;
      out[bin].volume += traded * share;
      if (rising) out[bin].up += traded * share;
    }
  }
  return out;
}

/**
 * The point of control (the row with the most volume) and the value area: the
 * rows around it holding `share` of the volume (70% by convention), grown one
 * row at a time toward the side with more, as Steidlmayer's market profile
 * defines it.
 */
export function valueArea(bins: ProfileBin[], share = 0.7): { poc: number; from: number; to: number } | null {
  const total = bins.reduce((sum, bin) => sum + bin.volume, 0);
  if (!total) return null;
  let poc = 0;
  bins.forEach((bin, index) => { if (bin.volume > bins[poc].volume) poc = index; });
  let from = poc, to = poc, held = bins[poc].volume;
  while (held < total * share && (from > 0 || to < bins.length - 1)) {
    const below = from > 0 ? bins[from - 1].volume : -1;
    const above = to < bins.length - 1 ? bins[to + 1].volume : -1;
    if (above >= below) { to++; held += bins[to].volume; } else { from--; held += bins[from].volume; }
  }
  return { poc, from, to };
}

/**
 * The bars a profile is built from: within [start, end), the finest series
 * first, and each coarser one only where no finer series reaches — an hour's
 * bars for the last year of a daily chart, the days themselves before that.
 * `series` runs from finest to coarsest; the chart's own bars come last.
 */
export function volumeSources(series: Bars[], start: number, end: number): Bars {
  const out: Bars = { t: [], o: [], h: [], l: [], c: [], v: [] };
  let covered = end;
  for (const bars of series) {
    if (!bars.t.length || !bars.v) continue;
    const reach = Math.max(bars.t[0], start);
    const finest = covered === end;
    for (let index = 0; index < bars.t.length; index++) {
      const t = bars.t[index];
      if (t < start || t >= covered || t < reach) continue;
      // A coarser bar that runs into what a finer series already covers would count that stretch twice.
      if (!finest && (bars.t[index + 1] ?? Infinity) > covered) continue;
      out.t.push(t); out.o.push(bars.o[index]); out.h.push(bars.h[index]); out.l.push(bars.l[index]); out.c.push(bars.c[index]); out.v!.push(bars.v[index] ?? 0);
    }
    covered = Math.min(covered, reach);
    if (covered <= start) break;
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
