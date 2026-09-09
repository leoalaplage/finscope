/**
 * How straight a series is on a log scale, which is what steady compounding is.
 *
 * A five-year growth rate says where a measure ended up; it says nothing about
 * the road. Two companies can both compound free cash flow per share at twelve
 * per cent — one a step a year, the other a collapse and a recovery — and only
 * the first is a business you can extrapolate from. R² on the log of the series
 * is the difference: one is a straight line, the other is not.
 *
 * Plain JavaScript, because the quality score's own configuration modules are,
 * and because the same fit answers two callers — the company page's free cash
 * flow panel and the screener's Quality pillar. One of them computing it a
 * second time is how two numbers on one site come to disagree.
 */

/**
 * The fit, or nothing where there is nothing to fit.
 *
 * Three points is the floor: two are a straight line by definition and would
 * score a perfect one. A zero or negative year has no logarithm, and a series
 * that does not vary has no variance to explain — both are refusals rather than
 * a nought, because "we cannot measure this" and "this is erratic" are opposite
 * statements about a company.
 */
export function logLinearRSquared(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  if (points.some((point) => !(point.value > 0) || !Number.isFinite(point.x))) return null;

  const samples = points.map((point) => ({ x: point.x, y: Math.log(point.value) }));
  const meanX = samples.reduce((sum, point) => sum + point.x, 0) / samples.length;
  const meanY = samples.reduce((sum, point) => sum + point.y, 0) / samples.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const point of samples) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.min(1, Math.max(0, (sxy * sxy) / (sxx * syy)));
}
