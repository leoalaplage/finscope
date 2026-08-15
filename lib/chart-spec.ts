import { METRICS } from "./metrics";
import type { SeriesFrequency, SeriesObservation } from "./types";

/**
 * What a chart is asked to draw, before anything is drawn.
 *
 * The rendering path used to take observations straight from the dataset and
 * hand them to the chart library, which meant a single bad series — a date the
 * provider left blank, an infinity from a division, two facts claiming the same
 * period — took the whole chart down with it. Everything now passes through
 * here first, and a series that cannot be drawn honestly is dropped with a
 * reason while its neighbours render.
 */
export interface ChartSeriesSpec {
  id: string;
  ticker: string;
  metric: string;
  frequency: SeriesFrequency;
  /** What was done to the values before drawing. "none" is the raw figure. */
  transformation: "none" | "indexed" | "percentChange";
  /** Set by axis assignment, not by the caller. */
  axis?: "left" | "right";
}

export type ProblemCode =
  | "empty"
  | "invalid-date"
  | "duplicate-period"
  | "non-finite"
  | "unknown-unit"
  | "unknown-currency"
  | "frequency-mismatch"
  | "unadjusted-split";

export interface SeriesProblem {
  code: ProblemCode;
  detail: string;
  /** How many observations this removed. Zero for a whole-series problem. */
  dropped: number;
}

export interface ValidatedSeries {
  spec: ChartSeriesSpec;
  observations: SeriesObservation[];
  unit: string;
  currency: string;
  source: string;
  /** Problems found. Present even when the series is still drawable. */
  problems: SeriesProblem[];
  /** False when nothing honest can be drawn. */
  usable: boolean;
  /** Why not, when it is not. */
  reason?: string;
}

const KNOWN_UNITS = new Set(["currency", "shares", "percent", "perShare", "ratio", "indexed", "unknown"]);
/** ISO 4217 is 3 letters; anything else did not come from a filing we parsed. */
const CURRENCY = /^[A-Z]{3}$/;
const MARKET_FREQUENCIES = new Set<SeriesFrequency>(["daily", "weekly", "monthly", "market-quarterly", "market-annual"]);
const FUNDAMENTAL_FREQUENCIES = new Set<SeriesFrequency>(["annual", "quarterly", "ttm"]);
const MARKET_METRICS = new Set(["stockPrice", "stockTotalReturn"]);

const isDate = (value: string | undefined): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));

/**
 * A per-share or share-count series that steps by a whole split ratio between
 * one period and the next has not been adjusted.
 *
 * Detected rather than corrected: correcting it here would paper over a missing
 * entry in the company registry, which is where the fix belongs. Reporting it
 * lets the chart still draw while saying the step is an artefact.
 */
const SPLIT_RATIOS = [2, 3, 4, 5, 7, 10, 20];
function unadjustedSplit(metric: string, observations: SeriesObservation[]): SeriesProblem | null {
  const kind = METRICS[metric]?.kind;
  if (kind !== "shares" && kind !== "perShare") return null;
  for (let index = 1; index < observations.length; index++) {
    const previous = observations[index - 1].value; const current = observations[index].value;
    if (previous == null || current == null || previous <= 0 || current <= 0) continue;
    const ratio = kind === "shares" ? current / previous : previous / current;
    const match = SPLIT_RATIOS.find((candidate) => Math.abs(ratio - candidate) / candidate < .02);
    if (match) {
      return {
        code: "unadjusted-split",
        detail: `${observations[index].date} steps by ${match}× against the period before it, which is a stock split this company's registry entry does not record.`,
        dropped: 0,
      };
    }
  }
  return null;
}

/**
 * Turns a requested series into one that can be drawn, or explains why not.
 *
 * Observations that cannot be plotted are removed one at a time and counted,
 * so a provider gap costs its own points rather than the series. Only a problem
 * that makes the whole series meaningless — no usable points left, a unit or
 * currency nobody recognises, a frequency the metric cannot have — marks it
 * unusable.
 */
