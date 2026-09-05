import { describe, expect, it } from "vitest";
import { appendQualityScoreHistory, type QualityScoreHistoryPoint } from "../lib/qs/history";
import { explainScore, QS_MODEL_VERSION } from "../lib/qs/insight";
import { screen } from "../lib/qs/screener";

const TABLE = [
  "Ticker,Sector,ROIC,ROIC 5Yr Avg,Operating Margin,FCF Margin 5Yr Avg,FCF / Net Income,Gross Margin 5Yr Avg,Shares Outstanding 5Y CAGR,SBC to Revenue,Net Debt / EBITDA,EBIT / Interest Expense,Current Ratio,Long-term Debt to Assets,OCF/Capex,Revenue 5Y CAGR,FCF 5Y CAGR,Net Income 5Y CAGR,Revenue Per Share 5Y CAGR,FCF Per Share 5Y CAGR,EV/EBIT,EV/FCF,FCF Yield",
  "TEST,Software,20,18,25,15,95,60,0,3,1,20,1.5,0.2,4,10,9,8,10,9,20,25,4",
].join("\n");

describe("Quality Score audit detail", () => {
  it("exposes the effective weights and contributions without changing the score", () => {
    const result = screen(TABLE);
    const company = result.all[0];
    const details = explainScore(company, result.weights, "FY 2025");
    expect(details.some((metric) => metric.key === "RevFwd3")).toBe(false);
    expect(details.some((metric) => metric.key === "FwdP_FCF")).toBe(false);
    expect(details.reduce((sum, metric) => sum + metric.effectiveWeight, 0)).toBeCloseTo(100, 8);
    expect(details.reduce((sum, metric) => sum + (metric.contribution ?? 0), 0)).toBeCloseTo(company.total!, 8);
    expect(details.find((metric) => metric.key === "ROIC")?.formula).toContain("average invested capital");
  });
});

const historyPoint = (periodEnd: string): QualityScoreHistoryPoint => ({
  id: `${QS_MODEL_VERSION}:${periodEnd}`,
  recordedAt: `${periodEnd}T12:00:00.000Z`,
  periodEnd,
  periodLabel: `FY ${periodEnd.slice(0, 4)}`,
  dataRetrievedAt: `${periodEnd}T11:00:00.000Z`,
  modelVersion: QS_MODEL_VERSION,
  grade: "A",
  total: 70,
  coverage: 1,
  pillars: { Quality: 70, Health: 70, Growth: 70, Value: 70 },
  metrics: [],
});

describe("Quality Score history", () => {
  it("keeps the first snapshot immutable for a filing period", () => {
    const first = historyPoint("2025-12-31");
    const added = appendQualityScoreHistory([], first);
    const laterPrice = { ...first, total: 78, recordedAt: "2026-01-02T12:00:00.000Z" };
    const repeated = appendQualityScoreHistory(added.history, laterPrice);
    expect(repeated.changed).toBe(false);
    expect(repeated.history[0].total).toBe(70);
  });

  it("adds a new point for a new filing period", () => {
    const first = historyPoint("2024-12-31");
    const second = historyPoint("2025-12-31");
    expect(appendQualityScoreHistory([first], second).history.map((point) => point.periodEnd))
      .toEqual(["2024-12-31", "2025-12-31"]);
  });
});
