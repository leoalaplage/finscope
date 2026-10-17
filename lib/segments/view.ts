import { trailingTwelve, type SegmentData, type SegmentPoint, type SegmentSeries } from "./build";

/**
 * What the SEG panel shows of a company's segments (lib/segments/build.ts):
 * the ways its filings cut revenue — by segment, inside a segment, by product,
 * by region — each as a chart of the lines that add up to the total and a
 * table of every line with its growth, its share, its margin and its backlog.
 *
 * Pure: segment data in, what to draw out.
 */

export type SegmentPeriodicity = "quarterly" | "annual";

/** The chart line for what a total holds beyond its lines. */
export const RESIDUAL_ID = "residual";

export interface SegmentView {
  id: string;
  title: string;
  axis: SegmentSeries["axis"];
  parent: string | null;
  /** Revenue lines of this cut, the ones that add up first. */
  lines: SegmentSeries[];
}

export interface SegmentChart {
  labels: string[];
  ends: string[];
  totals: Array<number | null>;
  /** One per line that appears in a stack, values null where it is not part of that period's stack. */
  series: Array<{ id: string; label: string; values: Array<number | null> }>;
  /** True when every period drawn adds up to the reported total. */
  reconciled: boolean;
}

export interface SegmentRow {
  id: string;
  label: string;
  /** Part of the latest stack, or another cut of the same revenue. */
  stacked: boolean;
  latest: SegmentPoint | null;
  yoy: number | null;
  share: number | null;
  ttm: number | null;
  ttmYoy: number | null;
  operatingIncome: number | null;
  margin: number | null;
  backlog: SegmentPoint | null;
  /** The latest point is older than the company's latest period: a line the filing no longer states. */
  stale: boolean;
}

/** Curated names for the largest filers, where the filing's own label reads poorly on screen. */
const RENAME: Record<string, Record<string, string>> = {
  GOOGL: { "Reconciling items": "Alphabet-level activities" },
  GOOG: { "Reconciling items": "Alphabet-level activities" },
  TSLA: { "Energy generation and storage segment": "Energy generation and storage", "Automotive Revenues": "Automotive revenues" },
  MSFT: { XBOX: "Xbox content and services", "Microsoft 365 Commercial Products and Cloud Services": "Microsoft 365 Commercial", "Microsoft 365 Consumer products and cloud services": "Microsoft 365 Consumer" },
  AMZN: { AWS: "AWS" },
  META: { "Rest Of World": "Rest of world" },
};
/** Which cut opens first, where the segments themselves are not what readers follow. */
const OPENS_ON: Record<string, string> = { NVDA: "product", AAPL: "product" };

