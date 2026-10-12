import type { ChartData, Frequency, Preset, RangeId, SeriesSpec } from "@/lib/term/fundamental-charts";
import { pointsIn } from "@/lib/term/fundamental-charts";
import { trailingTwelve, type SegmentData, type SegmentPoint, type SegmentSeries } from "./build";
import { displayLabel, periodLabel, segmentViews } from "./view";

/**
 * GF's segment charts: the questions the segments answer that the company's
 * totals cannot — which slice earns the margin, which one is growing, how the
 * mix is shifting, how much contracted work a segment carries against what it
 * bills in a year. Drawn by the same chart as the other presets.
 *
 * Every figure is a segment figure as filed (lib/segments/build.ts); the only
 * arithmetic is a margin, a share, a year-on-year change or a backlog over
 * twelve months' revenue, and each chart's note says which.
 *
 * Pure: segment data in, charts out.
 */

const PALETTE = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--gain)", "var(--loss)"];
const DAY = 86_400_000;

type Points = (line: SegmentSeries) => SegmentPoint[];

/** A series' points at the chosen frequency: as filed, or summed over four quarters. */
function pointsAt(frequency: Frequency): Points {
  if (frequency === "annual") return (line) => line.annual;
  if (frequency === "ttm") return (line) => trailingTwelve(line.quarterly);
  return (line) => line.quarterly;
}

const spec = (id: string, label: string, kind: "bar" | "line", axis: "left" | "right", color: string): SeriesSpec => ({ id, label, kind, axis, color, value: () => null });

/** The period ends a chart runs over: those of the lines it draws, the range's last few. */
function endsOf(lines: SegmentSeries[], points: Points, frequency: Frequency, range: RangeId): string[] {
  const ends = [...new Set(lines.flatMap((line) => points(line).map((point) => point.end)))].sort();
  const limit = pointsIn(range, frequency === "ttm" ? "quarterly" : frequency);
  return Number.isFinite(limit) ? ends.slice(-limit) : ends;
}

const labelOf = (end: string, frequency: Frequency) => (frequency === "ttm" ? `TTM ${periodLabel(end, "quarterly")}` : periodLabel(end, frequency === "annual" ? "annual" : "quarterly"));

function chart(series: Array<{ spec: SeriesSpec; values: Array<number | null> }>, ends: string[], frequency: Frequency): ChartData | null {
  const kept = series.filter((entry) => entry.values.filter((value) => value != null).length >= 2);
  if (!kept.length || ends.length < 2) return null;
  const first = Math.min(...kept.map((entry) => entry.values.findIndex((value) => value != null)));
  return {
    labels: ends.slice(first).map((end) => labelOf(end, frequency).replace(/^TTM /, "")),
    names: ends.slice(first).map((end) => labelOf(end, frequency)),
    series: kept.map((entry) => ({ ...entry, values: entry.values.slice(first) })),
  };
}

/** The year before a point, within three weeks: 52/53-week calendars do not land on one date. */
const yearBefore = (points: SegmentPoint[], end: string) =>
  points.find((other) => Math.abs(Date.parse(other.end) - (Date.parse(end) - 365 * DAY)) <= 21 * DAY) ?? null;

