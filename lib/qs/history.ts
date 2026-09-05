import type { PillarName } from "./screener";
import type { ScoreMetricDetail } from "./insight";

const HISTORY_SHAPE = "h1";
const MAX_POINTS = 40;

export interface QualityScoreHistoryPoint {
  id: string;
  recordedAt: string;
  periodEnd: string;
  periodLabel: string;
  dataRetrievedAt: string;
  modelVersion: string;
  grade: string;
  total: number | null;
  coverage: number;
  pillars: Record<PillarName, number | null>;
  metrics: Array<Pick<ScoreMetricDetail, "key" | "raw" | "score" | "contribution">>;
}

export const qualityScoreHistoryKey = (ticker: string) =>
  `quality-score-history:${HISTORY_SHAPE}:${ticker.toUpperCase()}`;

/**
 * One immutable point per filing period and model version.
 *
 * A page refresh must not rewrite history with a newer share price and make a
 * past score look as though it was known earlier. A new filing or a deliberately
 * versioned methodology creates a new point; repeated reads do nothing.
 */
export function appendQualityScoreHistory(
  history: QualityScoreHistoryPoint[],
  point: QualityScoreHistoryPoint,
): { history: QualityScoreHistoryPoint[]; changed: boolean } {
  if (history.some((item) => item.id === point.id)) return { history, changed: false };
  const next = [...history, point]
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd) || left.recordedAt.localeCompare(right.recordedAt))
    .slice(-MAX_POINTS);
  return { history: next, changed: true };
}

