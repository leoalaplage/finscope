import type { MetricAnchor, ReleaseAnchors, ReleaseCheck, ReleaseMetric } from "../adapters/earnings-release";
import type { IoPeriod } from "./view";

/**
 * What a press release is checked against: the quarter it reports a year
 * earlier, as filed, and the quarters around it (lib/adapters/earnings-release.ts).
 *
 * The release is for the quarter after the latest one filed — a release older
 * than the filed figures is not shown at all — so its year-ago quarter is the
 * filed quarter that ended about nine months before the latest one.
 */
export interface ReleaseQuarter {
  /** "Q3 FY2026", in the engine's own labelling. */
  label: string;
  /** The quarter's expected end: the latest filed end plus three months. */
  end: string;
  /** Its number in the fiscal year and the fiscal year, for finding it named in a release. */
  quarter: { number: number; fiscalYear: number };
  yearAgo: { label: string; end: string; values: Partial<Record<ReleaseMetric, number | null>> };
  anchors: ReleaseAnchors;
  check: ReleaseCheck;
}

const DAY = 86_400_000;
const days = (left: string, right: string) => (Date.parse(left) - Date.parse(right)) / DAY;
const addMonths = (iso: string, months: number) => {
  const date = new Date(`${iso}T12:00:00Z`);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months + 1, 0, 12));
  // A quarter that ends on the last day of a month ends on the last day three months on; a 52-week year near it.
  return date.getUTCDate() >= 28 ? target.toISOString().slice(0, 10) : new Date(date.getTime() + 91 * DAY).toISOString().slice(0, 10);
};

/**
 * Earnings per share as a release prints it: as filed, where the filer tagged
 * it (a bank's is after preferred dividends, which net income over the shares
 * is not); otherwise net income, or what is left for common shareholders,
 * over the diluted shares — never both, so a derived reading cannot match a
 * figure the filed one would have refused.
 */
function epsReadings(period: IoPeriod): number[] {
  if (period.reportedEps != null && Number.isFinite(period.reportedEps)) return [period.reportedEps];
  const shares = period.values.dilutedShares;
  return [
    period.values.netIncomePerShare,
    shares && period.values.netIncomeToCommon != null ? period.values.netIncomeToCommon / shares : null,
  ].filter((value): value is number => value != null && Number.isFinite(value));
}

const reading = (period: IoPeriod, metric: ReleaseMetric): number[] =>
  metric === "dilutedEps" ? epsReadings(period) : [period.values[metric]].filter((value): value is number => value != null && Number.isFinite(value));

/** The quarter after `quarterly[after]` (the latest by default), and what to check its release against. */
export function releaseQuarter(quarterly: IoPeriod[], after = quarterly.length - 1): ReleaseQuarter | null {
  const latest = quarterly[after];
  if (!latest) return null;
  const end = addMonths(latest.end, 3);
  const yearAgo = quarterly.find((period) => Math.abs(days(period.end, end) + 365) <= 20);
  if (!yearAgo || !yearAgo.fiscalQuarter) return null;
  const filedBefore = quarterly.slice(0, after + 1);
  const sameYear = filedBefore.filter((period) => period.fiscalYear === yearAgo.fiscalYear + 1 && days(period.end, yearAgo.end) > 0);
  const anchors: ReleaseAnchors = {};
  for (const metric of ["revenue", "operatingIncome", "netIncome", "dilutedEps"] as ReleaseMetric[]) {
    const filed = reading(yearAgo, metric);
    if (!filed.length) continue;
    // The quarters a release prints beside the year-ago one: those since it. An older quarter that happened to
    // earn what this one did must not hide it.
    const known = filedBefore.filter((period) => days(period.end, yearAgo.end) > 0).flatMap((period) => reading(period, metric));
    const thisYear = sameYear.map((period) => reading(period, metric)[0]).filter((value): value is number => value != null);
    // Consecutive quarters added up, over the last two years: what a half, nine months or a year prints as.
    const series = filedBefore.filter((period) => days(period.end, yearAgo.end) > -400).map((period) => reading(period, metric)[0] ?? null);
    const totals: number[] = [];
    for (let length = 2; length <= 4; length++) {
      for (let start = 0; start + length <= series.length; start++) {
        const window = series.slice(start, start + length);
        if (window.every((value) => value != null)) totals.push(window.reduce((sum, value) => sum! + value!, 0)!);
      }
    }
    const anchor: MetricAnchor = {
      totals,
      yearAgo: filed,
      known,
      yearToDate: thisYear.length >= 1 && thisYear.length === sameYear.length ? thisYear.reduce((sum, value) => sum + value, 0) : null,
    };
    anchors[metric] = anchor;
  }
  return {
    label: `${yearAgo.fiscalQuarter} FY${yearAgo.fiscalYear + 1}`,
    end,
    quarter: { number: Number(yearAgo.fiscalQuarter.replace(/\D/g, "")) || 0, fiscalYear: yearAgo.fiscalYear + 1 },
    yearAgo: {
      label: yearAgo.label, end: yearAgo.end,
      values: { revenue: yearAgo.values.revenue ?? null, operatingIncome: yearAgo.values.operatingIncome ?? null, netIncome: yearAgo.values.netIncome ?? null, dilutedEps: epsReadings(yearAgo)[0] ?? null },
    },
    anchors,
    check: { dilutedShares: yearAgo.values.dilutedShares ?? latest.values.dilutedShares ?? null },
  };
}
