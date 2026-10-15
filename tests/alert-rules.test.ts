import { describe, expect, it } from "vitest";
import { defaultRules, describeRule, evaluate, newRule, parseRules, ruleTickers, type AlertRule } from "../lib/alert-rules";
import type { EconEvent } from "../lib/econ";

const now = new Date("2026-10-15T15:00:00Z");
const base = { followed: ["AAPL", "DAL"], alerts: [], quotes: {}, econ: [] as EconEvent[], now };

describe("alert rules", () => {
  it("starts from three defaults that keep what the screen did, and survives bad storage", () => {
    expect(parseRules(null).map((rule) => rule.id)).toEqual(["default-filings", "default-insider", "default-econ"]);
    expect(parseRules("not json")).toHaveLength(3);
    expect(parseRules(JSON.stringify([{ id: "x", type: "price" }]))).toEqual([]);
    expect(parseRules("[]")).toEqual([]);
  });

  it("fires a price alert once, until it is set again", () => {
    const rule: AlertRule = { ...newRule("price", "AAPL"), id: "p", level: 300, direction: "above" };
    const quotes = { AAPL: { price: 342.96, changePercent: 0.005 } };
    expect(evaluate([rule], { ...base, quotes }).map((fired) => fired.title)).toEqual(["Rose above $300"]);
    expect(evaluate([{ ...rule, firedAt: "2026-10-15T14:00:00Z" }], { ...base, quotes })).toEqual([]);
    expect(evaluate([{ ...rule, firedAt: "2026-10-15T14:00:00Z", armedAt: "2026-10-15T14:30:00Z" }], { ...base, quotes })).toHaveLength(1);
    expect(evaluate([{ ...rule, enabled: false }], { ...base, quotes })).toEqual([]);
  });

  it("catches a big move either way", () => {
    const rule: AlertRule = { ...newRule("move", "DAL"), id: "m", movePct: 5 };
    expect(evaluate([rule], { ...base, quotes: { DAL: { price: 60, changePercent: -0.061 } } })[0].title).toBe("Down 6.1% today");
    expect(evaluate([rule], { ...base, quotes: { DAL: { price: 60, changePercent: 0.02 } } })).toEqual([]);
  });

  it("takes filings and insider buys for one company or everything followed, once each", () => {
    const alerts = [
      { ticker: "AAPL", kind: "results" as const, at: "2026-10-14", title: "Results published", detail: "8-K", url: "u1" },
      { ticker: "DAL", kind: "insider" as const, at: "2026-10-13", title: "Ed bought", detail: null, url: "u2", value: 50_000 },
      { ticker: "MSFT", kind: "results" as const, at: "2026-10-14", title: "Results published", detail: "8-K", url: "u3" },
    ];
    const rules = [...defaultRules(), { ...newRule("filings", "AAPL"), id: "f" }];
    const fired = evaluate(rules, { ...base, alerts });
    expect(fired.map((entry) => `${entry.ticker} ${entry.kind}`)).toEqual(["AAPL results", "DAL insider"]);
    const big = evaluate([{ ...newRule("insider", null), id: "i", minValue: 100_000 }], { ...base, alerts });
    expect(big).toEqual([]);
    expect(ruleTickers(rules, ["AAPL", "DAL"])).toEqual(["AAPL", "DAL"]);
  });

  it("tells the economic releases chosen, and only the surprises when asked", () => {
    const econ: EconEvent[] = [
      { date: "2026-10-14", time: "08:30", name: "CPI, y/y", actual: "3.7%", consensus: "3.6%", previous: "3.4%", importance: "high", surprise: "above", description: null },
      { date: "2026-10-14", time: "08:30", name: "CPI, m/m", actual: "0.6%", consensus: "0.6%", previous: "0.4%", importance: "high", surprise: "inline", description: null },
      { date: "2026-10-15", time: "08:30", name: "Retail Sales, m/m", actual: null, consensus: "0.3%", previous: "1.2%", importance: "high", surprise: null, description: null },
    ];
    const rule: AlertRule = { ...newRule("econ", null), id: "e", topics: ["cpi", "retail"], onlySurprise: true };
    expect(evaluate([rule], { ...base, econ }).map((entry) => entry.title)).toEqual(["CPI, y/y: 3.7%"]);
    expect(evaluate([{ ...rule, onlySurprise: false }], { ...base, econ })).toHaveLength(2);
    expect(describeRule(rule)).toBe("Inflation (CPI), Retail sales · only when it misses the consensus");
  });
});
