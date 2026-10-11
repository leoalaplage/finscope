import { withheldMeasures, type IoCompanyView, type IoPeriod } from "@/lib/io/view";

/**
 * GF: ready-made fundamental charts, one company at a time.
 *
 * Each preset is a question an analyst asks of every company — is the cash
 * keeping up with the debt, is capital spending eating the free cash flow,
 * what does the backlog cover — drawn as bars and lines on one or two axes.
 * Every figure is a filed one, read from the same company view as the rest
 * of the screen; the only thing computed here is arithmetic on two filed
 * figures (net cash, a ratio, a year-on-year change), and each preset says
 * which.
 *
 * Pure: the component draws, this decides what is drawn.
 */

export type Frequency = "quarterly" | "annual" | "ttm";
export type AxisUnit = "currency" | "percent" | "ratio" | "shares" | "perShare";

export interface PresetContext {
  frequency: Frequency;
  /** The trailing-twelve-month period ending on a date, if there is one. */
  trailingAt: (end: string) => IoPeriod | undefined;
  /** The period of the same frequency a year earlier. */
  yearAgo: (period: IoPeriod) => IoPeriod | undefined;
  /** Remaining performance obligations by balance-sheet date. */
  backlog: Map<string, number>;
}

export interface SeriesSpec {
  id: string;
  label: string;
  kind: "bar" | "line";
  axis: "left" | "right";
  /** A CSS colour, normally one of the terminal's palette variables. */
  color: string;
  value: (period: IoPeriod, context: PresetContext) => number | null;
}

export interface Preset {
  id: string;
  title: string;
  left: AxisUnit;
  right?: AxisUnit;
  series: SeriesSpec[];
  /** What the chart computes, or where a figure comes from, in a line. */
  note?: string;
  /** Tint the band below zero, where a line crossing it is the story. */
  shadeNegative?: boolean;
  needsBacklog?: boolean;
  /**
   * A measure whose boundary this chart rests on. Where the site withholds it
   * from a filer — a bank's operating cash flow is the movement of its loans,
   * its borrowings are its raw material — the chart is not offered either.
   */
  withheldWith?: string;
}

const BLUE = "var(--c1)";
const TEAL = "var(--c2)";
const VIOLET = "var(--c3)";
const PINK = "var(--c4)";
const YELLOW = "var(--c5)";
const SKY = "var(--c6)";
const GREEN = "var(--gain)";
const RED = "var(--loss)";

const at = (period: IoPeriod | undefined, key: string): number | null => {
  const value = period?.values[key];
  return value == null || !Number.isFinite(value) ? null : value;
};
const abs = (value: number | null) => (value == null ? null : Math.abs(value));
const over = (top: number | null, bottom: number | null) => (top == null || bottom == null || bottom === 0 ? null : top / bottom);
/** A return measured over a quarter is not comparable with a year's; a quarterly chart reads the trailing year. */
const yearly = (period: IoPeriod, context: PresetContext) => (context.frequency === "quarterly" ? context.trailingAt(period.end) : period);
const liquid = (period: IoPeriod) => {
  const cash = at(period, "cashAndEquivalents");
  return cash == null ? null : cash + (at(period, "shortTermInvestments") ?? 0);
};

