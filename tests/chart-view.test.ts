import { describe, expect, it } from "vitest";
import { clampViewport, panBy, rightMargin, shiftRange, stretchRange, windowOf, zoomAround } from "@/lib/io/chart-view";

describe("chart viewport", () => {
  it("opens on the latest candles with room after them", () => {
    const margin = rightMargin(100);
    const window = windowOf({ span: 100 + margin, offset: margin }, 500);
    expect(window.to).toBe(500);
    expect(window.from).toBe(400);
  });

  it("pans past the last candle and back into the history, by fractions of a candle", () => {
    const moved = panBy({ span: 100, offset: 0 }, 500, 30.5);
    expect(moved.offset).toBe(30.5);
    expect(windowOf(moved, 500).to).toBe(500);
    const back = panBy({ span: 100, offset: 0 }, 500, -200);
    expect(windowOf(back, 500)).toMatchObject({ from: 200, to: 300 });
  });

  it("always keeps a few candles on screen", () => {
    const far = clampViewport({ span: 100, offset: 10_000 }, 500);
    expect(far.offset).toBeLessThanOrEqual(85);
    const early = clampViewport({ span: 100, offset: -10_000 }, 500);
    expect(500 + early.offset).toBeGreaterThanOrEqual(15);
  });

  it("zooms around the point under the pointer", () => {
    const before = { span: 100, offset: 0 };
    const after = zoomAround(before, 500, 0.5, 0.5);
    expect(after.span).toBe(50);
    // The slot in the middle stays in the middle.
    const middle = (view: { span: number; offset: number }) => 500 + view.offset - view.span / 2;
    expect(middle(after)).toBeCloseTo(middle(before));
  });

  it("stretches and moves a price range, in logarithms on a log axis", () => {
    expect(stretchRange({ min: 90, max: 110 }, 2, false)).toEqual({ min: 80, max: 120 });
    const log = stretchRange({ min: 10, max: 1000 }, 0.5, true);
    expect(log.min).toBeCloseTo(31.62, 1);
    expect(log.max).toBeCloseTo(316.2, 0);
    expect(shiftRange({ min: 100, max: 200 }, 0.1, false)).toEqual({ min: 110, max: 210 });
  });
});
