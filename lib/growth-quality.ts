import { cagrForPeriods, derivedValue } from "./finance";
import type { FinancialPeriod } from "./types";

export type Horizon = 5 | 10;

export interface CagrCell {
  value: number | null;
  /** Why a horizon is empty, so a blank cell is never mistaken for zero growth. */
  reason?: string;
  years: number;
}

export interface GrowthRow {
  metric: string;
  label: string;
  cells: Record<Horizon, CagrCell>;
}

/** The metrics a growth comparison is normally read across, in reading order. */
export const GROWTH_ROWS: Array<[string, string]> = [
  ["revenue", "Revenue"],
  ["grossProfit", "Gross profit"],
  ["operatingIncome", "Operating profit"],
  ["netIncome", "Net income"],
  ["freeCashFlow", "Free cash flow"],
  ["freeCashFlowPerShare", "FCF per share"],
  ["stockPrice", "Share price"],
];

export const HORIZONS: Horizon[] = [5, 10];

function cell(periods: FinancialPeriod[], metric: string, horizon: Horizon): CagrCell {
  const usable = periods.filter((period) => derivedValue(period, metric) != null);
  if (usable.length < 2) return { value: null, reason: "Fewer than two reported periods", years: usable.length };
  const span = usable.length - 1;
  if (span < horizon) return { value: null, reason: `Only ${span} year${span === 1 ? "" : "s"} of history`, years: span };
  const result = cagrForPeriods(periods, metric, horizon);
  return { value: result.value, reason: result.value == null ? "Endpoint is zero or negative" : undefined, years: horizon };
}

/**
 * Compound growth per metric and horizon, from fundamentals only.
 *
 * Share price is not in here: it lives on trading dates rather than fiscal ones
 * and is passed in separately by whoever has the market series.
 */
export function growthTable(annual: FinancialPeriod[], metrics = GROWTH_ROWS): GrowthRow[] {
  const ordered = [...annual].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  return metrics.map(([metric, label]) => ({
    metric, label,
    cells: Object.fromEntries(HORIZONS.map((horizon) => [horizon, cell(ordered, metric, horizon)])) as Record<Horizon, CagrCell>,
  }));
}

export interface ConsistencyResult {
  /** R² of a log-linear fit: 1.00 is a perfectly steady compounding path. */
  rSquared: number | null;
  observations: number;
  reason?: string;
}

/**
 * How steadily a series compounded, as the R² of a least-squares fit through
 * its logarithm.
 *
 * A growth rate on its own says nothing about the path taken to get there: two
 * companies can both compound at 15% while one did it every year and the other
 * did it once. Fitting the log means a constant growth rate is a straight line,
 * so R² reads as "how much of this looks like steady compounding". A single
 * negative or zero year makes the logarithm undefined, and that is reported
 * rather than patched around, because a company that lost money is exactly the
 * case the number is meant to expose.
 */
export function growthConsistency(periods: FinancialPeriod[], metric: string, horizon?: Horizon): ConsistencyResult {
  const ordered = [...periods].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const windowed = horizon ? ordered.slice(-(horizon + 1)) : ordered;
  const values = windowed.map((period) => derivedValue(period, metric)).filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length < 3) return { rSquared: null, observations: values.length, reason: "Needs at least three reported years" };
  if (values.some((value) => value <= 0)) return { rSquared: null, observations: values.length, reason: "A zero or negative year makes the fit undefined" };

  const logs = values.map((value) => Math.log(value));
  const n = logs.length;
  const meanX = (n - 1) / 2;
  const meanY = logs.reduce((sum, value) => sum + value, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [index, value] of logs.entries()) {
    const dx = index - meanX, dy = value - meanY;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return { rSquared: null, observations: n, reason: "The series does not vary" };
  const rSquared = (sxy * sxy) / (sxx * syy);
  return { rSquared: Math.min(1, Math.max(0, rSquared)), observations: n };
}