export function segmentCharts(data: SegmentData, frequency: Frequency, range: RangeId): Array<{ preset: Preset; data: ChartData }> {
  const points = pointsAt(frequency);
  const views = segmentViews(data);
  const segments = views.find((view) => view.axis === "business" && !view.parent);
  const lead = views[0];
  const name = (line: SegmentSeries) => displayLabel(data.ticker, line.label);
  /*
   * A line under 3% of its cut's revenue is left out of the margin and growth
   * charts: Alphabet's Other Bets runs a margin of −470%, which would stretch
   * the axis until the segments that matter read as one flat line.
   */
  const material = (lines: SegmentSeries[]) => {
    const latest = (line: SegmentSeries) => line.quarterly.at(-1)?.value ?? line.annual.at(-1)?.value ?? 0;
    const total = lines.reduce((sum, line) => sum + Math.max(0, latest(line)), 0);
    return lines.filter((line) => total <= 0 || latest(line) / total >= 0.03);
  };
  const out: Array<{ preset: Preset; data: ChartData }> = [];

  // Operating margin by segment.
  if (segments) {
    const pairs = material(segments.lines).flatMap((line) => {
      const income = data.series.find((other) => other.measure === "operatingIncome" && other.axis === line.axis && other.label === line.label && !other.parent);
      return income ? [{ line, income }] : [];
    });
    const ends = endsOf(pairs.map((pair) => pair.income), points, frequency, range);
    const built = chart(pairs.map(({ line, income }, index) => ({
      spec: spec(`margin:${line.id}`, name(line), "line", "left", PALETTE[index % PALETTE.length]),
      values: ends.map((end) => {
        const revenue = points(line).find((point) => point.end === end)?.value;
        const earned = points(income).find((point) => point.end === end)?.value;
        return revenue == null || earned == null || revenue <= 0 ? null : earned / revenue;
      }),
    })), ends, frequency);
    if (built && pairs.length >= 1) out.push({
      preset: { id: "seg-margin", title: "Operating margin by segment", left: "percent", series: built.series.map((entry) => entry.spec), shadeNegative: true,
        note: `Each segment's operating income over its revenue, as the filing states both.${material(segments.lines).length < segments.lines.length ? " Segments under 3% of revenue are left out." : ""}` },
      data: built,
    });
  }

  // The mix: each line's share of the total it adds up to.
  if (lead) {
    const stacks = data.stacks.filter((stack) => stack.measure === "revenue" && stack.axis === lead.axis && stack.parent === lead.parent
      && stack.periodicity === (frequency === "annual" ? "annual" : "quarterly"));
    const ends = endsOf(lead.lines, points, frequency, range).filter((end) => stacks.some((stack) => stack.end === end));
    const built = chart(lead.lines.map((line, index) => ({
      spec: spec(`share:${line.id}`, name(line), "line", "left", PALETTE[index % PALETTE.length]),
      values: ends.map((end) => {
        const stack = stacks.find((entry) => entry.end === end);
        const value = line[frequency === "annual" ? "annual" : "quarterly"].find((point) => point.end === end)?.value;
        return stack && stack.ids.includes(line.id) && value != null && stack.total > 0 ? value / stack.total : null;
      }),
    })), ends, frequency === "ttm" ? "quarterly" : frequency);
    if (built && built.series.length >= 2) out.push({
      preset: { id: "seg-mix", title: `Revenue mix · ${lead.title.toLowerCase()}`, left: "percent", series: built.series.map((entry) => entry.spec),
        note: "Each line's share of the reported total, in the periods its lines add up to it." },
      data: built,
    });
  }

  // Growth by line, year on year.
  if (lead) {
    const lines = material(lead.lines);
    const ends = endsOf(lines, points, frequency, range);
    const built = chart(lines.map((line, index) => ({
      spec: spec(`growth:${line.id}`, name(line), "line", "left", PALETTE[index % PALETTE.length]),
      values: ends.map((end) => {
        const series = points(line);
        const now = series.find((point) => point.end === end)?.value;
        const before = yearBefore(series, end)?.value;
        return now == null || before == null || before <= 0 ? null : now / before - 1;
      }),
    })), ends, frequency);
    if (built && built.series.length >= 2) out.push({
      preset: { id: "seg-growth", title: `Revenue growth · ${lead.title.toLowerCase()}`, left: "percent", series: built.series.map((entry) => entry.spec), shadeNegative: true,
        note: `${frequency === "annual" ? "Each line's revenue against the year before." : "Each line's revenue against the same period a year before."}${lines.length < lead.lines.length ? " Lines under 3% of revenue are left out." : ""}` },
      data: built,
    });
  }

  // Backlog against the revenue it will become, segment by segment; the
  // company's own is GF's "Backlog & coverage" already.
  for (const backlog of data.series.filter((line) => line.measure === "backlog" && line.axis !== "total" && line.instant.length >= 2)) {
    const revenue = data.series.find((line) => line.measure === "revenue" && line.axis === backlog.axis && line.label === backlog.label && line.parentLabel === backlog.parentLabel);
    const ttm = revenue ? trailingTwelve(revenue.quarterly) : [];
    const ends = backlog.instant.map((point) => point.end).slice(-pointsIn(range, "quarterly"));
    const label = name(backlog);
    const built = chart([
      { spec: spec("backlog", "Backlog", "bar", "left", "var(--c1)"), values: ends.map((end) => backlog.instant.find((point) => point.end === end)?.value ?? null) },
      { spec: spec("coverage", "Years of revenue", "line", "right", "var(--c5)"), values: ends.map((end) => {
        const held = backlog.instant.find((point) => point.end === end)?.value;
        const year = ttm.find((point) => point.end === end)?.value;
        return held == null || year == null || year <= 0 ? null : held / year;
      }) },
    ], ends, "quarterly");
    if (built) out.push({
      preset: { id: `seg-backlog:${backlog.id}`, title: `Backlog · ${label}`, left: "currency", right: "ratio", series: built.series.map((entry) => entry.spec),
        note: "Remaining performance obligations at each balance-sheet date; the line divides them by the last twelve months' revenue of the same slice." },
      data: built,
    });
  }
  return out;
}
