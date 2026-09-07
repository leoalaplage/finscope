import { describe, expect, it } from "vitest";
import { closesAsOf, daysBetween, overlayCloses, overlayWindow } from "../components/io/overlay";

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

  const value = (closes: ReturnType<typeof closesAsOf>) => closes.map((close) => close?.value ?? null);

  it("reads the last close on or before each period end", () => {
    expect(value(closesAsOf(bars, ["2024-03-31", "2024-06-30", "2024-09-30"]))).toEqual([120, 130, 145]);
  });

  it("names the session each close actually happened on", () => {
    // The gap between a period end and the close drawn on it is the one thing
    // the chart cannot show, so the join has to hand it back.
    expect(closesAsOf(bars, ["2024-03-31"])).toEqual([{ value: 120, on: "2024-03-28" }]);
    expect(daysBetween("2024-03-28", "2024-03-31")).toBe(3);
  });

  it("carries the previous close rather than inventing a session", () => {
    // A period ending on a Sunday has no close of its own, and the honest
    // answer is Friday's — not an average, not the next Monday's.
    expect(value(closesAsOf(bars, ["2024-06-30"]))).toEqual([130]);
  });

  it("states nothing for a period the quotes do not reach back to", () => {
    expect(value(closesAsOf(bars, ["2019-12-31", "2024-03-31"]))).toEqual([null, 120]);
  });

  it("returns one figure per period, so the two series stay aligned", () => {
    const dates = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"];
    expect(closesAsOf(bars, dates)).toHaveLength(dates.length);
    expect(overlayCloses(bars, dates)).toHaveLength(dates.length);
  });

  it("prices the newest period at the latest close, not at its own end", () => {
    // The period the market is pricing has no filing to close it, so reading
    // it at its end stops the line a quarter short of the market. Apple showed
    // $283.78 against its June period while trading at $319.97.
    const closes = overlayCloses(bars, ["2024-03-31", "2024-06-30"]);
    expect(closes[0]).toEqual({ value: 120, on: "2024-03-28" });
    expect(closes[1]).toEqual({ value: 145, on: "2024-09-30" });
  });

  it("leaves every earlier period on its own end", () => {
    // Only the last point moves. An earlier period has its filing out, and the
    // price beside it must be the one a reader of that filing was looking at.
    const closes = overlayCloses(bars, ["2024-03-31", "2024-06-30", "2024-09-30"]);
    expect(value(closes)).toEqual([120, 130, 145]);
    expect(closes.map((close) => close?.on)).toEqual(["2024-03-28", "2024-06-28", "2024-09-30"]);
  });

  it("moves nothing when the quotes stop before the newest period", () => {
    const closes = overlayCloses(bars, ["2024-09-30", "2025-06-30"]);
    expect(value(closes)).toEqual([145, 145]);
  });

  it("asks weekly, so a period end is never priced a month early", () => {
    // A monthly bar is stamped at its month end, and a fiscal quarter rarely
    // ends there: the newest monthly bar at or before Apple's 27 June close is
    // the one dated 29 May. Measured over its seventy trailing periods, monthly
    // quotes ran 18.8 days early on average and 29 at worst; weekly, 1.1 and 2.
    expect(overlayWindow([{ end: "2022-12-31" }, { end: "2023-12-31" }])?.frequency).toBe("weekly");
    expect(overlayWindow([{ end: "2006-12-31" }, { end: "2024-12-31" }])?.frequency).toBe("weekly");
  });

  it("starts before the first period so that period has a close", () => {
    const asked = overlayWindow([{ end: "2024-03-31" }]);
    expect(asked?.start).toBe("2024-02-15");
  });

  it("asks for nothing when there is no period to cover", () => {
    expect(overlayWindow([])).toBeNull();
  });
});
