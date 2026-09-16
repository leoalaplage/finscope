import type { CandleInterval } from "../adapters/candles";

/**
 * Technical analysis the chart draws by itself: Fibonacci retracements and
 * extensions, fair value gaps, trend lines, and support and resistance.
 *
 * Every study reads the candles on screen, so a daily chart is analysed over
 * its ten months and a monthly one over its fifteen years, and every tolerance
 * is measured in average true range, so "close to a line" means the same
 * thing for a $20 stock on a weekly chart as for a $900 one on a daily. The
 * rules are the textbook ones, written down so a reader can check a drawing
 * against them:
 *
 * - A pivot high is a candle whose high is above the highs of the `k` candles
 *   on each side of it (and a pivot low the mirror); `k` is wider on daily
 *   candles, where there are more of them and more noise.
 * - The Fibonacci swing is the lowest low and highest high on screen, and
 *   whichever came later is where the move ended.
 * - A fair value gap is three candles whose outer two do not overlap, and it
 *   stays on the chart until price has traded all the way through it.
 * - A trend line joins two pivots — rising lows for support, falling highs for
 *   resistance — that no candle between them crossed, and that no close since
 *   has broken.
 * - A support or resistance level is a price that at least two pivots came
 *   back to.
 * - A break of structure (BOS) is a close beyond the last swing in the
 *   direction of the trend; a change of character (CHoCH) is the first close
 *   beyond one against it.
 * - An order block is the last candle against the move before a break, kept
 *   until a close goes through it.
 */

export interface Series { t: number[]; o: number[]; h: number[]; l: number[]; c: number[] }
export interface Point { index: number; price: number }

export const PIVOT_SPAN: Record<CandleInterval, number> = { "1d": 5, "1wk": 3, "1mo": 3 };

export interface Pivot extends Point { kind: "high" | "low" }

export function pivots(series: Series, span: number): Pivot[] {
  const out: Pivot[] = [];
  const n = series.c.length;
  for (let index = span; index < n - span; index++) {
    let high = true, low = true;
    for (let offset = 1; offset <= span && (high || low); offset++) {
      if (series.h[index - offset] >= series.h[index] || series.h[index + offset] > series.h[index]) high = false;
      if (series.l[index - offset] <= series.l[index] || series.l[index + offset] < series.l[index]) low = false;
    }
    if (high) out.push({ index, price: series.h[index], kind: "high" });
    if (low) out.push({ index, price: series.l[index], kind: "low" });
  }
  return out;
}

/** Wilder's average true range, one value per candle, null until defined. */
export function averageTrueRange(series: Series, period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(series.c.length).fill(null);
  let previous: number | null = null;
  let seed = 0;
  for (let index = 0; index < series.c.length; index++) {
    const range = index === 0
      ? series.h[0] - series.l[0]
      : Math.max(series.h[index] - series.l[index], Math.abs(series.h[index] - series.c[index - 1]), Math.abs(series.l[index] - series.c[index - 1]));
    if (previous == null) {
      seed += range;
      if (index === period - 1) { previous = seed / period; out[index] = previous; }
      continue;
    }
    previous = (previous * (period - 1) + range) / period;
    out[index] = previous;
  }
  return out;
}

/* ---- Fibonacci ------------------------------------------------------------ */

export interface FibLevel { ratio: number; price: number }

export interface Fibonacci {
  direction: "up" | "down";
  /** Where the move started and ended. */
  from: Point;
  to: Point;
  /** The pullback after the move, when there has been one; extensions are projected from it. */
  pullback: Point | null;
  retracement: FibLevel[];
  extension: FibLevel[];
}

export const RETRACEMENT_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
/** Trend-based: the move's length, laid again from the pullback. */
export const EXTENSION_RATIOS = [0.618, 1, 1.272, 1.618];

/**
 * The swing, its retracement and its extension.
 *
 * Extension levels further from the candles than three quarters of their own
 * range are dropped: a target three times the chart's height away is not a level anyone
 * can read, and drawing it would squash every candle into a strip.
 */
