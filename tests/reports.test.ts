import { describe, expect, it } from "vitest";
import { fiscalEndName, reportRows } from "@/lib/io/reports";
import { parseSurprises } from "@/lib/adapters/nasdaq-estimates";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

describe("quarterly reports", () => {
  it("names a fiscal quarter the way Nasdaq does, 52/53-week ends included", () => {
    expect(fiscalEndName("2026-06-30")).toBe("Jun 2026");
    expect(fiscalEndName("2026-06-27")).toBe("Jun 2026");
    expect(fiscalEndName("2026-07-04")).toBe("Jun 2026");
  });

  it("reads Nasdaq's surprise table", () => {
    expect(parseSurprises({ earningsSurpriseTable: { rows: [{ fiscalQtrEnd: "Jun 2026", dateReported: "8/12/2026", eps: 1.47, consensusForecast: "1.43", percentageSurprise: "2.8" }] } }))
      .toEqual([{ fiscalEnd: "Jun 2026", reported: "2026-08-12", eps: 1.47, consensus: 1.43, surprise: 2.8 }]);
  });

  it("joins the filed quarter, its year-ago growth, its release, the move after it and the surprise", () => {
    const quarters = [
      { label: "Q4 FY2025", end: "2025-06-30", revenue: 100, eps: 1 },
      { label: "Q4 FY2026", end: "2026-06-30", revenue: 133.8, eps: 1.5 },
    ];
    const t = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-17"].map(day);
    const c = [100, 100, 101, 90, 95, 99];
    const [latest] = reportRows(quarters, ["2026-08-12", "2025-08-13"], { t, c }, [{ fiscalEnd: "Jun 2026", reported: "2026-08-12", eps: 1.47, consensus: 1.43, surprise: 2.8 }]);
    expect(latest.revenueYoy).toBeCloseTo(0.338);
    expect(latest.epsYoy).toBeCloseTo(0.5);
    expect(latest.released).toBe("2026-08-12");
    // Close before the release (11 Aug, 100) to the third session after the release day (17 Aug, 99).
    expect(latest.move3d).toBeCloseTo(-0.01);
    expect(latest.surprise).toBe(2.8);
  });

  it("measures growth from a loss as the improvement over its size", () => {
    const rows = reportRows([{ label: "a", end: "2025-03-31", revenue: 10, eps: -1 }, { label: "b", end: "2026-03-31", revenue: 12, eps: 0.5 }], [], { t: [], c: [] });
    expect(rows[0].epsYoy).toBeCloseTo(1.5);
  });
});
