import { cashFlowIsTheBalanceSheet } from "../business-type";
import { fcfShareGrowthProfile } from "./fcf-share-growth";
import { growthYieldOfView } from "./growth-yield";
import { companyHealth, type HealthPeriod, type HealthState } from "./health";
import type { IoCompanyView } from "./view";

/**
 * A company in four answers, for a reader who has one glance.
 *
 * Is it a quality business; can its balance sheet take a bad year; is its
 * price dear for its growth; has it compounded. Each answer is the verdict of a
 * reading this site already makes in full further down the page — the Quality
 * Score, financial health, price against growth and free cash flow per share —
 * so the glance can never say something the detail does not. Built from the
 * company view alone, so the company page and the comparison give the same four
 * answers for the same company.
 */

/** A grade this site calls a quality business. */
export const QUALITY_GRADES: ReadonlySet<string> = new Set(["A+", "A", "A-"]);

/** Free-cash-flow-per-share growth a year, as words. */
export const GROWTH_WORDS: ReadonlyArray<[number, string]> = [[0.1, "Strong"], [0.03, "Moderate"], [0, "Flat"]];

export interface ScoreSummary { grade: string; pillars: { Quality: number | null } }

export interface Verdict {
  quality: { answer: "Yes" | "No" | null; grade: string | null; pillar: number | null; note: string };
  health: { state: HealthState | null; note: string };
  valuation: { score: number | null; words: string | null; rate: number | null; note: string };
  growth: { five: number | null; ten: number | null; steadiness: number | null; words: string | null; note: string };
}

export function qualityOf(score: ScoreSummary | null, loading = false): Verdict["quality"] {
  if (!score) return { answer: null, grade: null, pillar: null, note: loading ? "Scoring…" : "No grade yet" };
  const pillar = score.pillars.Quality;
  if (score.grade === "NR") return { answer: null, grade: "NR", pillar, note: "Not rated: too few measures" };
  return {
    answer: QUALITY_GRADES.has(score.grade) ? "Yes" : "No",
    grade: score.grade,
    pillar,
    note: `Grade ${score.grade}${pillar == null ? "" : ` · quality ${Math.round(pillar)}/100`}`,
  };
}

export function healthOf(view: IoCompanyView): Verdict["health"] {
  const as = (period: IoCompanyView["annual"][number]): HealthPeriod => ({ label: period.label, end: period.end, currency: period.currency, values: period.values });
  const current = view.ttm ?? view.annual.at(-1) ?? null;
  const reading = companyHealth(current ? as(current) : null, view.annual.map(as), view.company.businessType);
  if (!reading) return { state: null, note: view.withheldReason ? "Not assessed for this kind of company" : "No period to read" };
  return { state: reading.state ?? null, note: reading.state ? `${reading.periodLabel} · ${reading.answered} of ${reading.questions.length} questions` : reading.reason ?? "Not read" };
}

export function valuationOf(view: IoCompanyView, quote: { price: number | null; currency?: string | null } | null): Verdict["valuation"] {
  if (cashFlowIsTheBalanceSheet(view.company.businessType)) return { score: null, words: null, rate: null, note: "Not computed for a bank or a broker" };
  const { reading, score, verdict, marketCap } = growthYieldOfView(view, quote);
  if (score == null) return { score: null, words: null, rate: null, note: marketCap == null ? "No price against the share count" : "Missing free cash flow or growth" };
  return { score, words: verdict, rate: reading.value, note: `Growth yield ${(reading.value! * 100).toFixed(1)}%` };
}

export function growthOf(view: IoCompanyView): Verdict["growth"] {
  if (cashFlowIsTheBalanceSheet(view.company.businessType)) return { five: null, ten: null, steadiness: null, words: null, note: "Free cash flow not stated for this kind of company" };
  const profile = fcfShareGrowthProfile(view.annual);
  const five = profile.fiveYearCagr.value;
  const ten = profile.tenYearCagr.value;
  const steadiness = profile.fiveYearRSquared.value;
  const words = five == null ? null : five < 0 ? "Shrinking" : GROWTH_WORDS.find(([floor]) => five >= floor)?.[1] ?? "Flat";
  const parts = [
    ten == null ? null : `10Y ${ten >= 0 ? "+" : "−"}${Math.abs(ten * 100).toFixed(1)}%`,
    steadiness == null ? null : `R² ${steadiness.toFixed(2)}`,
  ].filter(Boolean);
  return { five, ten, steadiness, words, note: five == null ? profile.fiveYearCagr.reason ?? "No five-year history" : `FCF / share, 5Y${parts.length ? ` · ${parts.join(" · ")}` : ""}` };
}

export function verdictOf(view: IoCompanyView, quote: { price: number | null; currency?: string | null } | null, score: ScoreSummary | null, scoreLoading = false): Verdict {
  return { quality: qualityOf(score, scoreLoading), health: healthOf(view), valuation: valuationOf(view, quote), growth: growthOf(view) };
}