export interface GrowthGap {
  revenue: number | null;
  freeCashFlow: number | null;
  /** Free cash flow growth minus revenue growth, in percentage points. */
  spread: number | null;
  reason?: string;
}

/**
 * Whether cash generation outgrew the top line.
 *
 * A positive spread means margins or capital intensity moved in the owner's
 * favour; a persistently negative one means revenue is being bought rather
 * than converted.
 */
export function growthGap(annual: FinancialPeriod[], horizon: Horizon = 10): GrowthGap {
  const table = growthTable(annual, [["revenue", "Revenue"], ["freeCashFlow", "Free cash flow"]]);
  const revenue = table[0].cells[horizon];
  const freeCashFlow = table[1].cells[horizon];
  const spread = revenue.value != null && freeCashFlow.value != null ? freeCashFlow.value - revenue.value : null;
  return {
    revenue: revenue.value, freeCashFlow: freeCashFlow.value, spread,
    reason: spread == null ? freeCashFlow.reason ?? revenue.reason ?? "Not comparable over this horizon" : undefined,
  };
}

export interface CalloutDefinition {
  id: string;
  label: string;
  /** Computed against the annual periods; returns the figure and its reading. */
  compute: (annual: FinancialPeriod[]) => { display: string; note: string };
}

const pp = (value: number | null) => value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`;
const pct = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;

function gapCallout(horizon: Horizon): CalloutDefinition {
  return {
    id: `gap-${horizon}`, label: `FCF vs revenue · ${horizon}Y`,
    compute: (annual) => {
      const gap = growthGap(annual, horizon);
      return {
        display: pp(gap.spread),
        note: gap.spread == null ? gap.reason ?? "Not comparable" :
          `Free cash flow ${pct(gap.freeCashFlow)} vs revenue ${pct(gap.revenue)}. ${gap.spread >= 0 ? "Cash grew faster than sales." : "Sales grew faster than cash."}`,
      };
    },
  };
}

function consistencyCallout(metric: string, name: string, horizon: Horizon): CalloutDefinition {
  return {
    id: `consistency-${metric}-${horizon}`, label: `${name} consistency · ${horizon}Y`,
    compute: (annual) => {
      const item = growthConsistency(annual, metric, horizon);
      return {
        display: item.rSquared == null ? "—" : item.rSquared.toFixed(2),
        note: item.rSquared == null ? item.reason ?? "Not measurable" :
          `R² of a log-linear fit over ${item.observations} years. ${item.rSquared >= 0.9 ? "Steady compounding." : item.rSquared >= 0.7 ? "Broadly steady, with visible swings." : "Lumpy: the average rate hides the path."}`,
      };
    },
  };
}

function cagrCallout(metric: string, name: string, horizon: Horizon): CalloutDefinition {
  return {
    id: `cagr-${metric}-${horizon}`, label: `${name} CAGR · ${horizon}Y`,
    compute: (annual) => {
      const [row] = growthTable(annual, [[metric, name]]);
      const item = row.cells[horizon];
      return { display: pct(item.value), note: item.reason ?? `Compound annual growth over ${horizon} years.` };
    },
  };
}

/** Everything the reader can pin to the company page, in offer order. */
export const CALLOUTS: CalloutDefinition[] = [
  gapCallout(10), gapCallout(5),
  consistencyCallout("freeCashFlow", "FCF", 10), consistencyCallout("freeCashFlow", "FCF", 5),
  consistencyCallout("revenue", "Revenue", 10),
  consistencyCallout("netIncome", "Net income", 10),
  cagrCallout("freeCashFlowPerShare", "FCF / share", 10),
  cagrCallout("freeCashFlowAfterSbc", "FCF after SBC", 10),
  cagrCallout("dilutedShares", "Diluted shares", 10),
];

export const DEFAULT_CALLOUTS = ["gap-10", "consistency-freeCashFlow-5", "consistency-freeCashFlow-10"];
