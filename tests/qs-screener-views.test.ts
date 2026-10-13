import { describe, expect, it } from "vitest";
import type { ScoredCompany } from "../lib/qs/screener";
import { businessScore, filterRows, gradeCounts, gradeRank, median, NO_FILTER, sectorScores } from "../lib/qs/screener-views";

const company = (ticker: string, total: number | null, note: string, sector: string, pillars: Partial<Record<"Quality" | "Health" | "Growth" | "Value", number | null>> = {}, extra: Partial<ScoredCompany> = {}) => ({
  Ticker: ticker, Secteur: sector, Cap: 10, brut: {}, ref: {}, total, couverture: 1, note, alertes: 0, alertes_detail: [],
  conviction: null, forces: [], faiblesses: [], valuation: "", valo_niveau: 1, sweet_spot: false, qv_median: false, rang: 1, rang_conviction: 1, score_metrique: {},
  piliers: { Quality: null, Health: null, Growth: null, Value: null, ...pillars }, ...extra,
}) as ScoredCompany;

describe("the screener's charts, as figures", () => {
  const rows = [
    company("AAA", 80, "A+", "Software", { Quality: 90, Health: 70, Growth: 60, Value: 20 }),
    company("BBB", 50, "B", "Software", { Quality: 50, Health: 50, Growth: 50, Value: 70 }, { sweet_spot: true }),
    company("CCC", 25, "D", "Retail", {}, { alertes: 2 }),
    company("DDD", null, "NR", "Unclassified"),
  ];

  it("counts every letter in the engine's order, unrated last", () => {
    const counts = gradeCounts(rows);
    expect(counts[0]).toEqual({ grade: "A+", count: 1 });
    expect(counts.at(-1)).toEqual({ grade: "NR", count: 1 });
    expect(gradeRank("A+")).toBe(0);
    expect(gradeRank("D")).toBe(1);
  });

  it("scores the business without its price, over the pillars it carries", () => {
    const weights = { Quality: 40, Health: 20, Growth: 20, Value: 20 };
    expect(businessScore(rows[0], weights)).toBeCloseTo((90 * 40 + 70 * 20 + 60 * 20) / 80);
    expect(businessScore(company("X", 1, "D", "S", { Quality: 30 }), weights)).toBe(30);
    expect(businessScore(rows[3], weights)).toBeNull();
  });

  it("ranks sectors by their median and filters the table as the charts ask", () => {
    expect(sectorScores(rows).map((entry) => [entry.sector, entry.median, entry.best])).toEqual([["Software", 65, "AAA"], ["Retail", 25, "CCC"]]);
    expect(median([1, null, 3, 2])).toBe(2);
    expect(filterRows(rows, { ...NO_FILTER, grades: ["A+", "B"] }).map((row) => row.Ticker)).toEqual(["AAA", "BBB"]);
    expect(filterRows(rows, { ...NO_FILTER, sweetOnly: true }).map((row) => row.Ticker)).toEqual(["BBB"]);
    expect(filterRows(rows, { ...NO_FILTER, noAlerts: true, sector: "Retail" })).toEqual([]);
    expect(filterRows(rows, { ...NO_FILTER, query: "soft" }).map((row) => row.Ticker)).toEqual(["AAA", "BBB"]);
  });
});