export function fibonacci(series: Series, span: number): Fibonacci | null {
  const n = series.c.length;
  if (n < 3) return null;
  let high = 0, low = 0;
  for (let index = 1; index < n; index++) {
    if (series.h[index] > series.h[high]) high = index;
    if (series.l[index] < series.l[low]) low = index;
  }
  if (high === low || series.h[high] === series.l[low]) return null;
  const up = low < high;
  const from = up ? { index: low, price: series.l[low] } : { index: high, price: series.h[high] };
  const to = up ? { index: high, price: series.h[high] } : { index: low, price: series.l[low] };
  const move = to.price - from.price;

  // The deepest pullback since the move ended, once it has had room to form.
  let pullback: Point | null = null;
  if (n - 1 - to.index >= span) {
    for (let index = to.index + 1; index < n; index++) {
      const price = up ? series.l[index] : series.h[index];
      if (!pullback || (up ? price < pullback.price : price > pullback.price)) pullback = { index, price };
    }
  }
  const base = pullback?.price ?? from.price;
  return {
    direction: up ? "up" : "down",
    from,
    to,
    pullback,
    retracement: RETRACEMENT_RATIOS.map((ratio) => ({ ratio, price: to.price - move * ratio })),
    extension: EXTENSION_RATIOS
      // Without a pullback the extension is laid from the start, and its first two steps are the move itself.
      .filter((ratio) => pullback || ratio > 1)
      .map((ratio) => ({ ratio, price: base + move * ratio }))
      .filter((level) => level.price <= series.h[high] + reachOf(series, high, low) && level.price >= series.l[low] - reachOf(series, high, low)),
  };
}

const reachOf = (series: Series, high: number, low: number) => (series.h[high] - series.l[low]) * 0.75;

/* ---- Fair value gaps ------------------------------------------------------- */

export interface FairValueGap {
  kind: "bullish" | "bearish";
  /** The middle candle of the three. */
  index: number;
  /** What is still open of the gap, after any partial fill. */
  top: number;
  bottom: number;
}

/**
 * Open fair value gaps, newest last.
 *
 * Gaps smaller than a fifth of the average range are noise and left out. A
 * gap price has traded into shrinks to the part still untouched; one it has
 * traded through is closed and gone.
 */
export function fairValueGaps(series: Series, atr: Array<number | null>, limit = 6): FairValueGap[] {
  const n = series.c.length;
  const open: FairValueGap[] = [];
  for (let index = 1; index < n - 1; index++) {
    const floor = (atr[index] ?? 0) * 0.2;
    let gap: FairValueGap | null = null;
    if (series.l[index + 1] > series.h[index - 1] && series.l[index + 1] - series.h[index - 1] > floor) {
      gap = { kind: "bullish", index, top: series.l[index + 1], bottom: series.h[index - 1] };
    } else if (series.h[index + 1] < series.l[index - 1] && series.l[index - 1] - series.h[index + 1] > floor) {
      gap = { kind: "bearish", index, top: series.l[index - 1], bottom: series.h[index + 1] };
    }
    if (!gap) continue;
    let closed = false;
    for (let later = index + 2; later < n && !closed; later++) {
      if (gap.kind === "bullish") {
        if (series.l[later] <= gap.bottom) closed = true;
        else if (series.l[later] < gap.top) gap.top = series.l[later];
      } else {
        if (series.h[later] >= gap.top) closed = true;
        else if (series.h[later] > gap.bottom) gap.bottom = series.h[later];
      }
    }
    if (!closed) open.push(gap);
  }
  return open.slice(-limit);
}

/* ---- Trend lines ------------------------------------------------------------ */

export interface TrendLine {
  kind: "support" | "resistance";
  a: Point;
  b: Point;
  /** Pivots on the line, the two that define it included. */
  touches: number;
}

export const priceOnLine = (line: { a: Point; b: Point }, index: number) =>
  line.a.price + ((line.b.price - line.a.price) * (index - line.a.index)) / (line.b.index - line.a.index);

/**
 * The best unbroken support and resistance lines, at most `perKind` of each.
 *
 * A line that now sits more than a quarter away from the last close is left
 * out, however well it held: on fifteen years of a stock that rose tenfold,
 * the line under its first years is valid and says nothing about today.
 *
 * Candidates join two of the last dozen pivots of a kind. A line is kept if no
 * candle between its anchors reached through it and no close since has; it is
 * ranked by how many pivots it touches, then by how recent its second anchor
 * is, so a line the market keeps respecting beats one drawn through two
 * accidents.
 */
