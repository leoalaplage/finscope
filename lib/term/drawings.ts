/**
 * What a reader draws on a chart, kept in the chart's own terms.
 *
 * A drawing is anchored to a time and a price, never to a pixel or a candle
 * number, so a trend line drawn on daily candles is still on the same two
 * prices on the same two dates when the reader switches to weeks — the way
 * TrendSpider and every desk platform keep them. Times are the candles' own
 * seconds; a point between two candles, or past the last one, is placed by
 * interpolating the times either side, so it moves smoothly rather than
 * snapping.
 *
 * Drawings are kept per symbol in the browser (finscope.term.drawings.v1) and
 * follow the account when the reader is signed in (lib/account-sync.ts).
 */

export type DrawingKind =
  | "trend" | "ray" | "extended" | "arrow" | "hline" | "hray" | "vline"
  | "channel" | "pitchfork" | "regression" | "rect" | "fib" | "fibext" | "avwap" | "long" | "short" | "range" | "text" | "brush";
export type Tool = "cursor" | DrawingKind | "erase";
export type LineStyle = "solid" | "dashed" | "dotted";

export const DRAWING_KINDS: DrawingKind[] = [
  "trend", "ray", "extended", "arrow", "hline", "hray", "vline", "channel", "pitchfork", "regression",
  "rect", "fib", "fibext", "avwap", "long", "short", "range", "text", "brush",
];

export interface ToolSpec { tool: Tool; key: string; title: string }

/** The tools, in the groups the toolbar shows them in; ⌥ and the key picks one. */
export const TOOL_GROUPS: { name: string; tools: ToolSpec[] }[] = [
  { name: "Pointer", tools: [{ tool: "cursor", key: "V", title: "Cursor" }] },
  {
    name: "Lines",
    tools: [
      { tool: "trend", key: "T", title: "Trend line" },
      { tool: "ray", key: "Y", title: "Ray" },
      { tool: "extended", key: "X", title: "Extended line" },
      { tool: "arrow", key: "A", title: "Arrow" },
      { tool: "hline", key: "H", title: "Horizontal line" },
      { tool: "hray", key: "J", title: "Horizontal ray" },
      { tool: "vline", key: "I", title: "Vertical line" },
      { tool: "channel", key: "P", title: "Parallel channel" },
      { tool: "pitchfork", key: "K", title: "Pitchfork (Andrews)" },
      { tool: "regression", key: "Q", title: "Regression channel" },
    ],
  },
  {
    name: "Analysis",
    tools: [
      { tool: "fib", key: "F", title: "Fibonacci retracement" },
      { tool: "fibext", key: "D", title: "Trend-based Fibonacci extension" },
      { tool: "avwap", key: "W", title: "Anchored VWAP" },
      { tool: "rect", key: "R", title: "Rectangle" },
      { tool: "range", key: "M", title: "Price and date range" },
      { tool: "long", key: "L", title: "Long position" },
      { tool: "short", key: "S", title: "Short position" },
    ],
  },
  {
    name: "Notes",
    tools: [
      { tool: "text", key: "N", title: "Text" },
      { tool: "brush", key: "B", title: "Brush" },
      { tool: "erase", key: "E", title: "Erase a drawing" },
    ],
  },
];

export const TOOLS: ToolSpec[] = TOOL_GROUPS.flatMap((group) => group.tools);

export interface Anchor { t: number; p: number }
export interface Drawing {
  id: string;
  kind: DrawingKind;
  a: Anchor;
  b: Anchor;
  /** A third point: where a channel's parallel runs, a position's stop. */
  c?: Anchor;
  /** A brush's stroke. */
  points?: Anchor[];
  text?: string;
  color?: string;
  width?: 1 | 2 | 3;
  style?: LineStyle;
  locked?: boolean;
}

export const DRAWING_COLORS = ["#4c8dff", "#f5c451", "#26a69a", "#ef5350", "#ff9800", "#ab47bc", "#e9edf2", "#9aa3ad"];
export const DEFAULT_DRAWING_COLOR = DRAWING_COLORS[0];

/** Drawn with a press alone; the others are drawn by dragging, or by a click at each end. */
export const ONE_CLICK: ReadonlySet<DrawingKind> = new Set<DrawingKind>(["hline", "hray", "vline", "text", "long", "short", "avwap"]);

/** Drawn with three points: the first two by a drag or two clicks, the third by one more click. */
export const THREE_POINTS: ReadonlySet<DrawingKind> = new Set<DrawingKind>(["pitchfork", "fibext"]);

