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

const PALETTE = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)", "var(--c8)", "var(--gain)", "var(--loss)"];
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

/**
 * The stretch of periods a chart may draw: the longest run in which the same
 * lines are reported, the latest run where it has four periods or more.
 *
 * A company that changes how it cuts its revenue reports one set of lines,
 * then another: NVIDIA's products went from Compute and Networking to
 * Hyperscale, AI Clouds and Edge Computing and back, two quarters at a time.
 * Drawn together the lines broke off and reappeared, and their shares stopped
 * adding up to anything. One run is one breakdown, and only one is drawn.
 */
export function coherentRun(values: Array<Array<number | null>>, count: number): { from: number; to: number } | null {
  const signature = Array.from({ length: count }, (_, index) => values.map((line) => (line[index] != null ? "1" : "0")).join(""));
  const runs: Array<{ from: number; to: number }> = [];
  let start = 0;
  for (let index = 1; index <= count; index++) {
    if (index === count || signature[index] !== signature[start]) {
      // A run drawing fewer than two lines draws no comparison.
      if ((signature[start].match(/1/g) ?? []).length >= 2) runs.push({ from: start, to: index });
      start = index;
    }
  }
  const latest = runs.at(-1);
  if (!latest) return null;
  if (latest.to === count && latest.to - latest.from >= 4) return latest;
  return runs.reduce((best, run) => (run.to - run.from > best.to - best.from || (run.to - run.from === best.to - best.from && run.from > best.from) ? run : best));
}

/**
 * `reported`: which lines the filings carry at each period, where that is not
 * the same as which values can be drawn (a growth needs the year before, which
 * the first year has not). `coherent: false` for a chart that compares no
 * lines with each other (a backlog against its own revenue).
 */
function chart(series: Array<{ spec: SeriesSpec; values: Array<number | null> }>, ends: string[], frequency: Frequency,
  options: { reported?: Array<Array<number | null>>; coherent?: boolean } = {}): (ChartData & { changed: string | null }) | null {
  const run = options.coherent === false ? { from: 0, to: ends.length } : coherentRun(options.reported ?? series.map((entry) => entry.values), ends.length);
  if (!run || run.to - run.from < 2) return null;
  let kept = series.map((entry) => ({ ...entry, values: entry.values.slice(run.from, run.to) })).filter((entry) => entry.values.filter((value) => value != null).length >= 2);
  if (!kept.length) return null;
  let shown = ends.slice(run.from, run.to);
  /*
   * And no line broken in the middle: the chart starts after the last hole.
   * A quarter missing from the filings a year earlier leaves that quarter's
   * growth unknown — Caterpillar files no fourth quarter of 2022 of its own —
   * and the line stopped and started again across it. Kept only where three
   * periods or more are left; otherwise the chart is drawn as it is.
   */
  const lastHole = Math.max(-1, ...kept.map((entry) => {
    const first = entry.values.findIndex((value) => value != null);
    let hole = -1;
    entry.values.forEach((value, index) => { if (index > first && value == null && entry.values.slice(index).some((later) => later != null)) hole = index; });
    return hole;
  }));
  const holed = (entry: { values: Array<number | null> }) => {
    const first = entry.values.findIndex((value) => value != null);
    return entry.values.some((value, index) => index > first && value == null && entry.values.slice(index).some((later) => later != null));
  };
  if (lastHole >= 0 && shown.length - (lastHole + 1) >= 3) {
    shown = shown.slice(lastHole + 1);
    kept = kept.map((entry) => ({ ...entry, values: entry.values.slice(lastHole + 1) })).filter((entry) => entry.values.filter((value) => value != null).length >= 2);
    if (!kept.length) return null;
  } else if (lastHole >= 0) {
    // The hole is too near the end to start after it: the broken lines go; a chart of fewer than two goes with them.
    kept = kept.filter((entry) => !holed(entry));
    if (kept.length < Math.min(2, series.length)) return null;
  }
  // Nor periods no line has a value for yet: a growth's first year, whose year before was never reported.
  const lead = Math.max(0, Math.min(...kept.map((entry) => entry.values.findIndex((value) => value != null)).filter((index) => index >= 0)));
  if (lead > 0 && shown.length - lead >= 2) {
    shown = shown.slice(lead);
    kept = kept.map((entry) => ({ ...entry, values: entry.values.slice(lead) }));
  }
  return {
    labels: shown.map((end) => labelOf(end, frequency).replace(/^TTM /, "")),
    names: shown.map((end) => labelOf(end, frequency)),
    series: kept,
    // Where the run stops short of the latest period, the breakdown changed after it.
    changed: run.to < ends.length ? labelOf(ends[run.to], frequency) : null,
  };
}

