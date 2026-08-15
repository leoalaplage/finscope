import { describe, expect, it } from "vitest";
// The screener is plain ES modules served as static assets, deliberately
// outside the typed application. Importing the shipped files here is the
// point: the test exercises what ships, not a copy of it.
import { analyser, calculerScores, trier } from "../public/qs/js/qs-engine.js";
import { METRIQUES, PILIERS, POIDS_PILIERS, PRESETS } from "../public/qs/js/qs-config.js";

/**
 * A reference for the QS Screener's arithmetic.
 *
 * The screener's presentation is being redesigned. Its engine is not: the
 * formulas, weights, thresholds, pillar structure, letter grades and ranking
 * rules stay exactly as they are. This file exists so that claim can be
 * checked rather than asserted — it pins the numbers the engine produces for a
 * fixed set of inputs, so any change to a weight or a threshold, whether
 * deliberate or accidental, fails here.
 *
 * The values below were produced by the engine as it stands. If one of them
 * ever needs updating, that is a change to the model and belongs in a commit
 * that says so.
 */

type Titre = Record<string, unknown>;

/** Three companies spanning the range: excellent, ordinary, and strained. */
const company = (Ticker: string, Nom: string, brut: Record<string, number>): Titre =>
  ({ Ticker, Nom, Secteur: "Test", Cap: 1e11, brut: { ...EMPTY_METRICS, ...brut }, ref: {} });

/** Every metric key the engine knows, so a fixture never omits one silently. */
const EMPTY_METRICS: Record<string, number | null> = Object.fromEntries(
  (METRIQUES as Array<{ cle: string }>).map((metric) => [metric.cle, null]),
);

function fixture(): Titre[] {
  return [
    company("EXCEL", "Excellent Co", {
      ROIC: 40, ROIC5: 38, OpM: 35, FCFM5: 30, FCF_NI: 110, GM5: 70, ShOut5: -2, SBC: 3,
      NetDebtEBITDA: 0.2, EBITInt: 45, CurrentRatio: 2.4, LTDebtAssets: 8, OCF_Capex: 6,
      Rev5: 14, RevFwd3: 12, LevFCF5: 16, NI5: 17, RevPS5: 16, FCFPS5: 18,
      EV_EBIT: 18, EV_FCF: 24, FwdP_FCF: 22, FCFYield: 4.5,
    }),
    company("MIDDL", "Ordinary Co", {
      ROIC: 14, ROIC5: 13, OpM: 16, FCFM5: 11, FCF_NI: 85, GM5: 42, ShOut5: 0.5, SBC: 6,
      NetDebtEBITDA: 1.8, EBITInt: 12, CurrentRatio: 1.4, LTDebtAssets: 22, OCF_Capex: 2.2,
      Rev5: 6, RevFwd3: 5, LevFCF5: 5, NI5: 7, RevPS5: 5.5, FCFPS5: 4.5,
      EV_EBIT: 24, EV_FCF: 31, FwdP_FCF: 30, FCFYield: 3.3,
    }),
    company("WEAK", "Strained Co", {
      ROIC: 5, ROIC5: 6, OpM: 7, FCFM5: 3, FCF_NI: 40, GM5: 25, ShOut5: 4, SBC: 12,
      NetDebtEBITDA: 4.5, EBITInt: 3, CurrentRatio: 0.9, LTDebtAssets: 48, OCF_Capex: 1.1,
      Rev5: 1, RevFwd3: 0.5, LevFCF5: -6, NI5: -3, RevPS5: -3, FCFPS5: -9,
      EV_EBIT: 40, EV_FCF: 58, FwdP_FCF: 55, FCFYield: 1.8,
    }),
  ];
}

const round = (value: unknown, places = 4) =>
  typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(places)) : value ?? null;

