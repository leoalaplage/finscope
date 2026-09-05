/**
 * Which measures the big chart is showing, and on which axis.
 *
 * Two rules, and the second is the one that matters. At most three measures,
 * because a fourth line on one frame stops being a comparison and starts being
 * a texture. And at most two units, because a chart can carry two axes and no
 * more — a third would put its zero and its span wherever the code happened to
 * place them, and every crossing point on the picture would be an artefact of
 * that choice rather than a fact about the business.
 *
 * A click always does something. When either limit is reached the oldest
 * measure makes room, so the selection rolls forward instead of refusing.
 */

export const MAX_METRICS = 3;
export const MAX_AXES = 2;

const distinctUnits = (metrics: string[], unitOf: (key: string) => string | null) =>
  new Set(metrics.map(unitOf).filter((unit): unit is string => unit != null)).size;

export function toggleMetric(current: string[], key: string, unitOf: (key: string) => string | null): string[] {
  if (current.includes(key)) return current.filter((item) => item !== key);
  const next = [...current, key];
  while (next.length > MAX_METRICS || distinctUnits(next, unitOf) > MAX_AXES) next.shift();
  return next;
}

/**
 * Which side each measure is read against.
 *
 * Measures sharing a unit share an axis, in the order they were chosen: the
 * first unit is the left-hand scale, the second is the right-hand one. Nothing
 * is rescaled to fit — two axes exist precisely so that neither series has to
 * be distorted into the other's range.
 */
export function axesFor(metrics: string[], unitOf: (key: string) => string | null): { units: string[]; axisOf: (key: string) => 0 | 1 } {
  const units: string[] = [];
  for (const key of metrics) {
    const unit = unitOf(key);
    if (unit != null && !units.includes(unit)) units.push(unit);
  }
  return {
    units,
    axisOf: (key) => (units.indexOf(unitOf(key) ?? units[0] ?? "") === 1 ? 1 : 0),
  };
}
