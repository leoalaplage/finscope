import { describe, expect, it } from "vitest";
import { blsCalendar, eventsFrom, moveAround, nasdaqOffset, newYorkEpoch, parseFigure, releaseWindow, seriesForEvent, seriesFreshness, surpriseOf, transformSeries } from "../lib/econ";

describe("the US economic calendar", () => {
  it("reads Nasdaq's rows: US only, the noise left out, a monthly and a yearly CPI told apart", () => {
    const rows = [
      { gmt: "08:30", country: "United States", eventName: "CPI", actual: "3.7%", consensus: "3.6%", previous: "3.4%" },
      { gmt: "08:30", country: "United States", eventName: "CPI", actual: "0.6%", consensus: "0.6%", previous: "0.4%" },
      { gmt: "08:30", country: "United States", eventName: "CPI Index, n.s.a.", actual: "336.94", consensus: " ", previous: "334.98" },
      { gmt: "06:00", country: "United States", eventName: "OPEC Monthly Report", actual: "&nbsp;", consensus: " ", previous: "&nbsp;" },
      { gmt: "07:00", country: "Germany", eventName: "CPI", actual: "2.1%", consensus: "2.0%", previous: "2.2%" },
    ];
    const events = eventsFrom(rows, "2026-10-14");
    expect(events.map((event) => [event.name, event.importance, event.surprise])).toEqual([["CPI, y/y", "high", "above"], ["CPI, m/m", "high", "inline"]]);
  });

  it("parses figures and only compares like with like", () => {
    expect(parseFigure("1,701K")).toEqual({ value: 1701, unit: "K" });
    expect(parseFigure("-17.0K")).toEqual({ value: -17, unit: "K" });
    expect(surpriseOf("29K", "89K")).toBe("below");
    expect(surpriseOf("3.7%", "3.6M")).toBeNull();
  });

  it("realigns Nasdaq's days on the BLS's calendar", () => {
    const ics = "BEGIN:VEVENT\nDTSTART;TZID=US-Eastern:20261014T083000\nSUMMARY:Consumer Price Index\nEND:VEVENT";
    expect(blsCalendar(ics)).toEqual([{ date: "2026-10-14", time: "08:30", name: "Consumer Price Index" }]);
    expect(nasdaqOffset({ sameDay: false, nextDay: true })).toBe(1);
    expect(nasdaqOffset({ sameDay: true, nextDay: false })).toBe(0);
  });

  it("measures the market from the last price before a release to thirty minutes after", () => {
    const at = newYorkEpoch("2026-10-14", "08:30");
    expect(new Date(at).toISOString()).toBe("2026-10-14T12:30:00.000Z");
    const bars = { t: [at / 1000 - 300, at / 1000, at / 1000 + 900, at / 1000 + 1800, at / 1000 + 2400], c: [100, 99, 98.5, 99.3, 120] };
    expect(moveAround(bars, at, 30)).toEqual({ before: 100, after: 99.3 });
  });

  it("turns the BLS's index levels into rates", () => {
    const rows = [
      { year: "2025", period: "M09", value: "324.80" }, { year: "2026", period: "M08", value: "334.131" }, { year: "2026", period: "M09", value: "336.298" }, { year: "2026", period: "M13", value: "1" },
    ];
    expect(transformSeries(rows, "mom")).toEqual([{ period: "2026-09", value: 0.65 }]);
    expect(transformSeries(rows, "yoy")).toEqual([{ period: "2026-09", value: 3.54 }]);
  });
});

describe("as soon as it is out", () => {
  it("reads every fifteen seconds from five minutes before a market-moving release to twenty-five after", () => {
    const cpi = [{ date: "2026-10-14", time: "08:30", importance: "high" as const }];
    expect(releaseWindow(cpi, Date.parse("2026-10-14T12:26:00Z"))).toBe(true);
    expect(releaseWindow(cpi, Date.parse("2026-10-14T12:54:00Z"))).toBe(true);
    expect(releaseWindow(cpi, Date.parse("2026-10-14T13:10:00Z"))).toBe(false);
    expect(releaseWindow([{ ...cpi[0], importance: "low" as const }], Date.parse("2026-10-14T12:31:00Z"))).toBe(false);
  });

  it("reads the official series every two minutes for three hours after a BLS release, under a key of its own", () => {
    const releases = [{ date: "2026-10-14", time: "08:30", name: "Consumer Price Index" }, { date: "2026-10-14", time: "08:30", name: "Real Earnings" }];
    expect(seriesFreshness(releases, Date.parse("2026-10-14T13:00:00Z"))).toEqual({ stamp: "2026-10-14T08:30", ttl: 120 });
    expect(seriesFreshness(releases, Date.parse("2026-10-15T09:00:00Z")).ttl).toBe(21_600);
    expect(seriesFreshness(releases, Date.parse("2026-10-14T12:00:00Z")).stamp).toBe("none");
  });

  it("knows which events have an official history", () => {
    expect(seriesForEvent("CPI, y/y")).toBe("CUUR0000SA0");
    expect(seriesForEvent("Core PPI, m/m")).toBe("WPSFD49104");
    expect(seriesForEvent("Nonfarm Payrolls")).toBe("CES0000000001");
    expect(seriesForEvent("Average Hourly Earnings (YoY)")).toBe("CES0500000003");
    expect(seriesForEvent("Average Hourly Earnings")).toBe("CES0500000003:mom");
    expect(seriesForEvent("Retail Sales, m/m")).toBeNull();
  });
});
