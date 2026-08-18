import { describe, expect, it } from "vitest";
import { relativeVolume } from "../lib/adapters/intraday";
import { hourMarks, priceTicks } from "../components/MarketPage";

describe("relative volume", () => {
  it("compares the same point in the session, not whole days", () => {
    // Today is quiet early on. Measured against whole days it would look
    // half-asleep; measured against the same three bars it is merely normal.
    const today = [100, 100, 100];
    const previous = [[100, 100, 100, 900], [100, 100, 100, 900]];
    expect(relativeVolume(today, previous)).toBeCloseTo(1, 6);
  });

  it("calls a busy morning busy", () => {
    // Two bars in, today has done 600 against 200 and 400 on the days before:
    // twice a normal start, measured only over the two bars they all share.
    expect(relativeVolume([300, 300], [[100, 100, 100], [200, 200, 200]])!).toBeCloseTo(2, 6);
  });

  it("tolerates a session one bar longer than its neighbours", () => {
    // A closing auction printing its own interval is routine, and demanding an
    // exact bar count answered "no idea" on every single day because of it.
    const today = Array(79).fill(10);
    const previous = [Array(78).fill(10), Array(78).fill(10)];
    expect(relativeVolume(today, previous)).toBeCloseTo(1, 6);
  });

  it("refuses a half day as a baseline for a whole one", () => {
    expect(relativeVolume(Array(78).fill(10), [Array(20).fill(10)])).toBeNull();
  });

  it("says nothing rather than one when there is nothing to compare with", () => {
    expect(relativeVolume([10, 20], [])).toBeNull();
    expect(relativeVolume([], [[10, 20]])).toBeNull();
  });

  it("treats an untraded interval as absent, not as zero volume", () => {
    expect(relativeVolume([10, null, 10], [[10, 10, 10]])!).toBeCloseTo(20 / 30, 6);
  });
});

describe("price axis", () => {
  it("fits the day rather than starting at zero", () => {
    // An index axis anchored at zero draws every session as a flat line.
    const ticks = priceTicks(7740, 7795);
    expect(ticks[0]).toBeGreaterThan(7000);
    expect(ticks).toEqual([7740, 7750, 7760, 7770, 7780, 7790]);
  });

  it("lands every label on a round number", () => {
    for (const tick of priceTicks(53_398, 53_741)) expect(tick % 50).toBe(0);
  });

  it("survives a range with no width at all", () => {
    expect(priceTicks(100, 100)).toEqual([100]);
    expect(priceTicks(10, 1)).toEqual([]);
    expect(priceTicks(Number.NaN, 5)).toEqual([]);
  });
});

describe("session hour marks", () => {
  it("marks each whole hour once", () => {
    const labels = ["09:30", "09:35", "10:00", "10:05", "10:30", "11:00"];
    expect(hourMarks(labels)).toEqual([
      { index: 2, text: "10AM" },
      { index: 5, text: "11AM" },
    ]);
  });

  it("reads afternoon hours on a twelve-hour clock", () => {
    expect(hourMarks(["12:00", "13:00", "16:00"]).map((mark) => mark.text)).toEqual(["12PM", "1PM", "4PM"]);
  });

  it("ignores a session that never lands on the hour", () => {
    expect(hourMarks(["09:35", "09:40"])).toEqual([]);
  });
});
