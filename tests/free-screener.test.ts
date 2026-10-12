import { describe, expect, it } from "vitest";
import { DEFAULT_SCREEN, conditionError, newCondition, readScreenStore, runScreen, saveScreen, type ScreenCondition, type ScreenRow } from "@/lib/free-screener";

const row = (ticker: string, values: ScreenRow["values"], previous: ScreenRow["previous"] = {}): ScreenRow => ({
  ticker, name: `${ticker} company`, sector: "Technology", currency: "USD", values, previous,
  dates: { fundamental: null, price: null, consensus: null, technical: null }, period: null, epsBasis: null, sharesBasis: null, reasons: {},
});
const rule = (patch: Partial<ScreenCondition> = {}): ScreenCondition => ({ ...newCondition("rule"), ...patch });

describe("a unified fundamental search", () => {
  const companies = [
    row("GOOD", { "Revenue 5Y CAGR": 15, "Operating Margin": 25, "Net Debt / EBITDA": -1, forwardPe: 20, "tech:close": 105, "tech:sma200": 100 }),
    row("DEBT", { "Revenue 5Y CAGR": 18, "Net Debt / EBITDA": 4, forwardPe: 18, "tech:close": 110, "tech:sma200": 100 }),
    row("GAP", { "Revenue 5Y CAGR": 20, "Net Debt / EBITDA": null, forwardPe: null, "tech:close": 110, "tech:sma200": 100 }),
  ];
  it("combines growth, debt, consensus and a price-to-average condition", () => {
    const conditions = [rule(), rule({ field: "Net Debt / EBITDA", op: "lte", value: "2" }), rule({ field: "forwardPe", op: "lte", value: "25" }), rule({ field: "tech:close", op: "gt", target: "field", other: "tech:sma200" })];
    const result = runScreen(companies, { ...DEFAULT_SCREEN, conditions });
    expect(result.matches.map((entry) => entry.ticker)).toEqual(["GOOD"]);
    expect(result.unknown).toBe(1);
    expect(result.considered).toBe(3);
  });
  it("does not treat an absent debt balance as zero or pass a not-equal condition", () => {
    const result = runScreen([companies[2]], { ...DEFAULT_SCREEN, conditions: [rule({ field: "Net Debt / EBITDA", op: "neq", value: "2" })] });
    expect(result.matches).toHaveLength(0);
    expect(result.unknown).toBe(1);
  });
  it("accepts reported zero and negative net debt", () => {
    const result = runScreen([row("ZERO", { "Net Debt / EBITDA": 0 }), companies[0]], { ...DEFAULT_SCREEN, conditions: [rule({ field: "Net Debt / EBITDA", op: "lte", value: "0" })] });
    expect(result.matches).toHaveLength(2);
  });
  it("evaluates OR without making an unknown value a match", () => {
    const config = { ...DEFAULT_SCREEN, mode: "any" as const, conditions: [rule({ field: "forwardPe", op: "lt", value: "19" }), rule({ field: "Revenue 5Y CAGR", op: "gt", value: "19" })] };
    expect(runScreen(companies, config).matches.map((entry) => entry.ticker)).toEqual(["DEBT", "GAP"]);
    expect(runScreen([row("UNKNOWN", {})], config).unknown).toBe(1);
  });
  it("lets a reader explicitly screen for missing or available data", () => {
    expect(runScreen(companies, { ...DEFAULT_SCREEN, conditions: [rule({ field: "forwardPe", op: "missing" })] }).matches[0].ticker).toBe("GAP");
    expect(runScreen(companies, { ...DEFAULT_SCREEN, conditions: [rule({ field: "forwardPe", op: "present" })] }).matches).toHaveLength(2);
  });
  it("does not broaden a search while its number is blank, infinite or its range reversed", () => {
    for (const patch of [{ value: "" }, { value: "Infinity" }, { op: "between" as const, value: "20", upper: "10" }]) {
      const result = runScreen(companies, { ...DEFAULT_SCREEN, conditions: [rule(patch)] });
      expect(result.errors).toHaveLength(1);
      expect(result.matches).toHaveLength(0);
    }
  });
  it("uses inclusive range bounds and percentage points", () => {
    const result = runScreen(companies, { ...DEFAULT_SCREEN, conditions: [rule({ op: "between", value: "15", upper: "18" })] });
    expect(result.matches.map((entry) => entry.ticker)).toEqual(["DEBT", "GOOD"]);
  });
  it("requires comparable units and technical data for crossovers", () => {
    expect(conditionError(rule({ field: "tech:close", target: "field", other: "tech:rsi14" }))).toMatch(/same unit/);
    expect(conditionError(rule({ op: "crossAbove" }))).toMatch(/technical/);
  });
  it("tests a crossover against both previous sides, not just today's ordering", () => {
    const conditions = [rule({ field: "tech:close", op: "crossAbove", target: "field", other: "tech:sma200" })];
    const rows = [row("CROSS", { "tech:close": 105, "tech:sma200": 100 }, { "tech:close": 98, "tech:sma200": 99 }), row("ALREADY", { "tech:close": 105, "tech:sma200": 100 }, { "tech:close": 104, "tech:sma200": 100 }), row("NOHISTORY", { "tech:close": 105, "tech:sma200": 100 })];
    const result = runScreen(rows, { ...DEFAULT_SCREEN, conditions });
    expect(result.matches.map((entry) => entry.ticker)).toEqual(["CROSS"]);
    expect(result.unknown).toBe(1);
  });
  it("applies watchlist, sector and company search before counting coverage", () => {
    const result = runScreen(companies, { ...DEFAULT_SCREEN, scope: "watchlist", sectors: ["Technology"], query: "good" }, ["GOOD", "DEBT"]);
    expect(result.considered).toBe(1);
    expect(result.matches[0].ticker).toBe("GOOD");
  });
  it("sorts missing values last in either direction", () => {
    for (const descending of [true, false]) {
      const result = runScreen(companies, { ...DEFAULT_SCREEN, sort: "forwardPe", descending });
      expect(result.matches.at(-1)?.ticker).toBe("GAP");
    }
  });
});

