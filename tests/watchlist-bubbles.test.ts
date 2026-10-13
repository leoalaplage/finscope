import { describe, expect, it } from "vitest";
import { bubbleLayout } from "../lib/watchlist-bubbles";
import type { PerformanceRow } from "../app/api/performance/route";
const row = (ticker: string, change: number | null, marketCap: number | null, sector = "Technology"): PerformanceRow => ({ ticker, changes: { d1: change }, price: 100, asOf: "2026-10-13", sector, marketCap });
describe("watchlist sector bubbles", () => {
  it("keeps missing returns out, while zero remains a valid return", () => {
    const result = bubbleLayout([row("A", 0, 100), row("B", null, 100)], "d1", null);
    expect(result.points.map((point) => point.ticker)).toEqual(["A"]);
    expect(result.missing).toBe(1);
    expect(result.min).toBeLessThan(0);
    expect(result.max).toBeGreaterThan(0);
  });
  it("uses the table's return and proportional market-cap areas", () => {
    const { points, min, max } = bubbleLayout([row("A", -.05, 100), row("B", .1, 400)], "d1", null);
    expect(points[0].value).toBe(-5);
    expect(points[1].value).toBe(10);
    expect(points[1].r ** 2 / points[0].r ** 2).toBeCloseTo(4);
    expect(min).toBeLessThan(-5);
    expect(max).toBeGreaterThan(10);
  });
  it("filters sectors, keeps unavailable capitalization, and handles empty periods", () => {
    const rows = [row("A", .1, null), row("B", -.1, 400, "Energy")];
    const result = bubbleLayout(rows, "d1", "Technology");
    expect(result.points.map((point) => point.ticker)).toEqual(["A"]);
    expect(result.points[0].marketCap).toBeNull();
    expect(result.sectors).toEqual(["Energy", "Technology"]);
    expect(bubbleLayout(rows, "y10", null).points).toEqual([]);
  });
});

describe("sector colours", () => {
  it("gives every sector of a watchlist its own colour, unchanged by a filter", () => {
    const rows = ["Software", "Semiconductors", "Banking", "Energy", "Retail", "Media"].map((sector, index) => row(`T${index}`, .01, 100, sector));
    const all = bubbleLayout(rows, "d1", null).colors;
    expect(new Set(all.values()).size).toBe(6);
    expect(bubbleLayout(rows, "d1", "Energy").colors.get("Energy")).toBe(all.get("Energy"));
  });
});
