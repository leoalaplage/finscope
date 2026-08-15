import { cagrForPeriods, derivedValue, investedCapital, nopat } from "./finance";
import type { FinancialPeriod } from "./types";

/**
 * The windows a compounder is judged over.
 *
 * Five and ten years alone flatter a company whose good decade began recently
 * and hide one whose best years are behind it. Twenty years and the full
 * available history are what separate a durable business from a cyclical one,
 * and three years is what says whether it is still working now.
 */
export type Horizon = 3 | 5 | 10 | 15 | 20 | "max";
/** The windows that mean a fixed number of years, for the checks that need one. */
export type NumericHorizon = 3 | 5 | 10 | 15 | 20;

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
const GROWTH_ROWS: Array<[string, string]> = [
  ["revenue", "Revenue"],
  ["grossProfit", "Gross profit"],
  ["operatingIncome", "Operating profit"],
  ["netIncome", "Net income"],
  ["freeCashFlow", "Free cash flow"],
  ["freeCashFlowPerShare", "FCF per share"],
  ["stockPrice", "Share price"],
];

export const HORIZONS: Horizon[] = [3, 5, 10, 15, 20, "max"];

function cell(periods: FinancialPeriod[], metric: string, horizon: Horizon): CagrCell {
  const usable = periods.filter((period) => derivedValue(period, metric) != null);
  if (usable.length < 2) return { value: null, reason: "Fewer than two reported periods", years: usable.length };
  const span = usable.length - 1;
  if (horizon !== "max" && span < horizon) return { value: null, reason: `Only ${span} year${span === 1 ? "" : "s"} of history`, years: span };
  const result = cagrForPeriods(periods, metric, horizon);
  return { value: result.value, reason: result.value == null ? "Endpoint is zero or negative" : undefined, years: horizon === "max" ? Math.round(result.years) : horizon };
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
export function growthConsistency(periods: FinancialPeriod[], metric: string, horizon?: NumericHorizon): ConsistencyResult {
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

function consistencyCallout(metric: string, name: string, horizon: NumericHorizon): CalloutDefinition {
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

function roiicCallout(horizon: NumericHorizon): CalloutDefinition {
  return {
    id: `roiic-${horizon}`, label: `Incremental ROIC · ${horizon}Y`,
    compute: (annual) => {
      const item = incrementalReturn(annual, horizon);
      return {
        display: pct(item.value),
        note: item.value == null ? item.reason ?? "Not measurable" :
          `Each extra dollar of invested capital bought ${(item.value * 100).toFixed(0)} cents of operating profit after tax. ${item.value >= 0.15 ? "Growth is paying for itself." : item.value >= 0 ? "Growth is being bought at a modest return." : "Extra capital reduced profit."}`,
      };
    },
  };
}

const ruleOfFortyCallout: CalloutDefinition = {
  id: "rule-of-40", label: "Rule of 40",
  compute: (annual) => {
    const item = ruleOfForty(annual);
    return {
      display: item.value == null ? "—" : `${(item.value * 100).toFixed(0)}`,
      note: item.value == null ? item.reason ?? "Not measurable" :
        `Revenue growth ${pct(item.growth)} plus cash margin ${pct(item.margin)}. ${item.value >= 0.4 ? "Above the forty-point bar." : "Below the forty-point bar."}`,
    };
  },
};

const drawdownCallout: CalloutDefinition = {
  id: "fcf-drawdown", label: "Worst FCF drawdown",
  compute: (annual) => {
    const item = worstDrawdown(annual);
    return {
      display: item.value == null ? "—" : `−${(item.value * 100).toFixed(0)}%`,
      note: item.value == null ? item.reason ?? "Not measurable"
        : item.value === 0 ? "Free cash flow never fell below a previous peak."
        : `Deepest peak-to-trough fall, ${item.peakYear} to ${item.troughYear}. Consistency describes the path; this is how bad it got.`,
    };
  },
};

const capitalIntensityCallout: CalloutDefinition = {
  id: "capital-intensity", label: "Capital intensity",
  compute: (annual) => {
    const latest = [...annual].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1);
    const now = latest ? derivedValue(latest, "capitalIntensity") : null;
    const five = [...annual].slice(-6, -1).map((period) => derivedValue(period, "capitalIntensity")).filter((value): value is number => value != null);
    const average = five.length ? five.reduce((sum, value) => sum + value, 0) / five.length : null;
    return {
      display: pct(now),
      note: now == null ? "Capital expenditure or revenue unavailable"
        : average == null ? "Capital expenditure as a share of revenue."
        : `Against a ${pct(average)} five-year average. ${now < average ? "Spending less per dollar of sales than it used to." : "Spending more per dollar of sales than it used to."}`,
    };
  },
};

/** Everything the reader can pin to the company page, in offer order. */
export const CALLOUTS: CalloutDefinition[] = [
  roiicCallout(5), roiicCallout(10), ruleOfFortyCallout, drawdownCallout, capitalIntensityCallout,
  gapCallout(10), gapCallout(5),
  consistencyCallout("freeCashFlow", "FCF", 10), consistencyCallout("freeCashFlow", "FCF", 5),
  consistencyCallout("revenue", "Revenue", 10),
  consistencyCallout("netIncome", "Net income", 10),
  cagrCallout("freeCashFlowPerShare", "FCF / share", 10),
  cagrCallout("freeCashFlowAfterSbc", "FCF after SBC", 10),
  cagrCallout("dilutedShares", "Diluted shares", 10),
];

export const DEFAULT_CALLOUTS = ["gap-10", "consistency-freeCashFlow-5", "consistency-freeCashFlow-10"];

export interface IncrementalReturn {
  value: number | null;
  nopatChange: number | null;
  capitalChange: number | null;
  reason?: string;
}

/**
 * Return on incremental invested capital: what the growth actually cost.
 *
 * Two companies growing revenue at the same rate are not equivalent if one
 * needed twice the capital to do it. Dividing the change in operating profit
 * after tax by the change in invested capital says how much profit each extra
 * dollar of capital bought.
 *
 * Capital that shrank makes the ratio meaningless rather than excellent — a
 * negative denominator would flip the sign of a perfectly ordinary result — so
 * it is reported as not measurable instead.
 */
export function incrementalReturn(annual: FinancialPeriod[], horizon: NumericHorizon = 5): IncrementalReturn {
  const ordered = [...annual].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const usable = ordered.filter((period) => nopat(period) != null && investedCapital(period) != null);
  if (usable.length < 2) return { value: null, nopatChange: null, capitalChange: null, reason: "Needs two years with both profit and capital" };
  const end = usable.at(-1)!;
  const start = usable[Math.max(0, usable.length - 1 - horizon)];
  if (start === end) return { value: null, nopatChange: null, capitalChange: null, reason: "Only one usable year" };
  const nopatChange = nopat(end)! - nopat(start)!;
  const capitalChange = investedCapital(end)! - investedCapital(start)!;
  if (capitalChange <= 0) return { value: null, nopatChange, capitalChange, reason: "Invested capital did not grow, so the ratio has no meaning" };
  return { value: nopatChange / capitalChange, nopatChange, capitalChange };
}

/**
 * Growth plus profitability in one number, the way software investors read it.
 * Anything at or above forty is considered a fair trade between the two.
 */
export function ruleOfForty(annual: FinancialPeriod[]): { value: number | null; growth: number | null; margin: number | null; reason?: string } {
  const ordered = [...annual].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const end = ordered.at(-1); const previous = ordered.at(-2);
  if (!end || !previous) return { value: null, growth: null, margin: null, reason: "Needs two reported years" };
  const current = derivedValue(end, "revenue"); const before = derivedValue(previous, "revenue");
  const margin = derivedValue(end, "freeCashFlowMargin");
  const growth = current != null && before != null && before > 0 ? current / before - 1 : null;
  if (growth == null || margin == null) return { value: null, growth, margin, reason: "Revenue growth or cash margin unavailable" };
  return { value: growth + margin, growth, margin };
}

export interface Drawdown { value: number | null; peakYear?: string; troughYear?: string; reason?: string }

/**
 * The deepest peak-to-trough fall in a series, as a fraction of the peak.
 *
 * Consistency says whether the path was smooth; this says how bad it got when
 * it was not. A company can compound steadily on average and still have halved
 * once, which is the part an average hides.
 */
export function worstDrawdown(annual: FinancialPeriod[], metric = "freeCashFlow"): Drawdown {
  const points = [...annual].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    .flatMap((period) => { const value = derivedValue(period, metric); return value == null ? [] : [{ year: period.periodEnd.slice(0, 4), value }]; });
  if (points.length < 3) return { value: null, reason: "Needs at least three reported years" };
  let peak = points[0]; let worst: Drawdown = { value: 0 };
  for (const point of points) {
    if (point.value > peak.value) peak = point;
    if (peak.value <= 0) continue;
    const fall = (peak.value - point.value) / peak.value;
    if (fall > (worst.value ?? 0)) worst = { value: fall, peakYear: peak.year, troughYear: point.year };
  }
  return worst.value ? worst : { value: 0, reason: "The series never fell below a previous peak" };
}

/**
 * Where a value sits among its peers, as a percentile and a rank.
 *
 * A margin of 29% means nothing on its own; fourth of twenty-one places it.
 * Companies without the figure are excluded rather than ranked last, since a
 * missing number is not a bad one.
 */
export function percentileAmong(value: number | null, peers: Array<number | null>, higherIsBetter = true) {
  if (value == null || !Number.isFinite(value)) return null;
  const finite = peers.filter((item): item is number => item != null && Number.isFinite(item));
  if (finite.length < 3) return null;
  const better = finite.filter((item) => higherIsBetter ? item > value : item < value).length;
  return { rank: better + 1, of: finite.length, percentile: 1 - better / finite.length };
}