export function trendLines(series: Series, found: Pivot[], atr: number, perKind = 2, reach = 0.25): TrendLine[] {
  const n = series.c.length;
  const close = series.c[n - 1];
  const tolerance = atr * 0.25;
  const out: TrendLine[] = [];
  for (const kind of ["support", "resistance"] as const) {
    const anchors = found.filter((pivot) => pivot.kind === (kind === "support" ? "low" : "high")).slice(-12);
    const candidates: Array<TrendLine & { score: number }> = [];
    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        const a = anchors[i], b = anchors[j];
        if (kind === "support" ? b.price <= a.price : b.price >= a.price) continue;
        const line = { a, b };
        let valid = true;
        for (let index = a.index + 1; index < n && valid; index++) {
          const at = priceOnLine(line, index);
          if (index < b.index) {
            // Between the anchors, no wick reaches through the line.
            valid = kind === "support" ? series.l[index] >= at - tolerance : series.h[index] <= at + tolerance;
          } else if (index > b.index) {
            // After them, no close has broken it.
            valid = kind === "support" ? series.c[index] >= at - tolerance : series.c[index] <= at + tolerance;
          }
        }
        if (!valid) continue;
        if (Math.abs(priceOnLine(line, n - 1) - close) > close * reach) continue;
        const touches = anchors.filter((pivot) => pivot.index >= a.index && Math.abs(pivot.price - priceOnLine(line, pivot.index)) <= tolerance).length;
        candidates.push({ kind, a, b, touches, score: touches * n + b.index });
      }
    }
    candidates.sort((left, right) => right.score - left.score);
    const kept: TrendLine[] = [];
    for (const candidate of candidates) {
      if (kept.length >= perKind) break;
      // A second line must not share an anchor with the first.
      if (kept.some((line) => line.a.index === candidate.a.index || line.b.index === candidate.b.index)) continue;
      kept.push({ kind: candidate.kind, a: candidate.a, b: candidate.b, touches: candidate.touches });
    }
    out.push(...kept);
  }
  return out;
}

/* ---- Support and resistance ----------------------------------------------- */

export interface Level { price: number; touches: number; kind: "support" | "resistance"; last: number }

/**
 * Prices the market came back to, nearest first on each side of the last close.
 *
 * Pivots within half an average range of each other are one level, priced at
 * their mean. A level needs two touches, and at most `perSide` are kept above
 * and below the price so the chart shows the ones that matter now.
 */
export function supportResistance(series: Series, found: Pivot[], atr: number, perSide = 2): Level[] {
  const n = series.c.length;
  if (!n) return [];
  const close = series.c[n - 1];
  const tolerance = atr * 0.5;
  const sorted = [...found].sort((left, right) => left.price - right.price);
  const clusters: Array<{ prices: number[]; last: number }> = [];
  for (const pivot of sorted) {
    const current = clusters.at(-1);
    const mean = current ? current.prices.reduce((sum, price) => sum + price, 0) / current.prices.length : 0;
    if (current && pivot.price - mean <= tolerance) {
      current.prices.push(pivot.price);
      current.last = Math.max(current.last, pivot.index);
    } else {
      clusters.push({ prices: [pivot.price], last: pivot.index });
    }
  }
  const levels = clusters
    .filter((cluster) => cluster.prices.length >= 2)
    .map((cluster): Level => {
      const price = cluster.prices.reduce((sum, value) => sum + value, 0) / cluster.prices.length;
      return { price, touches: cluster.prices.length, kind: price <= close ? "support" : "resistance", last: cluster.last };
    });
  const below = levels.filter((level) => level.kind === "support").sort((left, right) => right.price - left.price).slice(0, perSide);
  const above = levels.filter((level) => level.kind === "resistance").sort((left, right) => left.price - right.price).slice(0, perSide);
  return [...above.reverse(), ...below];
}

/* ---- Market structure and order blocks --------------------------------------- */

export interface StructureBreak {
  kind: "BOS" | "CHoCH";
  direction: "bullish" | "bearish";
  /** The swing that was broken. */
  swing: Point;
  /** The candle whose close broke it. */
  index: number;
}

export interface OrderBlock {
  direction: "bullish" | "bearish";
  index: number;
  top: number;
  bottom: number;
}

/**
 * Breaks of structure, changes of character and the order blocks behind them.
 *
 * Candles are read in order, and a swing is only known once its `span`
 * candles to the right have printed — the chart never uses a pivot before the
 * market could have seen it. A close above the latest swing high is a break;
 * it is a BOS when the trend was already up (or not yet known) and a CHoCH when
 * it was down. The swing is then spent, and the trend is the break's.
 *
 * The order block of a bullish break is the last down candle at or before the
 * lowest point between the broken swing and the break — where the move that
 * broke it started. It is dropped once a close falls below it. Bearish breaks
 * mirror all of this. The newest `limit` breaks and `blocksPerSide` open blocks
 * on each side are returned, overlapping blocks counted once.
 */