describe("saved searches", () => {
  it("round-trips rules, logical mode, columns, their order and sorting across multiple searches", () => {
    const current = { ...DEFAULT_SCREEN, mode: "any" as const, conditions: [rule({ field: "epsRevision", value: "5" })], columns: ["tech:rsi14", "forwardPe"], sort: "tech:rsi14", descending: false };
    let store = saveScreen({ current, saved: [], selected: null }, "Revisions", "first");
    store = saveScreen({ ...store, current: DEFAULT_SCREEN }, "All companies", "second");
    const loaded = readScreenStore(JSON.stringify(store));
    expect(loaded.saved.find((entry) => entry.id === "first")?.config).toEqual(current);
    expect(loaded.saved).toHaveLength(2);
    expect(loaded.selected).toBe("second");
  });
  it("updates one saved search without overwriting the others", () => {
    let store = saveScreen({ current: DEFAULT_SCREEN, saved: [], selected: null }, "A", "a");
    store = saveScreen(store, "B", "b");
    store = saveScreen({ ...store, current: { ...DEFAULT_SCREEN, query: "Apple" } }, "Renamed", "a");
    expect(store.saved).toHaveLength(2);
    expect(store.saved.find((entry) => entry.id === "b")?.name).toBe("B");
    expect(store.saved.find((entry) => entry.id === "a")?.config.query).toBe("Apple");
  });
  it("recovers from corrupt storage and rejects unknown metrics rather than ignoring a saved constraint", () => {
    expect(readScreenStore("broken").current).toEqual(DEFAULT_SCREEN);
    const invalid = { current: { ...DEFAULT_SCREEN, conditions: [rule({ field: "invented" })] }, saved: [], selected: null };
    expect(readScreenStore(JSON.stringify(invalid)).current.conditions).toEqual([]);
  });
});
