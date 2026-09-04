import { describe, expect, it } from "vitest";
import { fundamentalWindow, offersFrequency, priceWindow, shapeFor, withinYears } from "../components/io/ranges";

const period = (end: string) => ({ end });

describe("one range, read by each half of the page", () => {
  it("draws everything below a year from the same year of trailing figures", () => {
    // A quarter is the shortest period a company reports, so a month and six
    // months have nothing finer to show than the year does.
    for (const range of ["1M", "6M", "1Y"] as const) {
      expect(fundamentalWindow(range)).toEqual({ frequency: "ttm", years: 1 });
    }
  });

  it("answers MAX from the annual series, not the trailing one", () => {
    /*
     * The bug this exists for. This application keeps twenty-four trailing
     * observations, which is six years, so "MAX" drawn from them showed a
     * reader asking for everything about a quarter of it. The annual series
     * runs twenty years back.
     */
    expect(fundamentalWindow("MAX")).toEqual({ frequency: "annual", years: null });
    expect(fundamentalWindow("5Y")).toEqual({ frequency: "ttm", years: 5 });
  });

  it("offers the TTM/Yearly choice only where there is one to make", () => {
    // Over a year the annual series holds one observation and over six months
    // it holds none, so the switch there could only make the screen worse.
    expect(offersFrequency("1M")).toBe(false);
    expect(offersFrequency("6M")).toBe(false);
    expect(offersFrequency("1Y")).toBe(false);
    expect(offersFrequency("5Y")).toBe(true);
    expect(offersFrequency("MAX")).toBe(true);
  });

  it("measures a window from the series' own last period, not from today", () => {
    const periods = ["2019-12-31", "2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31"].map(period);
    expect(withinYears(periods, 2).map((entry) => entry.end)).toEqual(["2021-12-31", "2022-12-31", "2023-12-31"]);
    expect(withinYears(periods, null)).toHaveLength(5);
    expect(withinYears([], 5)).toEqual([]);
  });

  it("keeps the year a window is named for, whatever day the fiscal year ended", () => {
    /*
     * The bug this exists for. Apple's fiscal year ended on 26 September 2020
     * and on 27 September 2025, so a cutoff struck exactly five years back
     * missed 2020 by a day. "Five-year growth" was then compounded over four
     * intervals: 3.3% a year for a company that grew at 8.7%.
     */
    const apple = ["2020-09-26", "2021-09-25", "2022-09-24", "2023-09-30", "2024-09-28", "2025-09-27"].map(period);
    expect(withinYears(apple, 5)).toHaveLength(6);
    expect(withinYears(apple, 5)[0].end).toBe("2020-09-26");
    // And it recovers only that period, never the one before it.
    const yearly = ["2018-12-31", "2019-12-31", "2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31"].map(period);
    expect(withinYears(yearly, 3)).toHaveLength(4);
  });

  it("asks the market endpoint for the granularity each window can show", () => {
    expect(priceWindow("1M").frequency).toBe("daily");
    expect(priceWindow("5Y").frequency).toBe("weekly");
    expect(priceWindow("MAX")).toMatchObject({ frequency: "monthly", start: "1985-01-01" });
  });
});

describe("how a measure is drawn", () => {
  it("stands a level on zero and fills a rate as a band", () => {
    // A quantity that happened is a bar. A rate is where the business sat, and
    // does not accumulate, so it is an area.
    expect(shapeFor("currency")).toBe("bars");
    expect(shapeFor("shares")).toBe("bars");
    expect(shapeFor("perShare")).toBe("bars");
    expect(shapeFor("percent")).toBe("area");
    expect(shapeFor("ratio")).toBe("area");
  });
});

describe("stating a growth rate", () => {
  it("annualises a window of about a year, and refuses a fragment of one", async () => {
    const { datedCagrOf } = await import("../components/io/format");
    const year = [
      { date: "2025-06-27", value: 100 },
      { date: "2025-09-27", value: 103 },
      { date: "2025-12-27", value: 106 },
      { date: "2026-03-27", value: 109 },
      { date: "2026-06-27", value: 112 },
    ];
    // Five trailing observations span a year to within a few days, and a
    // strict "more than a year" refused every one of them.
    expect(datedCagrOf(year)).toBeCloseTo(0.12, 2);
    expect(datedCagrOf(year.slice(0, 2))).toBeNull();
    // A sign change has no rate, however long the window.
    expect(datedCagrOf([{ date: "2020-01-01", value: -5 }, { date: "2025-01-01", value: 10 }])).toBeNull();
  });
});
