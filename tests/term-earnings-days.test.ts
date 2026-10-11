import { describe, expect, it } from "vitest";
import { parseEarningsDay, weekdaysFrom } from "@/lib/adapters/nasdaq-earnings";

describe("Nasdaq's earnings calendar", () => {
  it("keeps the date, time, company, value, quarter and last year's figures, and drops the consensus", () => {
    const rows = parseEarningsDay({
      data: {
        rows: [
          { time: "time-pre-market", symbol: "JPM", name: "J P Morgan Chase & Co", marketCap: "$880,976,070,000", fiscalQuarterEnding: "Sep/2026", epsForecast: "$5.94", noOfEsts: "6", lastYearRptDt: "10/14/2025", lastYearEPS: "$5.07" },
          { time: "time-after-hours", symbol: "BRK/B", name: "Berkshire", marketCap: "N/A", fiscalQuarterEnding: "", lastYearRptDt: "N/A", lastYearEPS: "($0.12)" },
          { time: "time-not-supplied", symbol: "XYZ", name: "Block" },
        ],
      },
    });
    expect(rows[0]).toEqual({
      ticker: "JPM", name: "J P Morgan Chase & Co", time: "before", marketCap: 880_976_070_000, quarter: "Sep/2026",
      lastYearDate: "2025-10-14", lastYearEps: 5.07,
    });
    expect(rows[1]).toMatchObject({ ticker: "BRK.B", time: "after", marketCap: null, quarter: null, lastYearDate: null, lastYearEps: -0.12 });
    expect(rows[2].time).toBe("unknown");
    expect(JSON.stringify(rows)).not.toContain("5.94");
    expect(parseEarningsDay({ data: { rows: null } })).toEqual([]);
  });

  it("asks only for weekdays", () => {
    // 9 Oct 2026 is a Friday.
    expect(weekdaysFrom("2026-10-09", 3)).toEqual(["2026-10-09", "2026-10-12", "2026-10-13"]);
  });
});