export const PRESETS: Preset[] = [
  {
    id: "revenue", title: "Revenue & growth", left: "currency", right: "percent",
    note: "Growth is against the same period a year earlier.",
    series: [
      { id: "revenue", label: "Revenue", kind: "bar", axis: "left", color: BLUE, value: (p) => at(p, "revenue") },
      {
        id: "growth", label: "YoY growth", kind: "line", axis: "right", color: YELLOW,
        value: (p, c) => { const before = at(c.yearAgo(p), "revenue"); const now = at(p, "revenue"); return now == null || before == null || before <= 0 ? null : now / before - 1; },
      },
    ],
  },
  {
    id: "margins", title: "Margins", left: "percent",
    series: [
      { id: "gross", label: "Gross margin", kind: "line", axis: "left", color: TEAL, value: (p) => at(p, "grossMargin") },
      { id: "operating", label: "Operating margin", kind: "line", axis: "left", color: BLUE, value: (p) => at(p, "operatingMargin") },
      { id: "net", label: "Net margin", kind: "line", axis: "left", color: VIOLET, value: (p) => at(p, "netMargin") },
      { id: "fcf", label: "FCF margin", kind: "line", axis: "left", color: YELLOW, value: (p) => at(p, "freeCashFlowMargin") },
    ],
  },
  {
    id: "earnings", title: "Operating income vs net income vs EBITDA", left: "currency",
    series: [
      { id: "operating", label: "Operating income", kind: "bar", axis: "left", color: BLUE, value: (p) => at(p, "operatingIncome") },
      { id: "net", label: "Net income", kind: "bar", axis: "left", color: VIOLET, value: (p) => at(p, "netIncome") },
      { id: "ebitda", label: "EBITDA", kind: "line", axis: "left", color: YELLOW, value: (p) => at(p, "ebitda") },
    ],
  },
  {
    id: "cash-flow", title: "Operating cash flow, capex & free cash flow", left: "currency", shadeNegative: true, withheldWith: "freeCashFlow",
    series: [
      { id: "capex", label: "Capex", kind: "bar", axis: "left", color: RED, value: (p) => abs(at(p, "capitalExpenditures")) },
      { id: "ocf", label: "Operating cash flow", kind: "line", axis: "left", color: BLUE, value: (p) => at(p, "operatingCashFlow") },
      { id: "fcf", label: "Free cash flow", kind: "line", axis: "left", color: YELLOW, value: (p) => at(p, "freeCashFlow") },
    ],
  },
  {
    id: "cash-debt", title: "Cash vs debt", left: "currency", shadeNegative: true, withheldWith: "netDebt",
    note: "Cash includes short-term investments. Net cash = cash − total debt.",
    series: [
      { id: "cash", label: "Cash & ST investments", kind: "bar", axis: "left", color: GREEN, value: (p) => liquid(p) },
      { id: "debt", label: "Total debt", kind: "bar", axis: "left", color: RED, value: (p) => at(p, "totalDebt") },
      {
        id: "net", label: "Net cash", kind: "line", axis: "left", color: YELLOW,
        value: (p) => { const cash = liquid(p); const debt = at(p, "totalDebt"); return cash == null || debt == null ? null : cash - debt; },
      },
    ],
  },
  {
    id: "backlog", title: "Backlog & coverage", left: "currency", right: "ratio", needsBacklog: true,
    note: "Backlog = remaining performance obligations as filed. Coverage = backlog ÷ trailing-twelve-month revenue (whole company).",
    series: [
      { id: "backlog", label: "Backlog", kind: "bar", axis: "left", color: GREEN, value: (p, c) => c.backlog.get(p.end) ?? null },
      {
        id: "coverage", label: "Backlog ÷ TTM revenue", kind: "line", axis: "right", color: YELLOW,
        value: (p, c) => over(c.backlog.get(p.end) ?? null, at(c.frequency === "annual" ? p : c.trailingAt(p.end), "revenue")),
      },
    ],
  },
  {
    id: "shareholder", title: "Shareholder returns", left: "currency",
    series: [
      { id: "buybacks", label: "Buybacks", kind: "bar", axis: "left", color: TEAL, value: (p) => abs(at(p, "shareRepurchases")) },
      { id: "dividends", label: "Dividends", kind: "bar", axis: "left", color: VIOLET, value: (p) => abs(at(p, "dividendsPaid")) },
      { id: "fcf", label: "Free cash flow", kind: "line", axis: "left", color: YELLOW, value: (p) => at(p, "freeCashFlow") },
    ],
  },
  {
    id: "dilution", title: "Stock-based pay & share count", left: "currency", right: "shares",
    series: [
      { id: "sbc", label: "Stock-based compensation", kind: "bar", axis: "left", color: PINK, value: (p) => abs(at(p, "stockBasedCompensation")) },
      // The balance-sheet count rather than the diluted average: it is read
      // as filed at each date, where a fourth quarter's average is derived.
      { id: "shares", label: "Shares outstanding", kind: "line", axis: "right", color: YELLOW, value: (p) => at(p, "sharesOutstanding") ?? at(p, "dilutedShares") },
    ],
  },
  {
    id: "spending", title: "R&D and SG&A", left: "currency", right: "percent",
    series: [
      { id: "rnd", label: "R&D", kind: "bar", axis: "left", color: VIOLET, value: (p) => at(p, "researchAndDevelopment") },
      { id: "sga", label: "SG&A", kind: "bar", axis: "left", color: SKY, value: (p) => at(p, "sellingGeneralAndAdministrative") },
      { id: "rnd-share", label: "R&D ÷ revenue", kind: "line", axis: "right", color: YELLOW, value: (p) => over(at(p, "researchAndDevelopment"), at(p, "revenue")) },
    ],
  },
  {
    id: "capex", title: "Capex vs depreciation", left: "currency", right: "percent", withheldWith: "capitalIntensity",
    note: "Capex above depreciation means the asset base is growing.",
    series: [
      { id: "capex", label: "Capex", kind: "bar", axis: "left", color: RED, value: (p) => abs(at(p, "capitalExpenditures")) },
      { id: "da", label: "D&A", kind: "bar", axis: "left", color: SKY, value: (p) => abs(at(p, "depreciationAndAmortization")) },
      { id: "intensity", label: "Capex ÷ revenue", kind: "line", axis: "right", color: YELLOW, value: (p) => over(abs(at(p, "capitalExpenditures")), at(p, "revenue")) },
    ],
  },
  {
    id: "returns", title: "Returns on capital", left: "percent",
    note: "Trailing twelve months at every point, so a quarter is not read as a year.",
    series: [
      { id: "roic", label: "ROIC", kind: "line", axis: "left", color: YELLOW, value: (p, c) => at(yearly(p, c), "roic") },
      { id: "roe", label: "ROE", kind: "line", axis: "left", color: BLUE, value: (p, c) => at(yearly(p, c), "returnOnEquity") },
      { id: "roa", label: "ROA", kind: "line", axis: "left", color: TEAL, value: (p, c) => at(yearly(p, c), "returnOnAssets") },
    ],
  },
  {
    id: "per-share", title: "EPS & dividends per share", left: "perShare",
    series: [
      { id: "eps", label: "Diluted EPS", kind: "bar", axis: "left", color: GREEN, value: (p) => at(p, "netIncomePerShare") },
      { id: "fcfps", label: "FCF per share", kind: "line", axis: "left", color: BLUE, value: (p) => at(p, "freeCashFlowPerShare") },
      { id: "dps", label: "Dividend per share", kind: "line", axis: "left", color: YELLOW, value: (p) => at(p, "dividendsPerShare") },
    ],
  },
  {
    id: "balance", title: "Assets, liabilities & equity", left: "currency",
    series: [
      { id: "assets", label: "Total assets", kind: "bar", axis: "left", color: BLUE, value: (p) => at(p, "totalAssets") },
      { id: "liabilities", label: "Total liabilities", kind: "bar", axis: "left", color: RED, value: (p) => at(p, "totalLiabilities") },
      { id: "equity", label: "Equity", kind: "line", axis: "left", color: GREEN, value: (p) => at(p, "totalEquity") },
    ],
  },
];