export function marketStructure(series: Series, span: number, limit = 6, blocksPerSide = 2): { breaks: StructureBreak[]; blocks: OrderBlock[] } {
  const n = series.c.length;
  const found = pivots(series, span);
  const breaks: StructureBreak[] = [];
  const blocks: Array<OrderBlock & { from: number }> = [];
  let high: Pivot | null = null;
  let low: Pivot | null = null;
  let trend: "bullish" | "bearish" | null = null;
  let next = 0;

  const blockFor = (direction: "bullish" | "bearish", start: number, end: number): OrderBlock | null => {
    // The extreme the move started from…
    let origin = start;
    for (let index = start; index <= end; index++) {
      if (direction === "bullish" ? series.l[index] < series.l[origin] : series.h[index] > series.h[origin]) origin = index;
    }
    // …and the last candle against the move at or before it.
    for (let index = origin; index >= start; index--) {
      const against = direction === "bullish" ? series.c[index] < series.o[index] : series.c[index] > series.o[index];
      if (against) return { direction, index, top: series.h[index], bottom: series.l[index] };
    }
    return { direction, index: origin, top: series.h[origin], bottom: series.l[origin] };
  };

  for (let index = 0; index < n; index++) {
    while (next < found.length && found[next].index + span <= index) {
      const pivot = found[next++];
      if (pivot.kind === "high") high = pivot; else low = pivot;
    }
    const close = series.c[index];
    if (high && close > high.price) {
      breaks.push({ kind: trend === "bearish" ? "CHoCH" : "BOS", direction: "bullish", swing: { index: high.index, price: high.price }, index });
      const block = blockFor("bullish", high.index, index);
      if (block) blocks.push({ ...block, from: index });
      trend = "bullish";
      high = null;
    } else if (low && close < low.price) {
      breaks.push({ kind: trend === "bullish" ? "CHoCH" : "BOS", direction: "bearish", swing: { index: low.index, price: low.price }, index });
      const block = blockFor("bearish", low.index, index);
      if (block) blocks.push({ ...block, from: index });
      trend = "bearish";
      low = null;
    }
  }

  const open = blocks.filter((block) => {
    for (let index = block.from + 1; index < n; index++) {
      if (block.direction === "bullish" ? series.c[index] < block.bottom : series.c[index] > block.top) return false;
    }
    return true;
  });
  // Newest first, and a block overlapping a newer one on the same side is the same zone drawn twice.
  const newest = (direction: "bullish" | "bearish") => {
    const kept: OrderBlock[] = [];
    for (const block of open.filter((item) => item.direction === direction).reverse()) {
      if (kept.length >= blocksPerSide) break;
      if (kept.some((other) => block.bottom <= other.top && block.top >= other.bottom)) continue;
      kept.push({ direction: block.direction, index: block.index, top: block.top, bottom: block.bottom });
    }
    return kept.reverse();
  };
  return { breaks: breaks.slice(-limit), blocks: [...newest("bullish"), ...newest("bearish")] };
}

/* ---- What the reader switches on and off ----------------------------------- */

export const STUDIES = ["ema", "fibRetracement", "fibExtension", "fvg", "trendLines", "levels", "structure", "orderBlocks"] as const;
export type Study = (typeof STUDIES)[number];

export const STUDY_NAMES: Record<Study, string> = {
  ema: "EMA 20 · 50 · 200",
  fibRetracement: "Fibonacci retracement",
  fibExtension: "Fibonacci extension",
  fvg: "Fair value gaps",
  trendLines: "Trend lines",
  levels: "Support & resistance",
  structure: "BOS / CHoCH",
  orderBlocks: "Order blocks",
};

export const DEFAULT_STUDIES: ReadonlySet<Study> = new Set<Study>(["ema", "fibRetracement", "trendLines"]);

/** The studies a stored list names, in their own order; the default when nothing usable is stored. */
export function readStudies(text: string | null): Set<Study> {
  if (text == null) return new Set(DEFAULT_STUDIES);
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_STUDIES);
    return new Set(STUDIES.filter((study) => parsed.includes(study)));
  } catch {
    return new Set(DEFAULT_STUDIES);
  }
}