/** The levels a trend-based extension marks, from the end of the pullback. */
export const FIB_EXTENSION_RATIOS = [0, 0.382, 0.618, 1, 1.272, 1.618, 2.618];

/** The ratios a drawn retracement marks, as on the automatic one. */
export const DRAWN_FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** The typical distance between two candles, for placing a time past either end; read once per series. */
const steps = new WeakMap<number[], number>();
function step(times: number[]): number {
  if (times.length < 2) return 86_400;
  const known = steps.get(times);
  if (known != null) return known;
  const gaps = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
  const found = gaps[Math.floor(gaps.length / 2)] || 86_400;
  steps.set(times, found);
  return found;
}

/** A fractional candle position for a time: 2.5 is halfway between the third and fourth candle. */
export function indexOfTime(times: number[], t: number): number {
  const count = times.length;
  if (!count) return 0;
  if (t <= times[0]) return (t - times[0]) / step(times);
  if (t >= times[count - 1]) return count - 1 + (t - times[count - 1]) / step(times);
  let low = 0;
  let high = count - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle] <= t) low = middle; else high = middle;
  }
  return low + (t - times[low]) / (times[high] - times[low]);
}

/** The time at a fractional candle position, the inverse of indexOfTime. */
export function timeOfIndex(times: number[], index: number): number {
  const count = times.length;
  if (!count) return 0;
  if (index <= 0) return times[0] + index * step(times);
  if (index >= count - 1) return times[count - 1] + (index - (count - 1)) * step(times);
  const low = Math.floor(index);
  return times[low] + (index - low) * (times[low + 1] - times[low]);
}

/** How far a point is from a segment, in the same units as the coordinates. */
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const along = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + along * dx), py - (ay + along * dy));
}

type Point = { x: number; y: number };

/** Pure: the far ends of a line through a and b, `reach` beyond each, for a ray (one way) or a line extended both ways. */
export function lineReach(a: Point, b: Point, reach: number, both: boolean): { from: Point; to: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { from: a, to: b };
  const k = reach / length;
  return { from: both ? { x: a.x - dx * k, y: a.y - dy * k } : a, to: { x: a.x + dx * k, y: a.y + dy * k } };
}

/** Pure: a channel's parallel, the base line moved to pass through c. */
export function channelOffset(a: Point, b: Point, c: Point): number {
  const along = Math.abs(b.x - a.x) < 1e-9 ? a.y : a.y + ((c.x - a.x) / (b.x - a.x)) * (b.y - a.y);
  return c.y - along;
}

/** The default stop and target of a position placed with one click, a tenth of the visible range apart. */
export function positionAround(kind: "long" | "short", entry: Anchor, end: number, span: number): { b: Anchor; c: Anchor } {
  const sign = kind === "long" ? 1 : -1;
  return { b: { t: end, p: entry.p + sign * span }, c: { t: entry.t, p: entry.p - (sign * span) / 2 } };
}

/**
 * The drawing under a point, if any is within `tolerance`.
 *
 * `toScreen` maps an anchor to the same coordinates as the point, so the test
 * is done where the reader sees the drawing; `box` is the plot's size in those
 * coordinates, for the lines that run to its edge. A level is hit anywhere
 * along its height, a filled shape anywhere inside it, a retracement on any of
 * its lines, a note on its text.
 */
export function drawingAt(
  drawings: Drawing[],
  point: Point,
  toScreen: (anchor: Anchor) => Point,
  tolerance: number,
  box: { width: number; height: number } = { width: 10_000, height: 10_000 },
): Drawing | null {
  let best: { drawing: Drawing; distance: number } | null = null;
  const reach = (box.width + box.height) * 2;
  for (const drawing of drawings) {
    const distance = distanceTo(drawing, point, toScreen, tolerance, reach);
    if (distance <= tolerance && (!best || distance <= best.distance)) best = { drawing, distance };
  }
  return best?.drawing ?? null;
}

function inside(point: Point, left: number, right: number, top: number, bottom: number, tolerance: number) {
  return point.x >= Math.min(left, right) - tolerance && point.x <= Math.max(left, right) + tolerance
    && point.y >= Math.min(top, bottom) - tolerance && point.y <= Math.max(top, bottom) + tolerance;
}

