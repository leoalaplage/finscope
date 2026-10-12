import type { EpsSurprise } from "@/lib/estimates";

/**
 * A company's quarterly reports in one table, as a research terminal lays
 * them out: what each quarter filed (revenue and its growth on the same
 * quarter a year before, GAAP EPS), how it compared with the analysts'
 * consensus (Zacks' adjusted EPS, for the quarters Nasdaq still lists), and
 * how the stock took it — from the close before the earnings release to the
 * third session after.
 *
 * Pure: quarters, release dates, daily closes and surprises in, rows out.
 */

export interface ReportQuarter { label: string; end: string; revenue: number | null; eps: number | null }
export interface ReportRow {
  label: string;
  end: string;
  revenue: number | null;
  revenueYoy: number | null;
  eps: number | null;
  epsYoy: number | null;
  /** The earnings release this quarter was reported in. */
  released: string | null;
  /** Close before the release to the close three sessions after it. */
  move3d: number | null;
  /** Adjusted EPS, consensus and percent surprise, where Nasdaq has the quarter. */
  adjustedEps: number | null;
  consensus: number | null;
  surprise: number | null;
}

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jun 2026" for a quarter ending in late June or the first days of July (52/53-week calendars). */
export function fiscalEndName(end: string): string {
  const date = new Date(Date.parse(`${end}T00:00:00Z`) - 10 * DAY);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

const growth = (now: number | null, before: number | null | undefined) =>
  now == null || before == null || before === 0 ? null : before < 0 ? (now - before) / Math.abs(before) : now / before - 1;

export function reportRows(
  quarters: ReportQuarter[],
  releases: string[],
  closes: { t: number[]; c: number[] },
  surprises: EpsSurprise[] = [],
  limit = 12,
): ReportRow[] {
  const sorted = [...quarters].sort((a, b) => a.end.localeCompare(b.end));
  const days = closes.t.map((time) => new Date(time * 1000).toISOString().slice(0, 10));
  const releaseDays = [...new Set(releases)].sort();
  const bySurprise = new Map(surprises.map((entry) => [entry.fiscalEnd, entry]));
  return sorted.slice(-limit).reverse().map((quarter) => {
    const yearAgo = sorted.find((other) => Math.abs(Date.parse(other.end) - (Date.parse(quarter.end) - 365 * DAY)) <= 20 * DAY);
    const surprise = bySurprise.get(fiscalEndName(quarter.end));
    // The first earnings release after the quarter closed, within the 75 days a 10-Q allows; Nasdaq's report date otherwise.
    const released = releaseDays.find((day) => day > quarter.end && Date.parse(day) - Date.parse(quarter.end) <= 75 * DAY) ?? surprise?.reported ?? null;
    let move3d: number | null = null;
    if (released) {
      let prior = -1;
      for (let index = 0; index < days.length && days[index] < released; index++) prior = index;
      const after = days.findIndex((day) => day > released);
      // The close before the release, to the third session after the release day: either side of the open or the close.
      if (prior >= 0 && after >= 0 && after + 2 < closes.c.length) move3d = closes.c[after + 2] / closes.c[prior] - 1;
    }
    return {
      label: quarter.label, end: quarter.end,
      revenue: quarter.revenue, revenueYoy: growth(quarter.revenue, yearAgo?.revenue),
      eps: quarter.eps, epsYoy: growth(quarter.eps, yearAgo?.eps),
      released, move3d,
      adjustedEps: surprise?.eps ?? null, consensus: surprise?.consensus ?? null, surprise: surprise?.surprise ?? null,
    };
  });
}
