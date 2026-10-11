import { describe, expect, it } from "vitest";
import { layoutMap, moveColor } from "@/lib/term/heatmap-layout";
import { classify } from "@/lib/term/sectors";

const items = [
  { ticker: "AAPL", sector: "Technology", industry: "Technology", cap: 4000 },
  { ticker: "NVDA", sector: "Technology", industry: "Semiconductors", cap: 5000 },
  { ticker: "AMD", sector: "Technology", industry: "Semiconductors", cap: 1000 },
  { ticker: "JPM", sector: "Financial", industry: "Banking", cap: 800 },
  { ticker: "BAD", sector: "Financial", industry: "Banking", cap: 0 },
];

describe("the market map layout", () => {
  const area = { x: 0, y: 0, width: 1000, height: 600 };
  const map = layoutMap(items, area);

  it("gives each sector, industry and company an area in proportion to its value", () => {
    const tech = map.find((sector) => sector.name === "Technology")!;
    const financial = map.find((sector) => sector.name === "Financial")!;
    expect((tech.width * tech.height) / (financial.width * financial.height)).toBeCloseTo(10000 / 800, 1);
    const tiles = map.flatMap((sector) => sector.industries.flatMap((industry) => industry.tiles));
    expect(tiles.map((tile) => tile.item.ticker).sort()).toEqual(["AAPL", "AMD", "JPM", "NVDA"]);
  });

  it("keeps every tile inside its sector, under the header strip", () => {
    for (const sector of map) {
      for (const tile of sector.industries.flatMap((industry) => industry.tiles)) {
        expect(tile.x).toBeGreaterThanOrEqual(sector.x - 1e-6);
        expect(tile.x + tile.width).toBeLessThanOrEqual(sector.x + sector.width + 1e-6);
        expect(tile.y).toBeGreaterThanOrEqual(sector.y + (sector.header ? 16 : 0) - 1e-6);
        expect(tile.y + tile.height).toBeLessThanOrEqual(sector.y + sector.height + 1e-6);
      }
    }
  });
});

describe("move colours", () => {
  it("run from red through grey to green and saturate", () => {
    expect(moveColor(0, 3)).toBe("rgb(65, 69, 84)");
    expect(moveColor(3, 3)).toBe("rgb(48, 204, 90)");
    expect(moveColor(-9, 3)).toBe("rgb(246, 53, 56)");
    expect(moveColor(null, 3)).toBe("rgb(42, 46, 57)");
  });
});

describe("sectors", () => {
  it("file a label under its sector and move the members that belong elsewhere", () => {
    expect(classify("NVDA", "Semiconductors")).toEqual({ sector: "Technology", industry: "Semiconductors" });
    expect(classify("UNH", "Insurance")).toEqual({ sector: "Healthcare", industry: "Health plans" });
    expect(classify("KLAC", "Instruments")).toEqual({ sector: "Technology", industry: "Semiconductors" });
    expect(classify("GOOGL", "Communication")).toEqual({ sector: "Communication Services", industry: "Internet content" });
    expect(classify("ZZZ", null)).toEqual({ sector: "Industrials", industry: "Other" });
  });
});