function distanceTo(drawing: Drawing, point: Point, toScreen: (anchor: Anchor) => Point, tolerance: number, reach: number): number {
  const a = toScreen(drawing.a);
  const b = toScreen(drawing.b);
  const segment = (from: Point, to: Point) => distanceToSegment(point.x, point.y, from.x, from.y, to.x, to.y);
  switch (drawing.kind) {
    case "hline":
      return Math.abs(point.y - a.y);
    case "hray":
      return point.x < a.x - tolerance ? Infinity : Math.abs(point.y - a.y);
    case "vline":
      return Math.abs(point.x - a.x);
    case "trend":
    case "arrow":
      return segment(a, b);
    case "ray":
    case "extended": {
      const line = lineReach(a, b, reach, drawing.kind === "extended");
      return segment(line.from, line.to);
    }
    case "channel": {
      const c = drawing.c ? toScreen(drawing.c) : a;
      const offset = channelOffset(a, b, c);
      const a2 = { x: a.x, y: a.y + offset };
      const b2 = { x: b.x, y: b.y + offset };
      const edges = Math.min(segment(a, b), segment(a2, b2));
      // Inside the band, between its two ends.
      const within = point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && (() => {
        const base = Math.abs(b.x - a.x) < 1e-9 ? a.y : a.y + ((point.x - a.x) / (b.x - a.x)) * (b.y - a.y);
        return (point.y - base) * (point.y - base - offset) <= 0;
      })();
      return within ? Math.min(edges, tolerance / 2) : edges;
    }
    case "rect":
    case "range":
      return inside(point, a.x, b.x, a.y, b.y, 0) ? 0 : Math.min(
        segment({ x: a.x, y: a.y }, { x: b.x, y: a.y }), segment({ x: a.x, y: b.y }, { x: b.x, y: b.y }),
        segment({ x: a.x, y: a.y }, { x: a.x, y: b.y }), segment({ x: b.x, y: a.y }, { x: b.x, y: b.y }),
      );
    case "long":
    case "short": {
      const c = drawing.c ? toScreen(drawing.c) : a;
      return inside(point, a.x, b.x, Math.min(b.y, c.y), Math.max(b.y, c.y), 0) ? 0 : Infinity;
    }
    case "fib": {
      const left = Math.min(a.x, b.x);
      return point.x < left - tolerance ? Infinity : Math.min(...DRAWN_FIB_RATIOS.map((ratio) => Math.abs(point.y - (b.y + (a.y - b.y) * ratio))));
    }
    case "text": {
      const width = Math.max(24, (drawing.text?.length ?? 4) * 7.5 + 8);
      return inside(point, a.x - 2, a.x + width, a.y - 16, a.y + 4, 0) ? 0 : Infinity;
    }
    case "pitchfork": {
      const c = drawing.c ? toScreen(drawing.c) : b;
      const lines = pitchforkLines(a, b, c, reach);
      return Math.min(segment(b, c), ...lines.map((line) => segment(line.from, line.to)));
    }
    case "fibext": {
      const c = drawing.c ? toScreen(drawing.c) : b;
      if (point.x < c.x - tolerance) return Infinity;
      return Math.min(...FIB_EXTENSION_RATIOS.map((ratio) => Math.abs(point.y - (c.y + (b.y - a.y) * ratio))), segment(a, b), segment(b, c));
    }
    case "regression":
    case "avwap":
    case "brush": {
      const points = (drawing.points ?? []).map(toScreen);
      let nearest = Infinity;
      for (let index = 1; index < points.length; index++) nearest = Math.min(nearest, segment(points[index - 1], points[index]));
      return nearest;
    }
  }
}

/**
 * Pure: an Andrews pitchfork's three lines — the median from the pivot through
 * the middle of the two reactions, and a tine through each reaction parallel
 * to it — run `reach` past their start.
 */
export function pitchforkLines(a: Point, b: Point, c: Point, reach: number): Array<{ from: Point; to: Point }> {
  const middle = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  const median = lineReach(a, middle, reach, false);
  const dx = median.to.x - a.x;
  const dy = median.to.y - a.y;
  return [median, { from: b, to: { x: b.x + dx, y: b.y + dy } }, { from: c, to: { x: c.x + dx, y: c.y + dy } }];
}

/** The candle a time falls in: the last that opened by then. */
function candleAt(times: number[], t: number): number {
  if (!times.length || t < times[0]) return 0;
  let low = 0;
  let high = times.length - 1;
  if (times[high] <= t) return high;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle] <= t) low = middle; else high = middle;
  }
  return low;
}

/** Pure: the volume-weighted average price from the candle a time falls in to the last one, at each candle's time. */
export function anchoredVwap(bars: { t: number[]; h: number[]; l: number[]; c: number[]; v?: number[] }, t: number): Anchor[] {
  const start = candleAt(bars.t, t);
  const out: Anchor[] = [];
  let weighted = 0;
  let volume = 0;
  for (let index = start; index < bars.t.length; index++) {
    const typical = (bars.h[index] + bars.l[index] + bars.c[index]) / 3;
    const traded = bars.v?.[index] && bars.v[index] > 0 ? bars.v[index] : 1;
    weighted += typical * traded;
    volume += traded;
    out.push({ t: bars.t[index], p: weighted / volume });
  }
  return out;
}

