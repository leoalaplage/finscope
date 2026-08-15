/**
 * Categorical series colours, in fixed assignment order.
 *
 * These are stepped for a white chart surface and verified with the palette
 * validator rather than chosen by eye: every slot sits inside the L 0.43–0.77
 * lightness band, clears the chroma floor, and keeps adjacent pairs separable
 * under protanopia, deuteranopia and tritanopia (worst adjacent ΔE 9.1) as well
 * as for normal vision (worst adjacent ΔE 19.6).
 *
 * The previous palette was inherited from a dark theme this interface no longer
 * has. Its first and most-used entry was a fluorescent yellow measuring 1.11:1
 * against white — a line the reader could barely see.
 *
 * Slots below 3:1 contrast rely on the direct end-labels and the data table for
 * relief, which the method requires and this workspace provides.
 */
export const CHART_PALETTE = [
  { name: "Blue", value: "#2a78d6" },
  { name: "Orange", value: "#eb6834" },
  { name: "Aqua", value: "#1baf7a" },
  { name: "Yellow", value: "#eda100" },
  { name: "Magenta", value: "#e87ba4" },
  { name: "Green", value: "#008300" },
  { name: "Violet", value: "#4a3aa7" },
  { name: "Red", value: "#e34948" },
] as const;

/**
 * The same eight hues stepped for a dark surface, not an inversion of the light
 * set. Checked with the validator against #1a1a19: every slot inside the
 * L 0.48-0.67 band, worst adjacent pair separable at delta-E 8.4 under colour
 * vision deficiency and 19.3 for normal vision, and — unlike the light set —
 * every slot clears 3:1 contrast outright.
 *
 * Running the light palette against a dark surface fails four slots on
 * lightness, which is why this exists rather than a filter.
 */
export const CHART_PALETTE_DARK = [
  { name: "Blue", value: "#3987e5" },
  { name: "Orange", value: "#d95926" },
  { name: "Aqua", value: "#199e70" },
  { name: "Yellow", value: "#c98500" },
  { name: "Magenta", value: "#d55181" },
  { name: "Green", value: "#008300" },
  { name: "Violet", value: "#9085e9" },
  { name: "Red", value: "#e66767" },
] as const;

export type ThemeName = "light" | "dark";
export function chartPalette(theme: ThemeName) {
  return theme === "dark" ? CHART_PALETTE_DARK : CHART_PALETTE;
}

export type ScaleMode = "zero" | "auto" | "custom" | "log" | "fit";

/**
 * Rounds a bound up to a number a reader would have chosen: 1, 2, 2.5 or 5
 * times a power of ten.
 *
 * Padding a maximum by eight percent gives a bound like 9.99, and the chart
 * library then prints a tick on it. The axis reads $0, $3, $6, $9, $9.99 —
 * round steps and then something arbitrary, which looks like the scale changes
 * near the top. Rounding the bound outward first means every tick lands on a
 * round number, including the last one.
 */
export function niceBound(value: number) {
  if (!Number.isFinite(value) || value === 0) return 0;
  const sign = Math.sign(value);
  const size = Math.abs(value);
  const magnitude = 10 ** Math.floor(Math.log10(size));
  const normalized = size / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return sign * step * magnitude;
}

/**
 * Evenly spaced round ticks that cover the data, and the domain they imply.
 *
 * Handing a chart library a rounded maximum is not enough: it still runs its
 * own tick algorithm inside those bounds and can produce 0, 3, 6, 10 — three
 * equal steps and then a wider one. The eye reads that stretched last interval
 * as a change of scale.
 *
 * So the step is chosen first, from the 1 / 2 / 5 family, and the domain
 * is derived from it rather than the reverse. Among the steps giving a sensible
 * number of intervals, the one wasting the least space wins.
 */
