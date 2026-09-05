import { describe, expect, it } from "vitest";
import { closesAsOf, overlayWindow } from "../components/io/overlay";

/**
 * The share price beside a filed measure.
 *
 * The join is the whole feature: a quote read at each period end is what lets
 * one chart carry free cash flow per share and what the market charged for it,
 * on the same dates, under one crosshair.
 */
describe("the share price overlay", () => {
  const bars = [
    { date: "2023-12-29", close: 100 },
    { date: "2024-03-28", close: 120 },
    { date: "2024-06-28", close: 130 },
    { date: "2024-09-30", close: 145 },
  ];

  it("reads the last close on or before each period end", () => {
    expect(closesAsOf(bars, ["2024-03-31", "2024-06-30", "2024-09-30"])).toEqual([120, 130, 145]);
  });

  it("carries the previous close rather than inventing a session", () => {
    // A period ending on a Sunday has no close of its own, and the honest
    // answer is Friday's — not an average, not the next Monday's.
    expect(closesAsOf(bars, ["2024-06-30"])).toEqual([130]);
  });

  it("states nothing for a period the quotes do not reach back to", () => {
    expect(closesAsOf(bars, ["2019-12-31", "2024-03-31"])).toEqual([null, 120]);
  });

  it("returns one figure per period, so the two series stay aligned", () => {
    const dates = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"];
    expect(closesAsOf(bars, dates)).toHaveLength(dates.length);
  });

  it("asks for the coarsest quotes that still land on every period", () => {
    const recent = overlayWindow([{ end: "2022-12-31" }, { end: "2023-12-31" }]);
    expect(recent?.frequency).toBe("weekly");
    const long = overlayWindow([{ end: "2006-12-31" }, { end: "2024-12-31" }]);
    expect(long?.frequency).toBe("monthly");
  });

  it("starts before the first period so that period has a close", () => {
    const asked = overlayWindow([{ end: "2024-03-31" }]);
    expect(asked?.start).toBe("2024-02-15");
  });

  it("asks for nothing when there is no period to cover", () => {
    expect(overlayWindow([])).toBeNull();
  });
});
