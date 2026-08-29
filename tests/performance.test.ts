import { describe, expect, it } from "vitest";
import { performanceOf, WINDOWS } from "../lib/performance";
import type { MarketSession } from "../lib/adapters/yahoo";

/** A session with only the fields the calculation reads. */
const at = (date: string, close: number | null): MarketSession => ({ date, close, adjustedClose: close });

/** Daily closes every calendar day, so a window's anchor is unambiguous. */
function series(from: string, days: number, price: (index: number) => number): MarketSession[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (unused, index) =>
    at(new Date(start + index * 86_400_000).toISOString().slice(0, 10), price(index)));
}

describe("a performance table's windows", () => {
  it("states every window from one pass over the sessions", () => {
    // 100 on day zero, rising by one a day for six years.
    const sessions = series("2020-01-01", 2200, (index) => 100 + index);
    const result = performanceOf(sessions);
    expect(result.asOf).toBe(sessions.at(-1)!.date);
    expect(result.price).toBe(100 + 2199);
    for (const window of WINDOWS) expect(result.changes[window.id], window.label).not.toBeNull();
    // A day back is one point on a series that gains one a day.
    expect(result.changes.d1).toBeCloseTo(1 / (100 + 2198), 10);
    // A week back is seven.
    expect(result.changes.w1).toBeCloseTo(7 / (100 + 2192), 10);
  });

  it("compares against the previous session, not the previous calendar day", () => {
    /*
     * On a Monday the comparison a reader means is Friday's close. Subtracting
     * a calendar day would land on Sunday, find no session, and report no move
     * at all across every weekend.
     */
    const sessions = [at("2026-08-27", 100), at("2026-08-28", 110)];
    // A Friday and the Monday after it, with the weekend absent as it is in
    // every real feed.
    const weekend = [at("2026-08-28", 100), at("2026-08-31", 110)];
    expect(performanceOf(sessions).changes.d1).toBeCloseTo(0.1, 10);
    expect(performanceOf(weekend).changes.d1).toBeCloseTo(0.1, 10);
  });

  it("measures year to date from the last close of the previous year", () => {
    const sessions = [at("2025-12-31", 200), at("2026-01-02", 210), at("2026-08-28", 260)];
    expect(performanceOf(sessions).changes.ytd).toBeCloseTo(0.3, 10);
  });

  it("reports nothing for a window older than the company's history", () => {
    // A five-year return for a company that listed two years ago is not a
    // small error, it is a fabricated one.
    const sessions = series("2024-09-01", 400, () => 50);
    const result = performanceOf(sessions);
    expect(result.changes.y5).toBeNull();
    expect(result.changes.m1).toBe(0);
  });

  it("ignores sessions with no close rather than treating them as zero", () => {
    const sessions = [at("2026-08-20", 100), at("2026-08-27", null), at("2026-08-28", 120)];
    const result = performanceOf(sessions);
    expect(result.price).toBe(120);
    expect(result.changes.d1).toBeCloseTo(0.2, 10);
  });

  it("answers nothing at all for a company with no usable session", () => {
    expect(performanceOf([])).toEqual({ price: null, asOf: null, changes: {} });
    expect(performanceOf([at("2026-08-28", null)]).price).toBeNull();
  });
});
