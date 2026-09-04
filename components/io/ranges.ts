/**
 * One period control for the whole page.
 *
 * The price chart and the metric charts used to keep separate ranges, so
 * choosing MAX at the top left the figures underneath on their own five-year
 * window — two answers to the same question on one screen. There is now a
 * single range, and each half of the page reads what it means for the series
 * it draws.
 */

export type Range = "1M" | "6M" | "1Y" | "3Y" | "5Y" | "10Y" | "MAX";

/** Which filed series a chart is drawn from. */
export type Frequency = "ttm" | "annual";

/** What a price chart offers: a month is a real window for a traded price. */
export const RANGES: Range[] = ["1M", "6M", "1Y", "5Y", "MAX"];

/**
 * What a comparison offers, which is not the same list.
 *
 * Nothing below a year belongs here: a company reports four times a year, so a
 * month of filed figures is one observation and six months is two, and a
 * comparison drawn across two points is a straight line between two companies'
 * last quarters. The decade is added at the other end, because the question a
 * comparison asks — which of these compounded, and how steadily — is a question
 * about a long time.
 */
export const COMPARE_RANGES: Range[] = ["1Y", "3Y", "5Y", "10Y", "MAX"];

/**
 * What a chart of one filed measure offers, which is the same list.
 *
 * The reasoning is the reasoning above: a month of filed figures is one
 * observation. Only a traded price has anything to say below a year, so only
 * the price chart keeps the short windows.
 */
export const METRIC_RANGES: Range[] = COMPARE_RANGES;

/**
 * A price window read as a fundamental one.
 *
 * The page holds a single range across both halves, so a reader on the price
 * chart at one month who then picks a measure is asking for a month of filed
 * figures. There is no such thing; the year is what they get, and the caption
 * says so rather than the chart pretending.
 */
export function metricRange(range: Range): Range {
  return range === "1M" || range === "6M" ? "1Y" : range;
}

const PRICE: Record<Range, { frequency: "daily" | "weekly" | "monthly"; days: number | null }> = {
  "1M": { frequency: "daily", days: 35 },
  "6M": { frequency: "daily", days: 190 },
  "1Y": { frequency: "daily", days: 370 },
  "3Y": { frequency: "weekly", days: 1100 },
  "5Y": { frequency: "weekly", days: 1830 },
  "10Y": { frequency: "monthly", days: 3660 },
  MAX: { frequency: "monthly", days: null },
};

/**
 * How the market endpoint is asked for this range.
 *
 * Each window asks for the granularity it can actually show: a month of
 * sessions is drawn daily, twenty years is drawn monthly. Asking for daily bars
 * across twenty years would be twenty times the payload to draw the same line
 * at the same width — and every one of these windows is a cache key the market
 * endpoint already keeps warm.
 */
export function priceWindow(range: Range) {
  const found = PRICE[range] ?? PRICE["1Y"];
  const end = new Date();
  const start = found.days == null ? new Date("1985-01-01") : new Date(end.getTime() - found.days * 86_400_000);
  return { frequency: found.frequency, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Which filed series answers this range, and how far back it runs.
 *
 * MAX flips to the annual series, and that is the whole point of this table. A
 * company files four trailing-twelve-month observations a year and this
 * application keeps twenty-four of them, so "MAX" drawn from TTM is six years —
 * a reader asking for everything was being shown a quarter of it. The annual
 * series goes back twenty years, which is further than most filers' XBRL.
 *
 * Below a year there is nothing finer to show: a quarter is the shortest period
 * a company reports, so a month and six months are drawn over the same year of
 * trailing figures the 1Y window shows. The caption says which span is on
 * screen, so this never silently disagrees with the control above it.
 */
const FUNDAMENTAL: Record<Range, { frequency: Frequency; years: number | null }> = {
  "1M": { frequency: "ttm", years: 1 },
  "6M": { frequency: "ttm", years: 1 },
  "1Y": { frequency: "ttm", years: 1 },
  "3Y": { frequency: "ttm", years: 3 },
  "5Y": { frequency: "ttm", years: 5 },
  "10Y": { frequency: "ttm", years: 10 },
  MAX: { frequency: "annual", years: null },
};

export function fundamentalWindow(range: Range) {
  return FUNDAMENTAL[range] ?? FUNDAMENTAL["1Y"];
}

/**
 * Whether the reader is offered the choice between the two series.
 *
 * Only where there is a choice to make. Over a year the annual series holds one
 * observation and over six months it holds none, so a switch there offers a
 * chart with nothing in it — and a control that can only make the screen worse
 * is not a control, it is a trap.
 */
export function offersFrequency(range: Range): boolean {
  return !(["1M", "6M", "1Y"] as Range[]).includes(range);
}

/**
 * The last `years` of a series, measured from its own final period.
 *
 * The boundary is loosened by three weeks, and it has to be. A fiscal year does
 * not end on the same date every year — Apple's ended on 26 September in 2020
 * and on 27 September in 2025 — so a cutoff struck exactly five years back
 * excluded the year five years back by one day. "Five-year growth" was then
 * compounded over four intervals and read three points too low: 3.3% a year for
 * a company that grew at 8.7%.
 *
 * Three weeks is wider than any fiscal calendar drifts and far narrower than
 * the gap to the next observation, so it can only ever recover the period the
 * window was named for.
 */
const CALENDAR_SLACK_DAYS = 21;

export function withinYears<T extends { end: string }>(periods: T[], years: number | null): T[] {
  if (years == null || periods.length === 0) return periods;
  const cutoff = new Date(`${periods[periods.length - 1].end}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  cutoff.setUTCDate(cutoff.getUTCDate() - CALENDAR_SLACK_DAYS);
  const threshold = cutoff.toISOString().slice(0, 10);
  return periods.filter((period) => period.end >= threshold);
}

/**
 * How a measure is drawn.
 *
 * A level is a row of bars: revenue in a year is a quantity that happened, and
 * a bar says so by standing on zero. A rate is an area: a margin does not
 * accumulate, it is where the business sat at each moment, and a filled line
 * reads as a band the company moved through. That is the only rule, and the
 * unit decides it — no chart on this site is drawn a particular way by hand.
 */
export function shapeFor(unit: string): "area" | "bars" {
  return unit === "percent" || unit === "ratio" ? "area" : "bars";
}