export function niceTicks(minimum: number, maximum: number, count = 5): number[] {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [];
  if (minimum === maximum) return [minimum];
  const rawStep = (maximum - minimum) / Math.max(1, count - 1);
  // Steps are 1, 2 or 5 times a power of ten, and nothing else. A step of 2.5
  // is arithmetically fine but labels an axis 0, 125, 250, 375, which reads as
  // arbitrary next to 0, 100, 200, 300.
  const exponent = Math.floor(Math.log10(rawStep));
  const candidates: number[] = [];
  for (const power of [exponent - 1, exponent, exponent + 1]) {
    for (const unit of [1, 2, 5]) candidates.push(unit * 10 ** power);
  }

  let best: { ticks: number[]; waste: number; distance: number } | null = null;
  for (const step of [...new Set(candidates)].sort((a, b) => a - b)) {
    if (!Number.isFinite(step) || step <= 0) continue;
    const start = Math.floor(minimum / step) * step;
    const end = Math.ceil(maximum / step) * step;
    const steps = Math.round((end - start) / step);
    // Three to eight intervals: fewer leaves the axis unreadable, more turns it
    // into a ruler. Waste is only worth minimising within that range, and the
    // wider ceiling matters when a series dips just below its base — a coarse
    // step would spend a whole interval on an excursion of half a percent.
    if (steps < 3 || steps > 8) continue;
    const waste = (end - maximum) + (minimum - start);
    const distance = Math.abs(steps + 1 - count);
    if (best && (waste > best.waste + Number.EPSILON || (Math.abs(waste - best.waste) <= Number.EPSILON && distance >= best.distance))) continue;
    const ticks: number[] = [];
    // Recompose each tick from the step so binary rounding never reaches a label.
    for (let index = 0; index <= steps; index++) ticks.push(Number((start + index * step).toPrecision(12)));
    best = { ticks, waste, distance };
  }
  return best?.ticks ?? [];
}

export function chartDomain(values: Array<number | null | undefined>, mode: ScaleMode, custom?: { min: number; max: number }) {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (mode === "custom") {
    if (!custom || !Number.isFinite(custom.min) || !Number.isFinite(custom.max) || custom.min >= custom.max) return { domain: ["auto", "auto"] as const, warning: "Custom minimum must be lower than maximum." };
    return { domain: [custom.min, custom.max] as [number, number] };
  }
  if (mode === "auto" || finite.length === 0) return { domain: ["auto", "auto"] as const };
  if (mode === "log") {
    if (finite.some((value) => value <= 0)) return { domain: ["auto", "auto"] as const, warning: "Logarithmic scale requires strictly positive values." };
    return { domain: ["auto", "auto"] as const };
  }
  if (mode === "fit") {
    // Frames the data itself with a small margin. Useful when the interesting
    // variation is a few percent sitting a long way from zero, which anchoring
    // to zero would flatten into a straight line.
    const minimum = Math.min(...finite); const maximum = Math.max(...finite);
    if (minimum === maximum) return { domain: [minimum - 1, maximum + 1] as [number, number] };
    const margin = (maximum - minimum) * 0.08;
    // The breathing room must not invent a sign the data never had: a share
    // price framed down to -39 reads as though it could go negative.
    const lower = minimum >= 0 ? Math.max(0, minimum - margin) : minimum - margin;
    const upper = maximum <= 0 ? Math.min(0, maximum + margin) : maximum + margin;
    return { domain: [lower, upper] as [number, number] };
  }
  if (mode === "zero") {
    const minimum = Math.min(...finite); const maximum = Math.max(...finite);
    const ticks = niceTicks(Math.min(0, minimum), Math.max(0, maximum));
    if (ticks.length >= 2) return { domain: [ticks[0], ticks.at(-1)!] as [number, number], ticks };
    const top = maximum > 0 ? niceBound(maximum * 1.02) : 1;
    return { domain: [Math.min(0, niceBound(minimum)), top] as [number, number] };
  }
  const minimum = Math.min(...finite); const maximum = Math.max(...finite);
  if (minimum < 0) {
    const lower = minimum * 1.08; const upper = maximum > 0 ? maximum * 1.08 : 0;
    return { domain: [lower, upper] as [number, number] };
  }
  return { domain: [0, maximum === 0 ? 1 : maximum * 1.08] as [number, number] };
}

