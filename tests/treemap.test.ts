import { describe, expect, it } from "vitest";
import { groupedTreemap, squarify, type Rect } from "../lib/treemap";

const AREA = (rect: { width: number; height: number }) => rect.width * rect.height;
const BOX: Rect = { x: 0, y: 0, width: 800, height: 400 };

/** Do two rectangles share any interior? Overlap is the failure that matters. */
function overlaps(a: Rect, b: Rect) {
  const slack = 1e-6;
  return a.x < b.x + b.width - slack && b.x < a.x + a.width - slack
    && a.y < b.y + b.height - slack && b.y < a.y + a.height - slack;
}

describe("squarified treemap", () => {
  const weights = [40, 25, 15, 10, 6, 3, 1];
  const items = weights.map((weight, index) => ({ weight, data: `item-${index}` }));

  it("gives every item an area proportional to its weight", () => {
    const placed = squarify(items, BOX);
    expect(placed).toHaveLength(weights.length);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    for (const tile of placed) {
      const weight = weights[Number(tile.data.split("-")[1])];
      expect(AREA(tile)).toBeCloseTo(AREA(BOX) * (weight / total), 4);
    }
  });

  it("fills the rectangle exactly, with no gap and no spill", () => {
    const placed = squarify(items, BOX);
    expect(placed.reduce((sum, tile) => sum + AREA(tile), 0)).toBeCloseTo(AREA(BOX), 4);
    for (const tile of placed) {
      expect(tile.x).toBeGreaterThanOrEqual(-1e-6);
      expect(tile.y).toBeGreaterThanOrEqual(-1e-6);
      expect(tile.x + tile.width).toBeLessThanOrEqual(BOX.width + 1e-6);
      expect(tile.y + tile.height).toBeLessThanOrEqual(BOX.height + 1e-6);
    }
  });

  it("never overlaps two tiles", () => {
    const placed = squarify(items, BOX);
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        expect(overlaps(placed[a], placed[b])).toBe(false);
      }
    }
  });

  it("keeps tiles closer to square than slice-and-dice would", () => {
    // The whole point of squarifying: a slice of a 800×400 box for the 1%
    // item would be 8px wide and 400 tall, an aspect ratio of 50.
    const placed = squarify(items, BOX);
    const worst = Math.max(...placed.map((tile) => Math.max(tile.width / tile.height, tile.height / tile.width)));
    expect(worst).toBeLessThan(6);
  });

  it("puts the largest item first and drops the weightless", () => {
    const placed = squarify(
      [{ weight: 1, data: "small" }, { weight: 10, data: "big" }, { weight: 0, data: "none" }, { weight: Number.NaN, data: "broken" }],
      BOX,
    );
    expect(placed.map((tile) => tile.data)).toEqual(["big", "small"]);
  });

  it("returns nothing for an empty list or an empty box", () => {
    expect(squarify([], BOX)).toEqual([]);
    expect(squarify(items, { x: 0, y: 0, width: 0, height: 100 })).toEqual([]);
  });
});

describe("grouped treemap", () => {
  const groups = [
    { key: "Technology", items: [{ weight: 30, data: "A" }, { weight: 20, data: "B" }] },
    { key: "Health care", items: [{ weight: 15, data: "C" }] },
    { key: "Energy", items: [{ weight: 5, data: "D" }, { weight: 5, data: "E" }] },
  ];

  it("sizes a sector to the sum of its members", () => {
    const placed = groupedTreemap(groups, BOX);
    const total = 75;
    for (const group of placed) {
      const expected = groups.find((item) => item.key === group.key)!.items.reduce((sum, item) => sum + item.weight, 0);
      expect(group.weight).toBe(expected);
      expect(AREA(group.rect)).toBeCloseTo(AREA(BOX) * (expected / total), 4);
    }
  });

  it("keeps every member inside its own sector's block", () => {
    for (const group of groupedTreemap(groups, BOX)) {
      const sectorArea = AREA(group.rect);
      expect(group.items.reduce((sum, tile) => sum + AREA(tile), 0)).toBeCloseTo(sectorArea, 4);
      for (const tile of group.items) {
        expect(tile.x).toBeGreaterThanOrEqual(group.rect.x - 1e-6);
        expect(tile.y).toBeGreaterThanOrEqual(group.rect.y - 1e-6);
        expect(tile.x + tile.width).toBeLessThanOrEqual(group.rect.x + group.rect.width + 1e-6);
        expect(tile.y + tile.height).toBeLessThanOrEqual(group.rect.y + group.rect.height + 1e-6);
      }
    }
  });

  it("never overlaps two sectors", () => {
    const placed = groupedTreemap(groups, BOX);
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        expect(overlaps(placed[a].rect, placed[b].rect)).toBe(false);
      }
    }
  });

  it("drops a sector whose members all weigh nothing", () => {
    const placed = groupedTreemap([...groups, { key: "Empty", items: [{ weight: 0, data: "Z" }] }], BOX);
    expect(placed.map((group) => group.key)).not.toContain("Empty");
  });
});