/**
 * Pure: the least-squares line through the closes between two times, and how
 * far the closes stray from it (one standard deviation); the channel is drawn
 * two of them either side.
 */
export function regressionOver(bars: { t: number[]; c: number[] }, from: number, to: number): { a: Anchor; b: Anchor; deviation: number } | null {
  const first = candleAt(bars.t, Math.min(from, to));
  const last = candleAt(bars.t, Math.max(from, to));
  const n = last - first + 1;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let index = first; index <= last; index++) {
    const x = index - first;
    sx += x; sy += bars.c[index]; sxx += x * x; sxy += x * bars.c[index];
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const intercept = (sy - slope * sx) / n;
  let squares = 0;
  for (let index = first; index <= last; index++) squares += (bars.c[index] - (intercept + slope * (index - first))) ** 2;
  return {
    a: { t: bars.t[first], p: intercept },
    b: { t: bars.t[last], p: intercept + slope * (n - 1) },
    deviation: Math.sqrt(squares / n),
  };
}

/** The points a selected drawing can be reshaped by: its anchors, where the reader sees them. */
export type HandleKey = "a" | "b" | "c";
export function handlesOf(drawing: Drawing): HandleKey[] {
  switch (drawing.kind) {
    case "hline": case "hray": case "vline": case "text": case "avwap": return ["a"];
    case "brush": return [];
    case "channel": case "long": case "short": case "pitchfork": case "fibext": return ["a", "b", "c"];
    default: return ["a", "b"];
  }
}

/** Pure: every anchor of a drawing passed through `move`, for dragging a whole drawing. */
export function mapAnchors(drawing: Drawing, move: (anchor: Anchor) => Anchor): Drawing {
  return {
    ...drawing,
    a: move(drawing.a),
    b: move(drawing.b),
    ...(drawing.c ? { c: move(drawing.c) } : {}),
    ...(drawing.points ? { points: drawing.points.map(move) } : {}),
  };
}

/** Pure: a drawing with one handle moved; a position's stop stays at its entry's time. */
export function withHandle(drawing: Drawing, handle: HandleKey, anchor: Anchor): Drawing {
  if (drawing.kind === "hline" || drawing.kind === "hray" || drawing.kind === "vline" || drawing.kind === "text" || drawing.kind === "avwap") return { ...drawing, a: anchor, b: anchor };
  if ((drawing.kind === "long" || drawing.kind === "short") && handle === "a") {
    return { ...drawing, a: anchor, c: drawing.c ? { t: anchor.t, p: drawing.c.p } : drawing.c };
  }
  if ((drawing.kind === "long" || drawing.kind === "short") && handle === "c") return { ...drawing, c: { t: drawing.a.t, p: anchor.p } };
  return { ...drawing, [handle]: anchor };
}

/** Where a handle is drawn: a position's stop sits under its entry. */
export function handleAnchor(drawing: Drawing, handle: HandleKey): Anchor {
  if (handle === "c") return drawing.c ?? drawing.a;
  return drawing[handle];
}

/** A position's figures: how far the target and the stop are from the entry, and the reward for the risk. */
export function positionFigures(drawing: Drawing) {
  const entry = drawing.a.p;
  const target = drawing.b.p;
  const stop = drawing.c?.p ?? entry;
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  return {
    entry, target, stop,
    targetMove: entry ? (target - entry) / entry : 0,
    stopMove: entry ? (stop - entry) / entry : 0,
    ratio: risk > 0 ? reward / risk : null,
  };
}

const anchorOk = (value: Anchor | undefined) => value != null && Number.isFinite(value.t) && Number.isFinite(value.p);

/** Drawings as stored: anything malformed is dropped rather than drawn wrong. */
export function readDrawings(text: string | null): Record<string, Drawing[]> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed == null) return {};
    const out: Record<string, Drawing[]> = {};
    for (const [symbol, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const kept = list.filter((item): item is Drawing => {
        const drawing = item as Drawing;
        return typeof drawing?.id === "string" && DRAWING_KINDS.includes(drawing.kind) && anchorOk(drawing.a) && anchorOk(drawing.b)
          && (drawing.c == null || anchorOk(drawing.c))
          && (drawing.points == null || (Array.isArray(drawing.points) && drawing.points.every(anchorOk)));
      });
      if (kept.length) out[symbol] = kept;
    }
    return out;
  } catch {
    return {};
  }
}