export const RANGES = [
  { id: "5Y", years: 5 },
  { id: "10Y", years: 10 },
  { id: "MAX", years: null },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** How many points a range holds at a frequency. */
export function pointsIn(range: RangeId, frequency: Frequency): number {
  const years = RANGES.find((entry) => entry.id === range)?.years ?? null;
  if (years == null) return Number.POSITIVE_INFINITY;
  return frequency === "annual" ? years : years * 4;
}

/** "Q3'21" for a quarter or a trailing year, "FY21" for a year. */
export function shortLabel(period: IoPeriod, frequency: Frequency): string {
  const year = String(period.fiscalYear).slice(-2);
  if (frequency === "annual" || !period.fiscalQuarter) return `FY${year}`;
  return `${period.fiscalQuarter}'${year}`;
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

export function periodsOf(view: IoCompanyView, frequency: Frequency): IoPeriod[] {
  return frequency === "annual" ? view.annual : frequency === "quarterly" ? view.quarterly : view.trailing;
}

export function contextFor(view: IoCompanyView, frequency: Frequency, backlog: Map<string, number>): PresetContext {
  const trailing = new Map(view.trailing.map((period) => [period.end, period]));
  const all = periodsOf(view, frequency);
  return {
    frequency,
    backlog,
    trailingAt: (end) => trailing.get(end),
    yearAgo: (period) => {
      // The nearest period ending between eleven and thirteen months before:
      // a 52/53-week calendar does not land on the same date every year.
      let best: IoPeriod | undefined;
      for (const candidate of all) {
        const gap = daysBetween(candidate.end, period.end);
        if (gap < 335 || gap > 395) continue;
        if (!best || Math.abs(gap - 365) < Math.abs(daysBetween(best.end, period.end) - 365)) best = candidate;
      }
      return best;
    },
  };
}

export interface ChartSeries { spec: SeriesSpec; values: Array<number | null> }
export interface ChartData { labels: string[]; names: string[]; series: ChartSeries[] }

/**
 * A preset's figures over a window, or null when there is too little to draw.
 *
 * A series the company has no figure for at all (dividends at a company that
 * pays none) is left out rather than drawn as a flat absence, and periods
 * before the first figure of any series are trimmed so a chart does not open
 * on an empty stretch.
 */
export function buildPreset(preset: Preset, view: IoCompanyView, frequency: Frequency, range: RangeId, backlog: Map<string, number>): ChartData | null {
  if (preset.withheldWith && withheldMeasures(view.company.businessType).has(preset.withheldWith)) return null;
  const context = contextFor(view, frequency, backlog);
  const periods = periodsOf(view, frequency);
  const limit = pointsIn(range, frequency);
  const window = Number.isFinite(limit) ? periods.slice(-limit) : periods;
  const series = preset.series
    .map((spec) => ({ spec, values: window.map((period) => spec.value(period, context)) }))
    .filter((entry) => entry.values.some((value) => value != null));
  if (!series.length) return null;
  const first = Math.min(...series.map((entry) => entry.values.findIndex((value) => value != null)));
  const trimmed = series.map((entry) => ({ ...entry, values: entry.values.slice(first) }));
  const points = trimmed.reduce((sum, entry) => sum + entry.values.filter((value) => value != null).length, 0);
  // The lead series — the bars the preset is named for — must be there.
  if (preset.needsBacklog && !trimmed.some((entry) => entry.spec.id === "backlog")) return null;
  if (points < 2 || window.length - first < 2) return null;
  return {
    labels: window.slice(first).map((period) => shortLabel(period, frequency)),
    names: window.slice(first).map((period) => period.label),
    series: trimmed,
  };
}

export interface Axis { min: number; max: number; ticks: number[] }

/** A step of 1, 2, 2.5 or 5 times a power of ten that cuts a span into about `count` parts. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0)) return 1;
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * A value axis on round numbers. Bars stand on zero, so an axis carrying bars
 * always includes it; an axis of lines alone is free to crop to its band.
 */
export function axisFor(values: Array<number | null>, includeZero: boolean, count = 4): Axis | null {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!known.length) return null;
  let low = Math.min(...known);
  let high = Math.max(...known);
  if (includeZero) { low = Math.min(low, 0); high = Math.max(high, 0); }
  if (low === high) { const pad = Math.abs(low) * 0.1 || 1; low -= pad; high += pad; }
  const step = niceStep(high - low, count);
  const min = Math.floor(low / step + 1e-9) * step;
  const max = Math.ceil(high / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Math.abs(tick) < step / 1e6 ? 0 : Number(tick.toPrecision(12)));
  return { min, max, ticks };
}
