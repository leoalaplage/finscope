import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUOTE_BATCH, batched } from "../lib/adapters/quotes";
import { SP500_TOP_50 } from "../lib/sp500";

describe("asking for many quotes at once", () => {
  it("splits a request at the endpoint's own ceiling", () => {
    // Twenty-one symbols is refused outright rather than truncated, so this is
    // a measured limit and not a chosen one: exceeding it returns nothing.
    expect(QUOTE_BATCH).toBe(20);
    const batches = batched(SP500_TOP_50.map((member) => member.symbol));
    expect(batches).toHaveLength(3);
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(QUOTE_BATCH);
    expect(batches.flat()).toEqual(SP500_TOP_50.map((member) => member.symbol));
  });

  it("returns nothing for nothing, rather than one empty batch", () => {
    expect(batched([])).toEqual([]);
  });
});

describe("the index list the grid is drawn from", () => {
  it("holds fifty distinct companies, each with a label and a sector", () => {
    expect(SP500_TOP_50).toHaveLength(50);
    expect(new Set(SP500_TOP_50.map((member) => member.symbol)).size).toBe(50);
    for (const member of SP500_TOP_50) {
      expect(member.label.length).toBeGreaterThan(0);
      expect(member.sector.length).toBeGreaterThan(0);
    }
  });

  it("uses the market's symbol, not the exchange's, for dual-class names", () => {
    // Yahoo writes Berkshire's B shares with a hyphen; a dot returns nothing
    // and would leave a permanent hole in the grid.
    expect(SP500_TOP_50.find((member) => member.label === "BRK.B")?.symbol).toBe("BRK-B");
  });

  it("is dated, so its staleness is visible rather than assumed away", () => {
    const source = readFileSync(new URL("../lib/sp500.ts", import.meta.url), "utf8");
    expect(source).toMatch(/SP500_REVIEWED = "\d{4}-\d{2}-\d{2}"/);
  });
});

describe("the heat map's colour", () => {
  const source = readFileSync(new URL("../components/MarketHeatmap.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  it("is diverging: two hues meeting at a neutral, never a ramp", () => {
    expect(css).toContain("--heat-up:");
    expect(css).toContain("--heat-down:");
    // The midpoint is a real grey. A hue there would make a flat day read as a
    // pale version of a direction.
    expect(css).toMatch(/--heat-zero: #(ec|23)/);
    expect(source).toContain("var(--heat-zero)");
  });

  it("does not borrow the interface accent, which reads grey as a fill", () => {
    // `--accent` sits at chroma 0.074 in light mode: deliberately quiet for a
    // rule or a label, and wrong for a tile whose only job is to show a level.
    expect(source).not.toContain("var(--accent)");
    expect(source).not.toContain("var(--danger)");
  });

  it("never encodes direction by colour alone", () => {
    // Every tile carries its signed number; the losing tiles also take a hatch
    // where the display cannot be trusted with colour.
    expect(source).toContain("signedPercent");
    expect(css).toContain("forced-colors: active");
    expect(css).toContain(".heat-tile.down");
  });

  it("clamps the scale where a day's moves actually live", () => {
    // Scaling to the extremes instead would render an ordinary session as
    // fifty indistinguishable greys behind one outlier.
    expect(source).toContain("const FULL_SCALE = 3");
    expect(source).toContain("Math.min(1,");
  });

  it("picks its ink from the pole, because the two are not equally light", () => {
    expect(source).toContain("var(--heat-ink-up)");
    expect(source).toContain("var(--heat-ink-down)");
    expect(css).toContain("--heat-ink-up:");
  });

  it("offers the same data as a table", () => {
    expect(source).toContain("Read it as a table");
  });
});
