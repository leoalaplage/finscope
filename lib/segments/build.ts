import { memberName, type SegmentAxis, type SegmentFact, type SegmentMeasure } from "./xbrl";

/**
 * A company's segments as series: each slice's revenue, operating income and
 * backlog, quarter by quarter and year by year.
 *
 * The same rules as the consolidated figures (lib/periods.ts): a figure filed
 * again in a later report takes the later value; a quarter is the three-month
 * figure the filing states, and a fourth quarter — which no 10-Q states — is
 * the year less the three quarters before it, kept only where all three are
 * there and the result is not negative revenue. Nothing is estimated: a
 * quarter that cannot be isolated is absent.
 *
 * Filings cut the same revenue several ways at once — Amazon by store type and
 * by product against service, Alphabet's advertising and its Search, YouTube
 * and Network inside it — so lines on one axis overlap and cannot simply be
 * stacked. A stack is the largest set of lines that adds up to the total they
 * sit in (the consolidated figure, or the segment a product belongs to),
 * found period by period; lines outside it are other cuts of the same money.
 * Where nothing adds up, nothing is stacked.
 *
 * Pure: facts in, series out.
 */

export interface SegmentPoint { start: string | null; end: string; value: number; accession: string; derived?: boolean }

export interface SegmentSeries {
  id: string;
  measure: SegmentMeasure;
  /** "total" is the consolidated figure the slices are checked against. */
  axis: SegmentAxis | "total";
  member: string;
  label: string;
  /** The segment a product sits in, where the filing nests them (Search inside Google Services). */
  parent: string | null;
  parentLabel: string | null;
  quarterly: SegmentPoint[];
  annual: SegmentPoint[];
  /** Balances at a date: the backlog. */
  instant: SegmentPoint[];
}

/** Lines of one axis that add up to their total for one period. */
export interface SegmentStack {
  measure: SegmentMeasure;
  axis: SegmentAxis;
  /** The segment the lines sit in, by label; null for the company as a whole. */
  parent: string | null;
  periodicity: "quarterly" | "annual";
  start: string;
  end: string;
  total: number;
  ids: string[];
  /** What the total holds beyond the lines — hedging gains, an unallocated sliver — where they fall just short of it. */
  residual: number;
}

export interface SegmentFiling { accession: string; form: string; reportDate: string; filed: string }

export interface SegmentData {
  ticker: string;
  cik: string;
  currency: string;
  builtAt: string;
  filings: SegmentFiling[];
  series: SegmentSeries[];
  stacks: SegmentStack[];
  /** False when a report could not be read: kept, but rebuilt soon. */
  complete?: boolean;
  /** The rules it was built with (SEGMENTS_BUILD); an older build is served and rebuilt behind. */
  build?: number;
}

/**
 * 2: fourth quarters on their quarters' basis, renamed lines joined.
 */
export const SEGMENTS_BUILD = 2;

const DAY = 86_400_000;
const days = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
const CORPORATE = new Set(["us-gaap:CorporateNonSegmentMember", "us-gaap:AllOtherSegmentsMember"]);
/**
 * Within rounding: filings state millions, so each line may be half a million
 * off and a sum of them a little more. Tight on purpose — a looser test lets
 * two different cuts of the revenue add up by coincidence.
 */
const close = (left: number, right: number, lines = 1) => Math.abs(left - right) <= lines * 1_500_000 + Math.abs(right) * 0.0002;
/**
 * Near enough to stand for the total when nothing adds up exactly: Alphabet's
 * revenue holds hedging gains no segment carries, a tenth of a percent. Used
 * only after an exact search fails, and the difference is shown, not hidden.
 */
const near = (left: number, right: number, lines = 1) => Math.abs(left - right) <= lines * 1_500_000 + Math.abs(right) * 0.005;
const windowKey = (fact: { start: string | null; end: string }) => `${fact.start ?? ""}|${fact.end}`;