describe("QS Screener engine — structure", () => {
  it("keeps four pillars, weighted to a hundred", () => {
    expect(PILIERS).toEqual(["Quality", "Health", "Growth", "Value"]);
    expect(POIDS_PILIERS).toEqual({ Quality: 45, Health: 20, Growth: 15, Value: 20 });
    expect(Object.values(POIDS_PILIERS).reduce((sum: number, weight) => sum + Number(weight), 0)).toBe(100);
  });

  it("keeps every preset summing to a hundred", () => {
    for (const [name, weights] of Object.entries(PRESETS as Record<string, Record<string, number>>)) {
      expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0), name).toBe(100);
    }
  });

  it("keeps each pillar's metric weights summing to a hundred", () => {
    const byPillar: Record<string, number> = {};
    for (const metric of METRIQUES as Array<{ pilier: string; poids: number }>) {
      byPillar[metric.pilier] = (byPillar[metric.pilier] ?? 0) + metric.poids;
    }
    for (const pillar of PILIERS as string[]) expect(byPillar[pillar], pillar).toBe(100);
  });

  it("keeps the metric set and its directions", () => {
    const signature = (METRIQUES as Array<{ cle: string; pilier: string; poids: number; sens: string }>)
      .map((metric) => `${metric.pilier}:${metric.cle}:${metric.poids}:${metric.sens}`);
    expect(signature).toEqual([
      "Quality:ROIC:10:H", "Quality:ROIC5:20:H", "Quality:OpM:15:H", "Quality:FCFM5:20:H",
      "Quality:FCF_NI:10:H", "Quality:GM5:5:H", "Quality:ShOut5:10:L", "Quality:SBC:10:L",
      "Health:NetDebtEBITDA:35:L", "Health:EBITInt:35:H", "Health:CurrentRatio:5:H",
      "Health:LTDebtAssets:10:L", "Health:OCF_Capex:15:H",
      "Growth:Rev5:15:H", "Growth:RevFwd3:20:H", "Growth:LevFCF5:15:H",
      "Growth:NI5:10:H", "Growth:RevPS5:15:H", "Growth:FCFPS5:25:H",
      "Value:EV_EBIT:35:L", "Value:EV_FCF:15:L", "Value:FwdP_FCF:25:L", "Value:FCFYield:25:H",
    ]);
  });
});

describe("QS Screener engine — reference results", () => {
  it("produces the same totals, pillars and grades for the same input", () => {
    const titres = fixture();
    calculerScores(titres, { ...POIDS_PILIERS }, true);
    const actual = (titres as Array<Record<string, unknown>>).map((titre) => ({
      ticker: titre.Ticker,
      total: round(titre.total, 2),
      note: titre.note,
      quality: round((titre.piliers as Record<string, number>)?.Quality, 2),
      health: round((titre.piliers as Record<string, number>)?.Health, 2),
      growth: round((titre.piliers as Record<string, number>)?.Growth, 2),
      value: round((titre.piliers as Record<string, number>)?.Value, 2),
    }));
    expect(actual).toMatchInlineSnapshot(`
      [
        {
          "growth": 90.78,
          "health": 94.39,
          "note": "A+",
          "quality": 97,
          "ticker": "EXCEL",
          "total": 94.49,
          "value": 91.72,
        },
        {
          "growth": 42.09,
          "health": 49.98,
          "note": "B",
          "quality": 46.83,
          "ticker": "MIDDL",
          "total": 47.4,
          "value": 50.07,
        },
        {
          "growth": 0.33,
          "health": 0.95,
          "note": "D",
          "quality": 1.2,
          "ticker": "WEAK",
          "total": 0.98,
          "value": 1,
        },
      ]
    `);
  });

  it("ranks the three companies in the order their quality implies", () => {
    const { titres } = analyser(fixture(), {});
    const ordered = trier([...(titres as Titre[])], "total").map((titre: Titre) => titre.Ticker);
    expect(ordered).toEqual(["EXCEL", "MIDDL", "WEAK"]);
  });

  it("gives a company with no data a null total rather than a zero score", () => {
    const titres: Titre[] = [...fixture(), company("EMPTY", "No Data Co", {})];
    calculerScores(titres, { ...POIDS_PILIERS }, true);
    const empty = titres.find((titre) => titre.Ticker === "EMPTY")!;
    expect(empty.total == null || Number.isNaN(empty.total)).toBe(true);
  });

  it("changes the answer when the preset changes, and only then", () => {
    const base = analyser(fixture(), {});
    const same = analyser(fixture(), {});
    const purist = analyser(fixture(), { preset: "quality-purist" });
    const totalOf = (result: { titres: Titre[] }) => (result.titres as Array<Record<string, unknown>>).map((titre) => round(titre.total, 6));
    expect(totalOf(same)).toEqual(totalOf(base));
    expect(totalOf(purist)).not.toEqual(totalOf(base));
  });
});
