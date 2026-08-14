import { cagrBetweenDates } from "./finance";

export interface SeriesObservation { date: string; value: number | null; valid?: boolean }

export type VisibleSeriesAnalysis = {
  kind: "cagr" | "margin";
  startDate: string;
  endDate: string;
  startValue: number | null;
  endValue: number | null;
  years: number;
  value: number | null;
  average: number | null;
  pointChange?: number | null;
  reason?: string;
};

/** Statistics for exactly the observations currently drawn; invalid endpoint facts are never silently skipped. */
export function analyzeVisibleSeries(observations: SeriesObservation[], kind: "cagr" | "margin"): VisibleSeriesAnalysis {
  const ordered = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  const validValues = ordered.filter((item) => item.valid !== false && item.value != null) as Array<SeriesObservation & { value: number }>;
  const start = ordered[0]; const end = ordered.at(-1);
  const average = validValues.length ? validValues.reduce((sum, item) => sum + item.value, 0) / validValues.length : null;
  const years = start && end ? (Date.parse(end.date) - Date.parse(start.date)) / (365.2425 * 86_400_000) : 0;
  if (!start || !end || ordered.length < 2) return { kind, startDate: start?.date ?? "", endDate: end?.date ?? "", startValue: start?.value ?? null, endValue: end?.value ?? null, years, value: null, average, reason: "Insufficient comparable observations" };
  if (start.valid === false || end.valid === false) return { kind, startDate: start.date, endDate: end.date, startValue: start.value, endValue: end.value, years, value: null, average, reason: "A visible endpoint failed data validation" };
  if (kind === "margin") {
    const pointChange = start.value == null || end.value == null ? null : end.value - start.value;
    return { kind, startDate: start.date, endDate: end.date, startValue: start.value, endValue: end.value, years, value: pointChange, pointChange, average, reason: pointChange == null ? "Insufficient comparable endpoints" : undefined };
  }
  const cagr = cagrBetweenDates(start.value, end.value, start.date, end.date);
  return { kind, ...cagr, average };
}
