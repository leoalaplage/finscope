import { describe, expect, it } from "vitest";
import { relativeVolume } from "../lib/adapters/intraday";
import { dateMarks, hourMarks, priceTicks, sharedPercentScale } from "../components/MarketPage";
import { MARKET_RANGES } from "../lib/adapters/intraday";

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

describe("one scale across the three indices", () => {
  const panel = (baseline: number | null, ...percents: number[]) => ({
    baseline,
    points: percents.map((percent) => ({ close: baseline == null ? percent : baseline * (1 + percent / 100) })),
  });

  it("takes its bounds from the deepest fall and the highest rise on the row", () => {
    // An S&P at −0.5%, a Nasdaq at −2% and a Dow at +2% are read against one
    // another, so all three are drawn between −2% and +2% — with the padding
    // that keeps a line off the edge of its panel.
    const scale = sharedPercentScale([panel(7_745, 0, -0.5), panel(26_500, 0, -2), panel(53_400, 0, 2)])!;
    expect(scale.low).toBeCloseTo(-2.48, 6);
    expect(scale.high).toBeCloseTo(2.48, 6);
  });

  it("keeps the baseline inside the scale on a window that never traded back to it", () => {
    const scale = sharedPercentScale([panel(100, 1, 3)])!;
    expect(scale.low).toBeLessThan(0);
    expect(scale.high).toBeGreaterThan(3);
  });

  it("says nothing rather than inventing a reference", () => {
    expect(sharedPercentScale([])).toBeNull();
    expect(sharedPercentScale([panel(null, 100, 101)])).toBeNull();
    expect(sharedPercentScale([{ baseline: 0, points: [{ close: 10 }] }])).toBeNull();
  });

  it("ignores an index with no baseline and scales on the ones that have one", () => {
    const scale = sharedPercentScale([panel(null, 100, 200), panel(100, 0, -1)])!;
    expect(scale.low).toBeCloseTo(-1.12, 6);
    expect(scale.high).toBeCloseTo(0.12, 6);
  });

  it("still has a width when every index sat exactly on its baseline", () => {
    const scale = sharedPercentScale([panel(100, 0), panel(200, 0)])!;
    expect(scale.high - scale.low).toBeGreaterThan(0);
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

describe("windows longer than a session", () => {
  it("offers the day first, because that is what the page opens on", () => {
    expect(MARKET_RANGES[0]).toBe("1D");
    expect(MARKET_RANGES).toContain("1Y");
  });

  it("spreads a handful of date marks across a long window", () => {
    const days = Array.from({ length: 250 }, (_, index) => `2026-01-${String((index % 28) + 1).padStart(2, "0")}`);
    const marks = dateMarks(days);
    expect(marks).toHaveLength(5);
    expect(marks[0].index).toBe(0);
    expect(marks.at(-1)!.index).toBe(days.length - 1);
    // Strictly increasing: two marks at the same x would overprint.
    for (let n = 1; n < marks.length; n++) expect(marks[n].index).toBeGreaterThan(marks[n - 1].index);
  });

  it("labels every point when the window is shorter than the mark count", () => {
    expect(dateMarks(["2026-08-17", "2026-08-18"])).toHaveLength(2);
    expect(dateMarks([])).toEqual([]);
  });

  it("adds the year only once the window crosses one", () => {
    // A day and month is what a reader wants inside a year; across five, the
    // month alone would repeat five times over.
    expect(dateMarks(["2026-01-05", "2026-06-05"])[0].text).toMatch(/\d/);
    expect(dateMarks(["2021-01-05", "2026-06-05"])[0].text).toMatch(/2[12]/);
  });
});
