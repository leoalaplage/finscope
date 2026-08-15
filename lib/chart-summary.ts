import { cagrBetweenDates } from "./finance";
import { METRICS, type MetricKind } from "./metrics";

export type SummaryKind = "cagr" | "points" | "none";

export interface MetricSummary {
  kind: SummaryKind;
  value: number | null;
  /** What the badge is called: "CAGR 4.0Y", "Change 4.0Y". */
  label: string;
  /** The badge text itself. */
  display: string;
  years: number;
  reason?: string;
}

export interface SummaryPoint { date: string; value: number | null }

/**
 * Which summary a measure deserves.
 *
 * A quantity that compounds — revenue, cash flow, a per-share amount — is
 * summarised by the rate at which it compounded. A ratio does not compound: an
 * operating margin going from 20% to 25% has a mathematical growth rate of
 * about 5.7% a year, and quoting that tells the reader nothing they wanted to
 * know. The honest summary of a rate is how many points it moved.
 */
export function summaryKindFor(metric: string): SummaryKind {
  const kind: MetricKind | undefined = METRICS[metric]?.kind;
  if (kind === "percent" || kind === "ratio") return "points";
  if (kind === "currency" || kind === "perShare" || kind === "shares") return "cagr";
  return "none";
}

const formatPercent = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const formatPoints = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`;

/**
 * Summarises exactly the series that is drawn.
 *
 * Taking the endpoints from the plotted points rather than from the underlying
 * dataset is deliberate: the badge then describes the picture beside it, and
 * cannot quote a ten-year rate over a chart showing four.
 *
 * The compounding case defers to `cagrBetweenDates`, which is the same function
 * every other growth figure in the application uses, with its own rules about
 * negative and zero endpoints.
 */
export function summariseSeries(points: SummaryPoint[], metric: string): MetricSummary {
  const kind = summaryKindFor(metric);
  const usable = points.filter((point) => point.value != null && Number.isFinite(point.value));
  const first = usable[0]; const last = usable.at(-1);
  const empty = (reason: string): MetricSummary => ({ kind, value: null, label: "", display: "—", years: 0, reason });

  if (kind === "none") return empty("This measure has no meaningful trend summary.");
  if (!first || !last || first === last) return empty("Needs two reported points.");

  const years = (Date.parse(last.date) - Date.parse(first.date)) / (365.2425 * 86_400_000);
  if (!Number.isFinite(years) || years <= 0) return empty("The drawn window has no duration.");
  // Rounded months first: a calendar year is 365 days, which is 0.999 years,
  // and reading "12M" over a year of data looks like a mistake.
  const months = Math.round(years * 12);
  const span = months >= 12 ? `${(months / 12).toFixed(1)}Y` : `${months}M`;

  if (kind === "points") {
    const value = last.value! - first.value!;
    return { kind, value, years, label: `Change ${span}`, display: formatPoints(value) };
  }

  const result = cagrBetweenDates(first.value!, last.value!, first.date, last.date);
  if (result.value == null) return { ...empty(result.reason ?? "Not meaningful"), label: `CAGR ${span}`, years };
  return { kind, value: result.value, years, label: `CAGR ${span}`, display: formatPercent(result.value) };
}
