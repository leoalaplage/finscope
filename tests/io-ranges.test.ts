import { describe, expect, it } from "vitest";
import { fundamentalWindow, priceWindow, shapeFor, withinYears } from "../components/io/ranges";

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

  it("measures a window from the series' own last period, not from today", () => {
    const periods = ["2019-12-31", "2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31"].map(period);
    expect(withinYears(periods, 2).map((entry) => entry.end)).toEqual(["2021-12-31", "2022-12-31", "2023-12-31"]);
    expect(withinYears(periods, null)).toHaveLength(5);
    expect(withinYears([], 5)).toEqual([]);
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