export function displayLabel(ticker: string, label: string): string {
  // A label read from a linkbase can keep its HTML entities: Walmart's "Sam's&#160;Club U.S.".
  const plain = label.replace(/&#160;|&nbsp;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "’").replace(/&#39;|&apos;/g, "'");
  return RENAME[ticker.toUpperCase()]?.[plain] ?? RENAME[ticker.toUpperCase()]?.[label] ?? plain;
}

const DAY = 86_400_000;
const yearBefore = (points: SegmentPoint[], point: SegmentPoint) =>
  points.find((other) => Math.abs(Date.parse(other.end) - (Date.parse(point.end) - 365 * DAY)) <= 20 * DAY) ?? null;
const growth = (now: number | null | undefined, before: number | null | undefined) =>
  now == null || before == null || before <= 0 ? null : now / before - 1;

export function segmentViews(data: SegmentData): SegmentView[] {
  const revenue = data.series.filter((line) => line.measure === "revenue" && line.axis !== "total");
  const latestEnd = revenue.flatMap((line) => line.quarterly.concat(line.annual)).map((point) => point.end).sort().at(-1) ?? "";
  // A cut no filing of the last two years states is history, not a view.
  const recent = (line: SegmentSeries) => [...line.quarterly, ...line.annual].some((point) => Date.parse(point.end) >= Date.parse(latestEnd) - 730 * DAY);
  const groups = new Map<string, SegmentSeries[]>();
  for (const line of revenue.filter(recent)) {
    const key = `${line.axis}|${line.parentLabel ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const order = (key: string) => {
    const [axis, parent] = key.split("|");
    return (OPENS_ON[data.ticker] === axis && !parent ? -10 : 0) + ({ business: 0, product: 2, geography: 3 }[axis] ?? 4) + (parent ? 1 : 0);
  };
  const views: SegmentView[] = [];
  for (const [key, lines] of [...groups].sort((left, right) => order(left[0]) - order(right[0]))) {
    if (lines.length < 2) continue;
    const [axis, parent] = key.split("|");
    const size = (line: SegmentSeries) => line.quarterly.at(-1)?.value ?? line.annual.at(-1)?.value ?? 0;
    views.push({
      id: key,
      title: parent ? `Inside ${displayLabel(data.ticker, parent)}` : axis === "business" ? "By segment" : axis === "product" ? "By product" : "By region",
      axis: axis as SegmentSeries["axis"],
      parent: parent || null,
      lines: [...lines].sort((left, right) => size(right) - size(left)),
    });
  }
  return views;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function periodLabel(end: string, periodicity: SegmentPeriodicity): string {
  const [year, month] = end.split("-").map(Number);
  return periodicity === "annual" ? `FY${String(year).slice(2)}` : `${MONTHS[month - 1]} ${String(year).slice(2)}`;
}

/**
 * The chart of one cut: each period's stack where the lines add up to the
 * total; where they never do, every line on its own, unstacked.
 */
export function segmentChart(data: SegmentData, view: SegmentView, periodicity: SegmentPeriodicity, measure: "revenue" | "operatingIncome" = "revenue", periods = periodicity === "quarterly" ? 16 : 6): SegmentChart | null {
  const lines = measure === "revenue" ? view.lines : data.series.filter((line) => line.measure === measure && line.axis === view.axis && (line.parentLabel ?? null) === view.parent);
  if (!lines.length) return null;
  const stacks = data.stacks.filter((stack) => stack.measure === measure && stack.axis === view.axis && stack.parent === view.parent && stack.periodicity === periodicity).slice(-periods);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const ends = [...new Set(lines.flatMap((line) => line[periodicity].map((point) => point.end)))].sort().slice(-periods);
  // Stacked only where the stacks reach the latest period: a cut that stopped
  // adding up (JPMorgan's segments, on a managed basis) is drawn line by line.
  if (stacks.length && stacks.at(-1)!.end === ends.at(-1)) {
    const ids = [...new Set(stacks.flatMap((stack) => stack.ids))].filter((id) => byId.has(id));
    const valueAt = (id: string, end: string) => byId.get(id)![periodicity].find((point) => point.end === end)?.value ?? null;
    const series = ids
      .map((id) => ({ id, label: displayLabel(data.ticker, byId.get(id)!.label), values: stacks.map((stack) => (stack.ids.includes(id) ? valueAt(id, stack.end) : null)) }))
      // The largest at the bottom of each bar.
      .sort((left, right) => (right.values.at(-1) ?? 0) - (left.values.at(-1) ?? 0));
    /*
     * An unallocated line the filings leave untagged carries on as the
     * residual: Broadcom's "Unallocated expenses" up to August 2025, the gap
     * between its segments and its operating income after; NVIDIA's
     * "Corporate and unallocated", tagged in some quarters and not others.
     * One line, not two colours taking turns. Only a cost line, only where it
     * is missing and the gap is a cost.
     */
    const residuals = stacks.map((stack) => stack.residual);
    if (measure === "operatingIncome") {
      const handed = series.find((line) => /unallocated|corporate|reconciling|all other/i.test(line.label)
        && line.values.every((value) => value == null || value <= 0)
        && residuals.every((value, index) => value === 0 || line.values[index] == null));
      if (handed) {
        handed.values = handed.values.map((value, index) => (value == null && residuals[index] < 0 ? residuals[index] : value));
        residuals.forEach((value, index) => { if (value < 0 && handed.values[index] === value) residuals[index] = 0; });
      }
    }
    // The sliver of the total no line carries, drawn so each bar reaches the figure reported.
    if (residuals.some((value) => value !== 0)) {
      series.push({ id: RESIDUAL_ID, label: measure === "operatingIncome" ? "Unallocated and reconciling items" : "Not allocated to a line", values: residuals.map((value) => (value !== 0 ? value : null)) });
    }
    return {
      labels: stacks.map((stack) => periodLabel(stack.end, periodicity)),
      ends: stacks.map((stack) => stack.end),
      totals: stacks.map((stack) => stack.total),
      series,
      reconciled: true,
    };
  }
  if (ends.length < 2) return null;
  return {
    labels: ends.map((end) => periodLabel(end, periodicity)),
    ends,
    totals: ends.map(() => null),
    series: lines.map((line) => ({ id: line.id, label: displayLabel(data.ticker, line.label), values: ends.map((end) => line[periodicity].find((point) => point.end === end)?.value ?? null) }))
      .filter((line) => line.values.some((value) => value != null)),
    reconciled: false,
  };
}

/** Every line of a cut at its latest period, with what goes with it. */
export function segmentRows(data: SegmentData, view: SegmentView, periodicity: SegmentPeriodicity): SegmentRow[] {
  const stacks = data.stacks.filter((stack) => stack.measure === "revenue" && stack.axis === view.axis && stack.parent === view.parent && stack.periodicity === periodicity);
  const lastStack = stacks.at(-1);
  const latestEnd = view.lines.map((line) => line[periodicity].at(-1)?.end ?? "").sort().at(-1) ?? "";
  const twin = (line: SegmentSeries, measure: "operatingIncome" | "backlog") =>
    data.series.find((other) => other.measure === measure && other.axis === line.axis && other.label === line.label && other.parentLabel === line.parentLabel);
  const rows = view.lines.map((line): SegmentRow => {
    const points = line[periodicity];
    const latest = points.at(-1) ?? null;
    const ttmPoints = trailingTwelve(line.quarterly);
    const ttm = ttmPoints.at(-1) ?? null;
    const income = twin(line, "operatingIncome")?.[periodicity].find((point) => point.end === latest?.end)?.value ?? null;
    const stacked = Boolean(lastStack?.ids.includes(line.id) && latest?.end === lastStack.end);
    return {
      id: line.id,
      label: displayLabel(data.ticker, line.label),
      stacked,
      latest,
      yoy: latest ? growth(latest.value, yearBefore(points, latest)?.value) : null,
      share: stacked && lastStack && lastStack.total > 0 && latest ? latest.value / lastStack.total : null,
      ttm: ttm && ttm.end === line.quarterly.at(-1)?.end ? ttm.value : null,
      ttmYoy: ttm ? growth(ttm.value, yearBefore(ttmPoints, ttm)?.value) : null,
      operatingIncome: income,
      margin: income != null && latest && latest.value > 0 ? income / latest.value : null,
      backlog: twin(line, "backlog")?.instant.at(-1) ?? null,
      stale: !latest || latest.end < latestEnd,
    };
  });
  return rows.sort((left, right) => Number(right.stacked) - Number(left.stacked) || Number(left.stale) - Number(right.stale) || (right.latest?.value ?? 0) - (left.latest?.value ?? 0));
}

export interface BacklogCard { id: string; label: string; latest: SegmentPoint; yearAgo: SegmentPoint | null; coverage: number | null }

/**
 * Backlog by segment (remaining performance obligations): what is contracted
 * and not yet recognised, against the segment's last twelve months of revenue.
 */
export function backlogCards(data: SegmentData): BacklogCard[] {
  const newest = data.series.filter((line) => line.measure === "backlog").map((line) => line.instant.at(-1)?.end ?? "").sort().at(-1) ?? "";
  return data.series.filter((line) => line.measure === "backlog" && line.instant.length).map((line) => {
    const latest = line.instant.at(-1)!;
    const revenue = data.series.find((other) => other.measure === "revenue" && other.axis === line.axis && other.label === line.label && other.parentLabel === line.parentLabel);
    const ttm = revenue ? trailingTwelve(revenue.quarterly).find((point) => point.end === latest.end) ?? null : null;
    return {
      id: line.id, label: line.axis === "total" ? "Whole company" : displayLabel(data.ticker, line.label), latest,
      yearAgo: yearBefore(line.instant, latest),
      coverage: ttm && ttm.value > 0 ? latest.value / ttm.value : null,
    };
  })
    // The company's own figure first, then its segments, largest first; a line no filing has stated for a year is history.
    .filter((card) => Date.parse(card.latest.end) >= Date.parse(newest) - 400 * DAY)
    .sort((left, right) => Number(right.id.includes(":total:")) - Number(left.id.includes(":total:")) || right.latest.value - left.latest.value);
}

export interface RevenueCut {
  id: string;
  title: string;
  /** The lines that add up to the period's revenue, largest first; "Not allocated to a line" where they fall just short. */
  lines: Array<{ id: string; label: string; value: number }>;
  total: number;
}

/**
 * The ways one period's revenue is cut that add up to it — by segment, by product, by region — for a flow that
 * starts from where the revenue came from. Only cuts the filing reconciles at that period's end, and none with a
 * negative line (an elimination cannot be drawn as money coming in).
 */
export function revenueCuts(data: SegmentData, end: string, periodicity: SegmentPeriodicity): RevenueCut[] {
  const cuts: RevenueCut[] = [];
  for (const view of segmentViews(data).filter((candidate) => !candidate.parent)) {
    const stack = data.stacks.find((candidate) => candidate.measure === "revenue" && candidate.axis === view.axis && candidate.parent == null
      && candidate.periodicity === periodicity && Math.abs(Date.parse(candidate.end) - Date.parse(end)) <= 7 * DAY);
    if (!stack || stack.residual < 0) continue;
    const lines = stack.ids.flatMap((id) => {
      const line = data.series.find((series) => series.id === id);
      const point = line?.[periodicity].find((candidate) => candidate.end === stack.end);
      return line && point ? [{ id, label: displayLabel(data.ticker, line.label), value: point.value }] : [];
    });
    if (stack.residual > 0) lines.push({ id: RESIDUAL_ID, label: "Not allocated to a line", value: stack.residual });
    if (lines.length < 2 || lines.some((line) => line.value < 0)) continue;
    cuts.push({ id: view.id, title: view.title, lines: lines.sort((left, right) => right.value - left.value), total: stack.total });
  }
  return cuts;
}
