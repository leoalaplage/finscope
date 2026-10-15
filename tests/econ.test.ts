import { describe, expect, it } from "vitest";
import { blsCalendar, eventsFrom, moveAround, nasdaqOffset, newYorkEpoch, parseFigure, surpriseOf, transformSeries } from "../lib/econ";

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
