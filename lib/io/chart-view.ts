/**
 * Where a chart looks: how many candle slots fit across it, and how far its
 * right edge stands from the last candle — the two numbers every pan and zoom
 * changes, as on the desk platforms.
 *
 * Slot i holds candle i, from i to i + 1. The right edge sits at
 * `total + offset`: an offset of 3 leaves three empty slots after the last
 * candle, room for drawings in the future; a negative one has scrolled back
 * into the history. Spans and offsets are fractional, so a drag moves the
 * chart by the pixel rather than by the candle. Pure.
 */

export interface Viewport { span: number; offset: number }

/** Fewest slots a zoom can come down to. */
export const MIN_SPAN = 6;

/** The empty slots a chart that can be moved opens with after its last candle. */
export const rightMargin = (fit: number) => Math.max(2, Math.round(fit * 0.05));

/** A viewport held inside the history: a few candles always on screen, never more than the whole history and some room. */
export function clampViewport(view: Viewport, total: number): Viewport {
  const span = Math.min(Math.max(view.span, Math.min(MIN_SPAN, Math.max(total, 2))), Math.max(total * 1.15 + 10, MIN_SPAN));
  const keep = Math.max(Math.min(3, total), span * 0.15);
  const low = keep - total;
  const high = Math.max(low, span - keep);
  return { span, offset: Math.min(Math.max(view.offset, low), high) };
}

/** The candles on screen, whole or in part, and the slot at the left edge. */
export function windowOf(view: Viewport, total: number): { from: number; to: number; left: number; right: number } {
  const right = total + view.offset;
  const left = right - view.span;
  return {
    from: Math.min(Math.max(Math.floor(left), 0), total),
    to: Math.min(Math.max(Math.ceil(right), 0), total),
    left, right,
  };
}

/** Zoomed by `factor` (above 1, out) around the point `fraction` of the way across. */
export function zoomAround(view: Viewport, total: number, fraction: number, factor: number): Viewport {
  const left = total + view.offset - view.span;
  const held = left + fraction * view.span;
  const span = view.span * factor;
  const nextLeft = held - fraction * span;
  return clampViewport({ span, offset: nextLeft + span - total }, total);
}

/** Moved by `slots` (positive, towards the newest candles). */
export const panBy = (view: Viewport, total: number, slots: number): Viewport => clampViewport({ span: view.span, offset: view.offset + slots }, total);

/** A price range stretched by `factor` around its middle, in the axis's own terms (logarithms on a log axis). */
export function stretchRange(range: { min: number; max: number }, factor: number, log: boolean): { min: number; max: number } {
  const to = log ? Math.log : (value: number) => value;
  const from = log ? Math.exp : (value: number) => value;
  const low = to(Math.max(range.min, log ? 1e-9 : -Infinity));
  const high = to(range.max);
  const middle = (low + high) / 2;
  const half = Math.max(((high - low) / 2) * factor, 1e-9);
  return { min: from(middle - half), max: from(middle + half) };
}

/** A price range moved by a fraction of its own height (positive, towards higher prices). */
export function shiftRange(range: { min: number; max: number }, fraction: number, log: boolean): { min: number; max: number } {
  if (log && range.min > 0) {
    const low = Math.log(range.min);
    const high = Math.log(range.max);
    const moved = (high - low) * fraction;
    return { min: Math.exp(low + moved), max: Math.exp(high + moved) };
  }
  const moved = (range.max - range.min) * fraction;
  return { min: range.min + moved, max: range.max + moved };
}

/** Round ticks across a price range the reader set by hand. */
export function ticksFor(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [];
  const rough = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((multiple) => multiple * power >= rough) ?? 10) * power;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step) ticks.push(Number(tick.toFixed(10)));
  return ticks;
}
