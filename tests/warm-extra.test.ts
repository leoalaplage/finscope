import { describe, expect, it } from "vitest";
import { MIDCAP } from "../lib/midcap";
import { extraTickers, nextSlice, rememberIn } from "../lib/warm-extra";

describe("keeping more companies ready than the index", () => {
  it("remembers the companies readers open, newest first, once each, up to a limit", () => {
    let opened = rememberIn([], "hims", "2026-09-15T10:00:00Z");
    opened = rememberIn(opened, "RKLB", "2026-09-15T11:00:00Z");
    opened = rememberIn(opened, "HIMS", "2026-09-15T12:00:00Z");
    expect(opened.map((each) => each.ticker)).toEqual(["HIMS", "RKLB"]);
    expect(rememberIn(opened, "SOFI", "2026-09-15T13:00:00Z", 2).map((each) => each.ticker)).toEqual(["SOFI", "HIMS"]);
  });

  it("keeps opened companies and the mid-caps, and never an index company twice", () => {
    const list = extraTickers([{ ticker: "RKLB", at: "x" }, { ticker: "AAPL", at: "x" }], ["AAPL", "MSFT"]);
    expect(list[0]).toBe("RKLB");
    expect(list).not.toContain("AAPL");
    expect(list).toContain("HIMS");
    expect(new Set(list).size).toBe(list.length);
    expect(MIDCAP.length).toBeGreaterThan(390);
  });

  it("walks the list from a cursor and comes round to the start", () => {
    const list = ["A", "B", "C", "D", "E"];
    expect(nextSlice(list, 0, 2)).toEqual({ slice: ["A", "B"], next: 2 });
    expect(nextSlice(list, 4, 3)).toEqual({ slice: ["E", "A", "B"], next: 2 });
    expect(nextSlice(list, 12, 10)).toEqual({ slice: ["C", "D", "E", "A", "B"], next: 2 });
    expect(nextSlice([], 3)).toEqual({ slice: [], next: 0 });
  });
});
