import { describe, expect, it } from "vitest";
import { conditionError, conditionMatch, runScreen, DEFAULT_SCREEN, SCREEN_FIELD, type ScreenRow } from "@/lib/free-screener";
import {
  FILTER_TABS, QUICK_FILTERS, RECIPES, VIEWS, conditionFor, customBounds, customCondition, describeCondition, formatValue, isQuickCondition, optionIndex,
} from "@/lib/screener-filters";

const row = (ticker: string, values: Record<string, number | null>, previous: Record<string, number | null> = {}): ScreenRow => ({
  ticker, name: ticker, sector: "Technology", currency: "USD", values, previous,
  dates: { fundamental: null, price: null, consensus: null, technical: null }, period: null, epsBasis: null, sharesBasis: null, reasons: {},
});

describe("quick filters", () => {
  it("only name metrics the screener has, and every option is a valid criterion", () => {
    for (const tab of FILTER_TABS) for (const filter of tab.filters) {
      expect(SCREEN_FIELD[filter.field], filter.id).toBeDefined();
      for (const option of filter.options) expect(conditionError(conditionFor(filter.id, option)), `${filter.id} · ${option.label}`).toBeNull();
    }
  });

  it("reads back the option a criterion came from, and its words", () => {
    const fpe = QUICK_FILTERS.fpe;
    const under20 = fpe.options.findIndex((option) => option.label === "Under 20");
    const condition = conditionFor("fpe", fpe.options[under20]);
    expect(isQuickCondition(condition)).toBe(true);
    expect(optionIndex("fpe", condition)).toBe(under20);
    expect(describeCondition(condition)).toBe("Forward P/E · Under 20");
  });

  it("turns a typed range into a criterion, and a blank one into none", () => {
    expect(customCondition("roic", "10", "30")).toMatchObject({ op: "between", value: "10", upper: "30" });
    expect(customCondition("roic", "10", "")).toMatchObject({ op: "gte", value: "10" });
    expect(customCondition("roic", "", "5")).toMatchObject({ op: "lte", value: "5" });
    expect(customCondition("roic", "", "")).toBeNull();
    const typed = customCondition("roic", "12", "")!;
    expect(optionIndex("roic", typed)).toBe(-1);
    expect(customBounds(typed)).toEqual({ low: "12", high: "" });
  });

  it("filters on price against its moving average, and on a golden cross", () => {
    const above = conditionFor("sma", QUICK_FILTERS.sma.options.find((option) => option.label === "Above SMA 200")!);
    expect(conditionMatch(above, row("UP", { "tech:close": 110, "tech:sma200": 100 }))).toBe("match");
    expect(conditionMatch(above, row("DOWN", { "tech:close": 90, "tech:sma200": 100 }))).toBe("no");
    const golden = conditionFor("cross", QUICK_FILTERS.cross.options.find((option) => option.label === "Golden cross")!);
    expect(conditionMatch(golden, row("X", { "tech:sma50": 101, "tech:sma200": 100 }, { "tech:sma50": 99, "tech:sma200": 100 }))).toBe("match");
  });

  it("never lets a missing value pass", () => {
    const cheap = conditionFor("fpe", QUICK_FILTERS.fpe.options.find((option) => option.label === "Under 20")!);
    const result = runScreen([row("A", { forwardPe: 15 }), row("B", { forwardPe: null }), row("C", { forwardPe: 30 })], { ...DEFAULT_SCREEN, conditions: [cheap] });
    expect(result.matches.map((entry) => entry.ticker)).toEqual(["A"]);
    expect(result.unknown).toBe(1);
  });
});

describe("views and ready screens", () => {
  it("show only columns the screener has", () => {
    for (const view of VIEWS) for (const key of view.columns) expect(SCREEN_FIELD[key], `${view.id} · ${key}`).toBeDefined();
  });
  it("are built from quick filters and sort on a known column", () => {
    for (const recipe of RECIPES) {
      expect(recipe.conditions.every(isQuickCondition)).toBe(true);
      expect(SCREEN_FIELD[recipe.sort]).toBeDefined();
      expect(VIEWS.some((view) => view.id === recipe.view)).toBe(true);
    }
  });
});

describe("formatValue", () => {
  it("writes each unit as the table shows it", () => {
    expect(formatValue(2817.92, SCREEN_FIELD["Market Cap"])).toBe("$2.82T");
    expect(formatValue(890.58, SCREEN_FIELD["Market Cap"])).toBe("$891B");
    expect(formatValue(1.4, SCREEN_FIELD["Market Cap"])).toBe("$1.4B");
    expect(formatValue(18.947, SCREEN_FIELD.forwardPe)).toBe("18.9×");
    expect(formatValue(0.279, SCREEN_FIELD.peg)).toBe("0.28×");
    expect(formatValue(-7.45, SCREEN_FIELD["Revenue 5Y CAGR"])).toBe("−7.5%");
    expect(formatValue(null, SCREEN_FIELD.ROIC)).toBe("—");
  });
});
