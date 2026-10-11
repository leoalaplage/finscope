import { describe, expect, it } from "vitest";
import { reactions, summarise } from "@/lib/term/reaction";
import { seasonality } from "@/lib/term/seasonality";
import { quadrantOf, rotation } from "@/lib/term/rrg";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

describe("earnings reactions", () => {
  // Sessions Mon 5 Oct to Fri 6 Nov 2026, closes 100, 101, 102…
  const t: number[] = [];
  const c: number[] = [];
  for (let date = new Date("2026-10-05T00:00:00Z"), close = 100; date < new Date("2026-11-07T00:00:00Z"); date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    t.push(date.getTime() / 1000);
    c.push(close++);
  }

  it("runs from the close before the filing to the session after it, then five and twenty sessions on", () => {
    // Filed Wed 7 Oct: before = Tue 6 Oct close (101), after = Thu 8 Oct (103).
    const [row] = reactions(["2026-10-07"], { t, c });
    expect(row.before).toBe(101);
    expect(row.day).toBeCloseTo(103 / 101 - 1);
    expect(row.week).toBeCloseTo(107 / 101 - 1);
    expect(row.month).toBeCloseTo(122 / 101 - 1);
  });

  it("leaves out what has not happened yet and summarises the rest", () => {
    const rows = reactions(["2026-11-06", "2026-10-07", "2026-10-20"], { t, c });
    expect(rows.map((row) => row.date)).toEqual(["2026-10-20", "2026-10-07"]);
    expect(rows[0].month).toBeNull();
    const summary = summarise(rows);
    expect(summary.count).toBe(2);
    expect(summary.up).toBe(2);
  });
});

describe("seasonality", () => {
  it("reads each month against the month before, by year, with the months' statistics", () => {
    const months = ["2024-12-01", "2025-01-01", "2025-02-01", "2026-01-01", "2026-02-01"];
    const result = seasonality({ t: months.map(day), c: [100, 110, 99, 105, 126] }, new Date("2026-02-15T00:00:00Z"));
    expect(result.years.map((row) => row.year)).toEqual([2026, 2025]);
    expect(result.years[1].months[0]).toBeCloseTo(0.1);
    expect(result.years[1].months[1]).toBeCloseTo(-0.1);
    expect(result.years[0].months[0]).toBeCloseTo(105 / 99 - 1);
    expect(result.stats[1].up).toBe(1);
    expect(result.stats[1].count).toBe(2);
    expect(result.running).toEqual({ year: 2026, month: 1 });
  });
});

describe("relative rotation", () => {
  it("sends a sector that keeps beating the market, faster and faster, to the leading quadrant", () => {
    const weeks = Array.from({ length: 40 }, (_, index) => index * 7 * 86_400);
    const market = { t: weeks, c: weeks.map(() => 100) };
    const sector = { t: weeks, c: weeks.map((_, index) => 100 * 1.002 ** (index * index)) };
    const path = rotation(sector, market);
    expect(quadrantOf(path.at(-1)!)).toBe("leading");
    expect(quadrantOf({ ratio: 98, momentum: 101 })).toBe("improving");
    expect(quadrantOf({ ratio: 102, momentum: 99 })).toBe("weakening");
  });
});