/** What a chart's note says when the company cut its revenue differently after the stretch drawn. */
const changedNote = (built: { changed: string | null; names: string[] }) =>
  built.changed ? ` Drawn to ${built.names.at(-1)}: the company reported a different breakdown from ${built.changed}.` : "";

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
        note: `Each segment's operating income over its revenue, as the filing states both.${material(segments.lines).length < segments.lines.length ? " Segments under 3% of revenue are left out." : ""}${changedNote(built)}` },
      data: built,
    });
  }

  // The mix: each line's share of the total it adds up to, on the first cut that
  // has reported the same lines for a year up to now — the products where they
  // have, the businesses or the regions where the products were re-cut.
  if (lead) {
    const mixOf = (view: (typeof views)[number]) => {
      const stacks = data.stacks.filter((stack) => stack.measure === "revenue" && stack.axis === view.axis && stack.parent === view.parent
        && stack.periodicity === (frequency === "annual" ? "annual" : "quarterly"));
      const ends = endsOf(view.lines, points, frequency, range).filter((end) => stacks.some((stack) => stack.end === end));
      const built = chart(view.lines.map((line, index) => ({
        spec: spec(`share:${line.id}`, name(line), "line", "left", PALETTE[index % PALETTE.length]),
        values: ends.map((end) => {
          const stack = stacks.find((entry) => entry.end === end);
          const value = line[frequency === "annual" ? "annual" : "quarterly"].find((point) => point.end === end)?.value;
          return stack && stack.ids.includes(line.id) && value != null && stack.total > 0 ? value / stack.total : null;
        }),
      })), ends, frequency === "ttm" ? "quarterly" : frequency);
      return built && built.series.length >= 2 ? { view, built } : null;
    };
    const candidates = views.filter((view) => view.lines.length >= 2).map(mixOf).filter((entry): entry is NonNullable<typeof entry> => entry != null);
    const chosen = candidates.find((entry) => !entry.built.changed) ?? candidates[0];
    if (chosen) out.push({
      preset: { id: "seg-mix", title: `Revenue mix · ${chosen.view.title.toLowerCase()}`, left: "percent", series: chosen.built.series.map((entry) => entry.spec),
        note: `Each line's share of the reported total, in the periods its lines add up to it.${changedNote(chosen.built)}` },
      data: chosen.built,
    });
  }

  // Growth by line, year on year: on the first cut whose lines have been reported
  // the same way up to now, as the mix chooses.
  if (lead) {
    const growthOf = (view: (typeof views)[number]) => {
      const lines = material(view.lines);
      const ends = endsOf(lines, points, frequency, range);
      const built = chart(lines.map((line, index) => ({
        spec: spec(`growth:${line.id}`, name(line), "line", "left", PALETTE[index % PALETTE.length]),
        values: ends.map((end) => {
          const series = points(line);
          const now = series.find((point) => point.end === end)?.value;
          const before = yearBefore(series, end)?.value;
          return now == null || before == null || before <= 0 ? null : now / before - 1;
        }),
      })), ends, frequency, { reported: lines.map((line) => ends.map((end) => points(line).find((point) => point.end === end)?.value ?? null)) });
      return built && built.series.length >= 2 ? { view, lines, built } : null;
    };
    const candidates = views.filter((view) => view.lines.length >= 2).map(growthOf).filter((entry): entry is NonNullable<typeof entry> => entry != null);
    const chosen = candidates.find((entry) => !entry.built.changed) ?? candidates[0];
    if (chosen) out.push({
      preset: { id: "seg-growth", title: `Revenue growth · ${chosen.view.title.toLowerCase()}`, left: "percent", series: chosen.built.series.map((entry) => entry.spec), shadeNegative: true,
        note: `${frequency === "annual" ? "Each line's revenue against the year before." : "Each line's revenue against the same period a year before."}${chosen.lines.length < chosen.view.lines.length ? " Lines under 3% of revenue are left out." : ""}${changedNote(chosen.built)}` },
      data: chosen.built,
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
    ], ends, "quarterly", { coherent: false });
    if (built) out.push({
      preset: { id: `seg-backlog:${backlog.id}`, title: `Backlog · ${label}`, left: "currency", right: "ratio", series: built.series.map((entry) => entry.spec),
        note: "Remaining performance obligations at each balance-sheet date; the line divides them by the last twelve months' revenue of the same slice." },
      data: built,
    });
  }
  return out;
}
