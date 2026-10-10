import { describe, expect, it } from "vitest";
import { distanceToSegment, drawingAt, indexOfTime, readDrawings, timeOfIndex, type Drawing } from "@/lib/term/drawings";

const DAY = 86_400;
const days = [0, 1, 2, 3, 6].map((day) => day * DAY); // a weekend between the fourth and fifth

describe("anchoring drawings to time", () => {
  it("finds a candle by its time, and between candles by interpolation", () => {
    expect(indexOfTime(days, 2 * DAY)).toBe(2);
    expect(indexOfTime(days, 4.5 * DAY)).toBeCloseTo(3.5);
  });

  it("extends past either end at the usual spacing", () => {
    expect(indexOfTime(days, 8 * DAY)).toBeCloseTo(6);
    expect(indexOfTime(days, -DAY)).toBeCloseTo(-1);
  });

  it("is undone by timeOfIndex", () => {
    for (const index of [-2, 0, 1.25, 3.5, 4, 7]) expect(indexOfTime(days, timeOfIndex(days, index))).toBeCloseTo(index);
  });

  it("keeps a daily drawing on the same dates on weekly candles", () => {
    const weeks = [0, 7, 14, 21].map((day) => day * DAY);
    expect(indexOfTime(weeks, 10.5 * DAY)).toBeCloseTo(1.5);
  });
});

describe("hit-testing", () => {
  const screen = (anchor: { t: number; p: number }) => ({ x: anchor.t, y: anchor.p });
  const drawings: Drawing[] = [
    { id: "t", kind: "trend", a: { t: 0, p: 0 }, b: { t: 100, p: 100 } },
    { id: "h", kind: "hline", a: { t: 0, p: 300 }, b: { t: 0, p: 300 } },
    { id: "r", kind: "rect", a: { t: 400, p: 400 }, b: { t: 500, p: 500 } },
  ];

  it("measures distance to a segment, not the infinite line", () => {
    expect(distanceToSegment(50, 50, 0, 0, 100, 100)).toBeCloseTo(0);
    expect(distanceToSegment(200, 200, 0, 0, 100, 100)).toBeCloseTo(Math.hypot(100, 100));
  });

  it("finds the drawing under the pointer", () => {
    expect(drawingAt(drawings, { x: 52, y: 50 }, screen, 6)?.id).toBe("t");
    expect(drawingAt(drawings, { x: 900, y: 303 }, screen, 6)?.id).toBe("h");
    expect(drawingAt(drawings, { x: 450, y: 450 }, screen, 6)?.id).toBe("r");
    expect(drawingAt(drawings, { x: 50, y: 200 }, screen, 6)).toBeNull();
  });
});

describe("stored drawings", () => {
  it("keeps well-formed drawings and drops the rest", () => {
    const stored = JSON.stringify({
      AAPL: [{ id: "1", kind: "hline", a: { t: 1, p: 2 }, b: { t: 1, p: 2 } }, { id: "2", kind: "circle", a: { t: 1, p: 2 }, b: { t: 1, p: 2 } }],
      MSFT: "nonsense",
    });
    expect(readDrawings(stored)).toEqual({ AAPL: [{ id: "1", kind: "hline", a: { t: 1, p: 2 }, b: { t: 1, p: 2 } }] });
    expect(readDrawings("{")).toEqual({});
  });
});