export function buildSegments(input: {
  ticker: string; cik: string; facts: SegmentFact[]; labels: Map<string, string>; filings: SegmentFiling[]; builtAt?: string;
}): SegmentData {
  const currencies = new Map<string, number>();
  for (const fact of input.facts) currencies.set(fact.currency, (currencies.get(fact.currency) ?? 0) + 1);
  const currency = [...currencies].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "USD";

  // A slice is its measure, its axes and its names: a member the company
  // renames in its taxonomy (NVIDIA's ComputeAndNetworkingMember, later
  // ComputeAndNetworkingSegmentMember) stays one line when its name does not change.
  const sliceOf = (fact: SegmentFact) => [fact.measure, ...fact.members.map(([axis, member]) => `${axis}=${memberName(member, input.labels)}`)].join("|");
  // The latest filing's value for every slice and window; within one filing,
  // the larger revenue (total revenues over revenue from contracts alone).
  const latest = new Map<string, SegmentFact>();
  for (const fact of input.facts) {
    if (fact.currency !== currency) continue;
    const key = `${sliceOf(fact)}|${windowKey(fact)}`;
    const held = latest.get(key);
    if (!held || fact.filed > held.filed || (fact.filed === held.filed && fact.measure === "revenue" && fact.value > held.value)) latest.set(key, fact);
  }
  // Every filing's value of each year, for the fourth quarter (below).
  const years = new Map<string, SegmentFact[]>();
  for (const fact of input.facts) {
    if (fact.currency !== currency || !fact.start || days(fact.start, fact.end) < 300 || days(fact.start, fact.end) > 400) continue;
    const key = `${sliceOf(fact)}|${windowKey(fact)}`;
    years.set(key, [...(years.get(key) ?? []), fact]);
  }
  const kept = withoutMisfiledTotals([...latest.values()]);
  const groups = new Map<string, SegmentFact[]>();
  for (const fact of kept) groups.set(sliceOf(fact), [...(groups.get(sliceOf(fact)) ?? []), fact]);

  const series: SegmentSeries[] = [];
  const slices = new Map<SegmentSeries, string[]>();
  for (const facts of groups.values()) {
    facts.sort((left, right) => right.filed.localeCompare(left.filed));
    const [first, parent] = facts[0].members;
    const axis = first?.[0] ?? "total";
    const id = `${facts[0].measure}:${axis}:${first ? facts[0].members.map(([, member]) => member).join("/") : "total"}`;
    const point = (fact: SegmentFact): SegmentPoint => ({ start: fact.start, end: fact.end, value: fact.value, accession: fact.accession });
    const quarterly = facts.filter((fact) => fact.start && days(fact.start, fact.end) >= 55 && days(fact.start, fact.end) <= 125).map(point);
    const annual = facts.filter((fact) => fact.start && days(fact.start, fact.end) >= 300 && days(fact.start, fact.end) <= 400).map(point);
    const instant = facts.filter((fact) => !fact.start).map(point);
    const byEnd = (left: SegmentPoint, right: SegmentPoint) => left.end.localeCompare(right.end);
    series.push({
      id,
      measure: facts[0].measure,
      axis,
      member: first?.[1] ?? "total",
      label: first ? memberName(first[1], input.labels) : "Total",
      parent: parent?.[1] ?? null,
      parentLabel: parent ? memberName(parent[1], input.labels) : null,
      quarterly: quarterly.sort(byEnd),
      annual: annual.sort(byEnd),
      instant: instant.sort(byEnd),
    });
    slices.set(series.at(-1)!, [sliceOf(facts[0])]);
  }
  const joined = withRenamesJoined(withoutEmpty(series), (older, newer) => slices.set(newer, [...slices.get(newer)!, ...slices.get(older)!]));
  /*
   * The fourth quarter: the year less the three quarters inside it — the year
   * as filed nearest to those quarters, on their basis. Derived once renamed
   * lines are joined, so a year filed under the new name meets the quarters
   * filed under the old. Microsoft recast its segments in 2024: its 2025
   * report states fiscal 2023 on the new basis while that year's quarters
   * stand as first filed, and the difference made Intelligent Cloud's fourth
   * quarter $9bn against $21bn in each of the three before it. Revenue still
   * has to look like a quarter of the same business: between 40% and 250% of
   * the three quarters' average.
   */
  const filedOf = new Map(input.facts.map((fact) => [fact.accession, fact.filed]));
  for (const line of joined) {
    for (const year of line.annual) {
      if (line.quarterly.some((quarter) => quarter.end === year.end)) continue;
      const inside = line.quarterly.filter((quarter) => quarter.start! >= year.start! && quarter.end < year.end);
      if (inside.length !== 3) continue;
      const lastEnd = inside.map((quarter) => quarter.end).sort().at(-1)!;
      const quartersFiled = Date.parse(inside.map((quarter) => filedOf.get(quarter.accession) ?? "").sort().at(-1)!);
      const versions = (slices.get(line) ?? []).flatMap((slice) => years.get(`${slice}|${windowKey(year)}`) ?? [])
        .filter((fact) => fact.filed >= year.end)
        .sort((left, right) => Math.abs(Date.parse(left.filed) - quartersFiled) - Math.abs(Date.parse(right.filed) - quartersFiled));
      const basis = versions[0] ?? { value: year.value, accession: year.accession };
      const value = basis.value - inside.reduce((sum, quarter) => sum + quarter.value, 0);
      const average = inside.reduce((sum, quarter) => sum + quarter.value, 0) / 3;
      if (line.measure === "revenue" && (value < 0 || (average > 0 && (value < average * 0.4 || value > average * 2.5)))) continue;
      const start = new Date(Date.parse(`${lastEnd}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
      if (days(start, year.end) < 55 || days(start, year.end) > 125) continue;
      line.quarterly.push({ start, end: year.end, value, accession: basis.accession, derived: true });
    }
    line.quarterly.sort((left, right) => left.end.localeCompare(right.end));
  }
  const tidy = joined.sort((left, right) => left.id.localeCompare(right.id));
  return {
    ticker: input.ticker.toUpperCase(), cik: input.cik, currency,
    builtAt: input.builtAt ?? new Date().toISOString(), build: SEGMENTS_BUILD,
    filings: [...input.filings].sort((left, right) => right.reportDate.localeCompare(left.reportDate)),
    series: tidy,
    stacks: stacksOf(tidy),
  };
}

/**
 * A corporate line that equals the sum of the segments beside it is the total
 * under the wrong member (NVIDIA tags its operating income so), not the
 * unallocated remainder: dropped before any fourth quarter is derived from it.
 */
function withoutMisfiledTotals(facts: SegmentFact[]): SegmentFact[] {
  const topBusiness = (fact: SegmentFact) => fact.members.length === 1 && fact.members[0][0] === "business";
  return facts.filter((fact) => {
    if (!topBusiness(fact) || !CORPORATE.has(fact.members[0][1])) return true;
    const others = facts.filter((other) => other !== fact && topBusiness(other) && !CORPORATE.has(other.members[0][1])
      && other.measure === fact.measure && windowKey(other) === windowKey(fact));
    return others.length < 2 || !close(fact.value, others.reduce((sum, other) => sum + other.value, 0), others.length);
  });
}

/**
 * One line under two names, joined.
 *
 * Microsoft's "Dynamics" became "Dynamics products and cloud services" in its
 * taxonomy, and the chart drew two short lines where the company has one. Two
 * lines of the same measure, axis and parent are the same line when they
 * state the same value for at least one period they share — the restated
 * report repeating an old period under the new name — and never a different
 * one. The newer name carries the joined line. Lines regrouped rather than
 * renamed (Windows and Devices out of Windows and Devices) share no equal
 * period, and stay apart: nothing here splits or sums a line.
 */
export function withRenamesJoined(series: SegmentSeries[], onJoin?: (older: SegmentSeries, newer: SegmentSeries) => void): SegmentSeries[] {
  const lines = [...series];
  const last = (line: SegmentSeries) => [...line.quarterly, ...line.annual].map((point) => point.end).sort().at(-1) ?? "";
  const first = (line: SegmentSeries) => [...line.quarterly, ...line.annual].map((point) => point.end).sort()[0] ?? "";
  for (let joined = true; joined;) {
    joined = false;
    for (const older of lines) {
      if (older.axis === "total" || older.measure === "backlog") continue;
      const newer = lines.find((other) => other !== older && other.measure === older.measure && other.axis === older.axis
        && other.parentLabel === older.parentLabel && other.label !== older.label
        && last(other) > last(older) && first(other) > first(older) && sameLine(older, other));
      if (!newer) continue;
      const merge = (periodicity: "quarterly" | "annual") => {
        const held = new Set(newer[periodicity].map((point) => windowKey(point)));
        newer[periodicity] = [...older[periodicity].filter((point) => !held.has(windowKey(point))), ...newer[periodicity]].sort((left, right) => left.end.localeCompare(right.end));
      };
      merge("quarterly"); merge("annual");
      onJoin?.(older, newer);
      lines.splice(lines.indexOf(older), 1);
      joined = true;
      break;
    }
  }
  return lines;
}

function sameLine(left: SegmentSeries, right: SegmentSeries): boolean {
  let equal = 0;
  for (const periodicity of ["quarterly", "annual"] as const) {
    for (const point of left[periodicity]) {
      const other = right[periodicity].find((each) => each.start === point.start && each.end === point.end);
      if (!other) continue;
      if (!close(point.value, other.value)) return false;
      equal++;
    }
  }
  return equal > 0;
}

/** A line that is zero throughout says nothing. */
function withoutEmpty(series: SegmentSeries[]): SegmentSeries[] {
  return series.filter((line) => [...line.quarterly, ...line.annual, ...line.instant].some((point) => point.value !== 0));
}

const MAX_LINES = 16;

/** The largest set of values adding up to the total, by index; null if none does. */
export function largestPartition(values: number[], total: number, within: (sum: number, total: number, lines: number) => boolean = close): number[] | null {
  const count = values.length;
  if (!count || count > MAX_LINES) return null;
  const sums = new Float64Array(1 << count);
  let best = -1; let bestSize = 0;
  for (let mask = 1; mask < 1 << count; mask++) {
    const low = mask & -mask;
    sums[mask] = sums[mask ^ low] + values[31 - Math.clz32(low)];
    let size = 0; for (let bits = mask; bits; bits &= bits - 1) size++;
    if (size > bestSize && within(sums[mask], total, size)) { best = mask; bestSize = size; }
  }
  if (best < 0) return null;
  return values.flatMap((_, index) => (best & (1 << index) ? [index] : []));
}

function stacksOf(series: SegmentSeries[]): SegmentStack[] {
  const stacks: SegmentStack[] = [];
  const groups = new Map<string, SegmentSeries[]>();
  for (const line of series) {
    if (line.axis === "total" || line.measure === "backlog") continue;
    const key = `${line.measure}|${line.axis}|${line.parentLabel ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  for (const lines of groups.values()) {
    const { measure, axis, parentLabel } = lines[0];
    if (axis === "total") continue;
    // What the lines must add up to: the company's figure, or the segment they sit in.
    const whole = parentLabel
      ? series.find((line) => line.measure === measure && line.axis === "business" && !line.parent && line.label === parentLabel)
      : series.find((line) => line.measure === measure && line.axis === "total");
    if (!whole) continue;
    for (const periodicity of ["quarterly", "annual"] as const) {
      for (const target of whole[periodicity]) {
        const present = lines
          .map((line) => ({ line, point: line[periodicity].find((point) => point.start === target.start && point.end === target.end) }))
          .filter((entry): entry is { line: SegmentSeries; point: SegmentPoint } => entry.point != null)
          .sort((left, right) => Math.abs(right.point.value) - Math.abs(left.point.value))
          .slice(0, MAX_LINES);
        const values = present.map((entry) => entry.point.value);
        const chosen = largestPartition(values, target.value) ?? largestPartition(values, target.value, near);
        // A single line equal to the whole is not a breakdown.
        if (!chosen || chosen.length < 2) continue;
        const sum = chosen.reduce((total, index) => total + values[index], 0);
        stacks.push({
          measure, axis, parent: parentLabel, periodicity, start: target.start!, end: target.end, total: target.value,
          ids: chosen.map((index) => present[index].line.id),
          residual: close(sum, target.value, chosen.length) ? 0 : target.value - sum,
        });
      }
    }
  }
  return stacks.sort((left, right) => left.end.localeCompare(right.end));
}

/** The trailing twelve months of a series at each quarter with three before it, consecutive. */
export function trailingTwelve(quarterly: SegmentPoint[]): SegmentPoint[] {
  const out: SegmentPoint[] = [];
  for (let index = 3; index < quarterly.length; index++) {
    const window = quarterly.slice(index - 3, index + 1);
    const span = days(window[0].start ?? window[0].end, window[3].end);
    if (span < 330 || span > 380) continue;
    out.push({ start: window[0].start, end: window[3].end, value: window.reduce((sum, quarter) => sum + quarter.value, 0), accession: window[3].accession, derived: true });
  }
  return out;
}
