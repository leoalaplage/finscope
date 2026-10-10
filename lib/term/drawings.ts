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
 */

export type DrawingKind = "trend" | "hline" | "fib" | "rect";
export type Tool = "cursor" | DrawingKind | "erase";

export const TOOLS: { tool: Tool; label: string; key: string; title: string }[] = [
  { tool: "cursor", label: "↖", key: "V", title: "Cursor" },
  { tool: "trend", label: "╱", key: "T", title: "Trend line" },
  { tool: "hline", label: "─", key: "H", title: "Horizontal level" },
  { tool: "rect", label: "▭", key: "R", title: "Zone" },
  { tool: "fib", label: "F", key: "F", title: "Fibonacci retracement" },
  { tool: "erase", label: "⌫", key: "E", title: "Erase a drawing" },
];

export interface Anchor { t: number; p: number }
export interface Drawing { id: string; kind: DrawingKind; a: Anchor; b: Anchor }

/** The ratios a drawn retracement marks, as on the automatic one. */
export const DRAWN_FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** The typical distance between two candles, for placing a time past either end. */
function step(times: number[]): number {
  if (times.length < 2) return 86_400;
  const gaps = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || 86_400;
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

/**
 * The drawing under a point, if any is within `tolerance`.
 *
 * `toScreen` maps an anchor to the same coordinates as the point, so the test
 * is done where the reader sees the drawing. A level is hit anywhere along its
 * height, a zone anywhere inside it or on its edge, a retracement on any of its
 * lines.
 */
export function drawingAt(
  drawings: Drawing[],
  point: { x: number; y: number },
  toScreen: (anchor: Anchor) => { x: number; y: number },
  tolerance: number,
): Drawing | null {
  let best: { drawing: Drawing; distance: number } | null = null;
  for (const drawing of drawings) {
    const a = toScreen(drawing.a);
    const b = toScreen(drawing.b);
    let distance: number;
    switch (drawing.kind) {
      case "hline":
        distance = Math.abs(point.y - a.y);
        break;
      case "trend":
        distance = distanceToSegment(point.x, point.y, a.x, a.y, b.x, b.y);
        break;
      case "rect": {
        const inside = point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
        distance = inside ? 0 : Infinity;
        break;
      }
      case "fib": {
        const left = Math.min(a.x, b.x);
        distance = point.x < left - tolerance ? Infinity : Math.min(...DRAWN_FIB_RATIOS.map((ratio) => Math.abs(point.y - (b.y + (a.y - b.y) * ratio))));
        break;
      }
    }
    if (distance <= tolerance && (!best || distance < best.distance)) best = { drawing, distance };
  }
  return best?.drawing ?? null;
}

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
        const anchor = (value: Anchor | undefined) => value != null && Number.isFinite(value.t) && Number.isFinite(value.p);
        return typeof drawing?.id === "string" && ["trend", "hline", "fib", "rect"].includes(drawing.kind) && anchor(drawing.a) && anchor(drawing.b);
      });
      if (kept.length) out[symbol] = kept;
    }
    return out;
  } catch {
    return {};
  }
}
