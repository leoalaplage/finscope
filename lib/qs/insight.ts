import {
  QS_METRIC_NAMES,
  QS_METRIC_NOTES,
  QS_METRICS,
  type PillarName,
  type ScoredCompany,
} from "./screener";

/** Bumped whenever a score's financial meaning changes. */
export const QS_MODEL_VERSION = "core-2026.09.1";

/** FinScope has no analyst-estimate feed; imported tables may still carry both. */
export const NATIVE_OUT_OF_SCOPE = ["RevFwd3", "FwdP_FCF"] as const;

export type ScoreMetricStatus = "derived" | "estimate" | "missing";

export interface ScoreMetricDetail {
  key: string;
  label: string;
  pillar: PillarName;
  raw: number | null;
  score: number | null;
  configuredWeight: number;
  effectiveWeight: number;
  contribution: number | null;
  description: string;
  formula: string;
  source: string;
  status: ScoreMetricStatus;
  period: string;
}

const FORMULAS: Record<string, string> = {
  ROIC: "NOPAT / average invested capital; period-end capital is used only when no comparable opening balance is filed",
  ROIC5: "Mean of up to five annual ROIC readings, each using average invested capital where available",
  OpM: "Operating income / revenue",
  FCFM5: "Five-year mean of (operating cash flow − capital expenditure) / revenue",
  FCF_NI: "(Operating cash flow − capital expenditure) / net income",
  GM5: "Five-year mean of gross profit / revenue",
  ShOut5: "Five-year CAGR of diluted weighted-average shares",
  SBC: "Stock-based compensation / revenue",
  NetDebtEBITDA: "(Reported debt − cash) / (operating income + depreciation and amortization)",
  EBITInt: "Operating income / interest expense (interest paid is the disclosed fallback)",
  CurrentRatio: "Current assets / current liabilities",
  LTDebtAssets: "Reported long-term debt and leases / total assets; total debt is a conservative fallback",
  OCF_Capex: "Operating cash flow / absolute capital expenditure",
  Rev5: "Five-year revenue CAGR",
  RevFwd3: "Three-year forward revenue CAGR supplied by the imported provider",
  LevFCF5: "Five-year CAGR of the source's free-cash-flow field",
  NI5: "Five-year net-income CAGR",
  RevPS5: "Five-year revenue-per-share CAGR",
  FCFPS5: "Five-year free-cash-flow-per-share CAGR",
  EV_EBIT: "(Market capitalization + net debt) / operating income",
  EV_FCF: "(Market capitalization + net debt) / free cash flow",
  FwdP_FCF: "Forward market capitalization / forward free cash flow supplied by the imported provider",
  FCFYield: "Free cash flow / market capitalization",
};

const MARKET_KEYS = new Set(["EV_EBIT", "EV_FCF", "FCFYield"]);
const FORWARD_KEYS = new Set(["RevFwd3", "FwdP_FCF"]);

/**
 * Turns the engine's terse maps into the exact audit trail shown to a reader.
 * The arithmetic remains in the engine; this only exposes its weights and
 * contribution after missing-data renormalisation.
 */
export function explainScore(
  company: ScoredCompany,
  pillarWeights: Record<PillarName, number>,
  period: string,
  outOfScope: readonly string[] = NATIVE_OUT_OF_SCOPE,
): ScoreMetricDetail[] {
  const excluded = new Set(outOfScope);
  const activeByPillar = new Map<PillarName, number>();
  for (const metric of QS_METRICS) {
    if (excluded.has(metric.cle) || company.score_metrique[metric.cle] == null) continue;
    activeByPillar.set(metric.pilier, (activeByPillar.get(metric.pilier) ?? 0) + metric.poids);
  }
  const activePillarWeight = [...activeByPillar.keys()].reduce((sum, pillar) => sum + pillarWeights[pillar], 0);

  return QS_METRICS
    .filter((metric) => !excluded.has(metric.cle))
    .map((metric) => {
      const raw = company.brut[metric.cle] ?? null;
      const score = company.score_metrique[metric.cle] ?? null;
      const pillarDenominator = activeByPillar.get(metric.pilier) ?? 0;
      const withinPillar = score == null || pillarDenominator === 0 ? 0 : metric.poids / pillarDenominator;
      const effectiveWeight = activePillarWeight === 0 ? 0 : withinPillar * pillarWeights[metric.pilier] / activePillarWeight * 100;
      return {
        key: metric.cle,
        label: QS_METRIC_NAMES[metric.cle] ?? metric.cle,
        pillar: metric.pilier,
        raw,
        score,
        configuredWeight: metric.poids,
        effectiveWeight,
        contribution: score == null || activePillarWeight === 0 ? null : score * effectiveWeight / 100,
        description: QS_METRIC_NOTES[metric.cle] ?? "",
        formula: FORMULAS[metric.cle] ?? "Provided directly by the selected source",
        source: MARKET_KEYS.has(metric.cle) ? "SEC filings + Yahoo Finance price" : "SEC filings",
        status: raw == null ? "missing" : FORWARD_KEYS.has(metric.cle) ? "estimate" : "derived",
        period,
      } satisfies ScoreMetricDetail;
    });
}