export function validateSeries(spec: ChartSeriesSpec, observations: SeriesObservation[]): ValidatedSeries {
  const problems: SeriesProblem[] = [];
  const unusable = (reason: string, code: ProblemCode): ValidatedSeries => {
    problems.push({ code, detail: reason, dropped: observations.length });
    return { spec, observations: [], unit: "unknown", currency: "USD", source: "", problems, usable: false, reason };
  };

  if (!observations.length) return unusable("The dataset carries no observation for this metric.", "empty");

  // Frequency has to make sense for the metric before anything else does: a
  // weekly revenue is not a gap in the data, it is a wrong question.
  const marketMetric = MARKET_METRICS.has(spec.metric);
  const marketFrequency = MARKET_FREQUENCIES.has(spec.frequency);
  if (marketMetric && !marketFrequency) {
    return unusable(`A share price cannot be reported ${spec.frequency}.`, "frequency-mismatch");
  }
  if (!marketMetric && !FUNDAMENTAL_FREQUENCIES.has(spec.frequency)) {
    return unusable(`${METRICS[spec.metric]?.label ?? spec.metric} is filed annually or quarterly, not ${spec.frequency}.`, "frequency-mismatch");
  }

  const badDates = observations.filter((item) => !isDate(item.date));
  if (badDates.length) problems.push({ code: "invalid-date", detail: `${badDates.length} observation${badDates.length === 1 ? "" : "s"} carry no usable date.`, dropped: badDates.length });

  const dated = observations.filter((item) => isDate(item.date));
  const nonFinite = dated.filter((item) => item.value != null && !Number.isFinite(item.value));
  if (nonFinite.length) problems.push({ code: "non-finite", detail: `${nonFinite.length} value${nonFinite.length === 1 ? " is" : "s are"} infinite or not a number, usually a division by zero upstream.`, dropped: nonFinite.length });

  const finite = dated.filter((item) => item.value == null || Number.isFinite(item.value));

  // Two facts claiming one date would draw two points on top of each other and
  // make any total wrong. The later filing wins, which is the same rule the
  // normaliser uses for restatements.
  const byDate = new Map<string, SeriesObservation>();
  let duplicates = 0;
  for (const item of finite) {
    const existing = byDate.get(item.date);
    if (existing) {
      duplicates += 1;
      const keepNew = (item.filingDate ?? "") >= (existing.filingDate ?? "");
      if (keepNew) byDate.set(item.date, item);
    } else {
      byDate.set(item.date, item);
    }
  }
  if (duplicates) problems.push({ code: "duplicate-period", detail: `${duplicates} duplicate period${duplicates === 1 ? "" : "s"}; the most recently filed was kept.`, dropped: duplicates });

  const cleaned = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (!cleaned.some((item) => item.value != null)) {
    return unusable("Every observation for this metric is missing a value.", "empty");
  }

  const unit = cleaned.find((item) => item.unit)?.unit ?? "unknown";
  if (!KNOWN_UNITS.has(unit)) return unusable(`Unrecognised unit "${unit}".`, "unknown-unit");

  const currency = cleaned.find((item) => item.currency)?.currency ?? "USD";
  if (!CURRENCY.test(currency)) return unusable(`Unrecognised currency "${currency}".`, "unknown-currency");

  const split = unadjustedSplit(spec.metric, cleaned);
  if (split) problems.push(split);

  return {
    spec, observations: cleaned, unit, currency,
    source: cleaned.find((item) => item.source)?.source ?? "Calculated",
    problems, usable: true,
  };
}

export interface ValidatedChart {
  series: ValidatedSeries[];
  /** Series that could not be drawn, kept so the reader is told why. */
  rejected: ValidatedSeries[];
  /** Every problem worth surfacing, including on series that still drew. */
  warnings: Array<{ id: string; ticker: string; metric: string; problem: SeriesProblem }>;
}

/**
 * Validates every series a chart asks for, and never lets one take the others
 * with it. This is the guarantee the rendering layer relies on: whatever comes
 * back in `series` can be drawn.
 */
export function validateChart(entries: Array<{ spec: ChartSeriesSpec; observations: SeriesObservation[] }>): ValidatedChart {
  const validated = entries.map((entry) => {
    try {
      return validateSeries(entry.spec, entry.observations);
    } catch (error) {
      // A validator that throws would defeat its own purpose.
      return {
        spec: entry.spec, observations: [], unit: "unknown", currency: "USD", source: "",
        problems: [{ code: "empty" as ProblemCode, detail: error instanceof Error ? error.message : "Could not be validated.", dropped: 0 }],
        usable: false, reason: "This series could not be validated.",
      } satisfies ValidatedSeries;
    }
  });

  return {
    series: validated.filter((item) => item.usable),
    rejected: validated.filter((item) => !item.usable),
    warnings: validated.flatMap((item) => item.usable
      ? item.problems.map((problem) => ({ id: item.spec.id, ticker: item.spec.ticker, metric: item.spec.metric, problem }))
      : []),
  };
}
