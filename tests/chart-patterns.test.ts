import { describe, expect, it } from "vitest";
import { chartPatterns } from "@/lib/io/chart-patterns";
import { averageTrueRange, pivots, type Series } from "@/lib/io/technicals";

/** Candles along straight legs through the given turning points, 10 bars a leg. */
function path(points: number[], perLeg = 10): Series {
  const c: number[] = [];
  for (let leg = 0; leg < points.length - 1; leg++) {
    for (let step = 0; step < perLeg; step++) c.push(points[leg] + ((points[leg + 1] - points[leg]) * step) / perLeg);
  }
  c.push(points.at(-1)!);
  return { t: c.map((_, index) => index * 86_400), o: c, h: c.map((x) => x + 0.3), l: c.map((x) => x - 0.3), c };
}
const find = (series: Series) => {
  const atr = [...averageTrueRange(series)].reverse().find((value): value is number => value != null)!;
  return chartPatterns(series, pivots(series, 5), atr);
};
const kinds = (series: Series) => find(series).map((pattern) => pattern.kind);

describe("chart patterns", () => {
  it("finds a symmetrical triangle: lower highs and higher lows", () => {
    expect(kinds(path([100, 120, 82, 116, 88, 112, 94, 108, 100]))).toContain("symmetricalTriangle");
  });
  it("finds an ascending triangle: flat highs and higher lows", () => {
    expect(kinds(path([100, 120, 84, 120, 92, 120, 100, 120, 110]))).toContain("ascendingTriangle");
  });
  it("finds a descending triangle: lower highs and flat lows", () => {
    expect(kinds(path([100, 116, 80, 108, 80, 100, 80, 94, 86]))).toContain("descendingTriangle");
  });
  it("finds a channel up", () => {
    expect(kinds(path([100, 120, 104, 130, 114, 140, 124, 150, 140]))).toContain("channelUp");
  });
  it("finds a double top with its neckline, and the breakdown under it", () => {
    const top = find(path([80, 100, 120, 96, 120, 90]));
    const pattern = top.find((entry) => entry.kind === "doubleTop")!;
    expect(pattern).toBeDefined();
    expect(pattern.lines[0].a.price).toBeCloseTo(95.7, 0);
    expect(pattern.breakout).toBe("down");
    expect(pattern.target!).toBeLessThan(pattern.lines[0].a.price);
  });
  it("finds a head and shoulders", () => {
    expect(kinds(path([80, 110, 96, 125, 96, 110, 92]))).toContain("headAndShoulders");
  });
  it("finds nothing in a straight line", () => {
    expect(find(path([100, 200]))).toEqual([]);
  });
});
