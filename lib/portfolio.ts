import { cagrBetweenDates } from "./finance";
import type { WatchlistSummary } from "./watchlist-summary";

/**
 * A holding, as the reader entered it.
 *
 * Shares rather than a target weight, because shares are what a brokerage
 * statement says and a weight is what follows from them. Storing the weight
 * instead would freeze it: a position does not keep its weight while its price
 * moves, and a portfolio page that pretends otherwise is a spreadsheet of
 * intentions rather than a picture of what is held.
 */
export interface Position {
  ticker: string;
  shares: number;
  /**
   * What was paid, per share, on average.
   *
   * Optional because a book is still worth measuring before anyone has typed
   * in what it cost. Where it is absent the position has a value and a weight
   * but no profit and no loss, and the totals say how much of the book they
   * speak for rather than treating the gap as a cost of zero — which would
   * report the whole position as gain.
   */
  cost?: number;
}

export interface ValuedPosition {
  ticker: string;
  name: string;
  sector: string;
  shares: number;
  price: number | null;
  value: number | null;
  /** Share of the portfolio's priced value. Null while the price is unknown. */
  weight: number | null;
  /** Total paid for the position, where a cost per share was entered. */
  costBasis: number | null;
  /** Value less cost. Null without a cost, never zero. */
  profit: number | null;
  /** Profit over cost. */
  profitPercent: number | null;
  summary: WatchlistSummary | null;
}

export interface PortfolioValuation {
  positions: ValuedPosition[];
  /** Total of the positions that could be priced. */
  value: number;
  /** What the priced positions cost, where a cost was entered for them. */
  cost: number;
  /** Value less cost, over the positions that have both. */
  profit: number | null;
  profitPercent: number | null;
  /** Share of the book's value whose cost is known. */
  costCoverage: number;
  /** Positions with no price, which are excluded from every weight below. */
  unpriced: string[];
}

export function valuePortfolio(
  positions: Position[],
  summaries: Record<string, WatchlistSummary | undefined>,
  prices: Record<string, number | null | undefined>,
  names: Record<string, { name: string; sector: string } | undefined> = {},
): PortfolioValuation {
  const held = positions.filter((position) => Number.isFinite(position.shares) && position.shares > 0);
  const priced = held.map((position) => {
    const price = prices[position.ticker];
    const value = price != null && Number.isFinite(price) && price > 0 ? price * position.shares : null;
    return { position, price: price ?? null, value };
  });
  const total = priced.reduce((sum, item) => sum + (item.value ?? 0), 0);
  const valued = priced.map((item) => {
    const cost = item.position.cost != null && Number.isFinite(item.position.cost) && item.position.cost > 0
      ? item.position.cost * item.position.shares : null;
    const profit = cost != null && item.value != null ? item.value - cost : null;
    return {
      ticker: item.position.ticker,
      name: names[item.position.ticker]?.name ?? summaries[item.position.ticker]?.name ?? item.position.ticker,
      sector: names[item.position.ticker]?.sector ?? "Unclassified",
      shares: item.position.shares,
      price: item.price,
      value: item.value,
      weight: item.value != null && total > 0 ? item.value / total : null,
      costBasis: cost,
      profit,
      profitPercent: cost != null && cost > 0 && profit != null ? profit / cost : null,
      summary: summaries[item.position.ticker] ?? null,
    };
  });
  // Only positions with both a price and a cost enter the profit, and the share
  // of the book they represent travels with it.
  const withCost = valued.filter((position) => position.costBasis != null && position.value != null);
  const cost = withCost.reduce((sum, position) => sum + position.costBasis!, 0);
  const covered = withCost.reduce((sum, position) => sum + position.value!, 0);
  return {
    positions: valued,
    value: total,
    cost,
    profit: withCost.length ? covered - cost : null,
    profitPercent: withCost.length && cost > 0 ? covered / cost - 1 : null,
    costCoverage: total > 0 ? covered / total : 0,
    unpriced: priced.filter((item) => item.value == null).map((item) => item.position.ticker),
  };
}

export interface WeightedMetric {
  /** What the figure is worth across the portfolio. */
  value: number | null;
  /** The share of the portfolio the answer actually covers. */
  coverage: number;
  /** Holdings that do not report this measure and were left out. */
  missing: string[];
}

/**
 * A portfolio-level figure: each holding's number, weighted by what it is worth.
 *
 * A holding that does not report the measure is left out and the remaining
 * weights are renormalised over what is known — never counted as zero, which
 * would quietly drag every average towards it. How much of the portfolio the
 * answer covers travels with it, because a 90% return on capital across a
 * third of the book is a different statement from the same number across all
 * of it.
 */
export function weightedMetric(positions: ValuedPosition[], read: (position: ValuedPosition) => number | null | undefined): WeightedMetric {
  const usable = positions.filter((position) => {
    const value = read(position);
    return position.weight != null && position.weight > 0 && value != null && Number.isFinite(value);
  });
  const coverage = usable.reduce((sum, position) => sum + (position.weight ?? 0), 0);
  const missing = positions.filter((position) => !usable.includes(position)).map((position) => position.ticker);
  if (!usable.length || coverage <= 0) return { value: null, coverage: 0, missing };
  const value = usable.reduce((sum, position) => sum + (position.weight! / coverage) * read(position)!, 0);
  return { value, coverage, missing };
}

export interface PortfolioQualityContribution {
  ticker: string;
  /** Value weight renormalised over the holdings carrying a score. */
  scoredWeight: number;
  score: number;
  /** Points this holding adds to the portfolio's weighted score. */
  contribution: number;
}

export interface PortfolioQuality {
  value: number | null;
  /** Share of priced portfolio value carrying a Quality Score. */
  coverage: number;
  contributions: PortfolioQualityContribution[];
  missing: string[];
}

/**
 * A weighted Quality Score whose pieces add back to the number on screen.
 *
 * Missing companies are excluded and the known weights are renormalised, just
 * as a missing metric is inside the score itself. The coverage travels beside
 * the answer so 80 over half a portfolio never masquerades as 80 over all of
 * it.
 */
export function portfolioQuality(
  positions: ValuedPosition[],
  read: (position: ValuedPosition) => number | null | undefined,
): PortfolioQuality {
  const readings = positions.map((position) => ({ position, score: read(position) }));
  const usable = readings.filter((entry): entry is { position: ValuedPosition & { weight: number }; score: number } =>
    entry.position.weight != null && entry.position.weight > 0
    && entry.score != null && Number.isFinite(entry.score));
  const coverage = usable.reduce((sum, entry) => sum + entry.position.weight, 0);
  const missing = readings
    .filter((entry) => entry.position.weight != null && (entry.score == null || !Number.isFinite(entry.score)))
    .map((entry) => entry.position.ticker);
  if (!usable.length || coverage <= 0) return { value: null, coverage: 0, contributions: [], missing };
  const contributions = usable.map(({ position, score }) => {
    const scoredWeight = position.weight / coverage;
    return { ticker: position.ticker, scoredWeight, score, contribution: scoredWeight * score };
  });
  return {
    value: contributions.reduce((sum, entry) => sum + entry.contribution, 0),
    coverage,
    contributions,
    missing,
  };
}

/** Share of priced value for which a stated condition is true. */
export function portfolioExposure(positions: ValuedPosition[], exposed: (position: ValuedPosition) => boolean): number {
  return positions.reduce((sum, position) => sum + (position.weight != null && exposed(position) ? position.weight : 0), 0);
}

/** Weight grouped by a property of the holding, largest first. */
export function weightBy(positions: ValuedPosition[], key: (position: ValuedPosition) => string) {
  const groups = new Map<string, number>();
  for (const position of positions) {
    if (position.weight == null) continue;
    groups.set(key(position), (groups.get(key(position)) ?? 0) + position.weight);
  }
  return [...groups.entries()].map(([label, weight]) => ({ label, weight })).sort((a, b) => b.weight - a.weight);
}

/**
 * How concentrated the book is, on the Herfindahl index of its weights.
 *
 * The reciprocal is the more readable form: an index of 0.2 is five equally
 * sized positions, whatever the number of names actually held. A portfolio of
 * twenty holdings where one is half the money has an effective count near two,
 * and saying "twenty holdings" would be true and misleading.
 */
export function concentration(positions: ValuedPosition[]) {
  const weights = positions.map((position) => position.weight).filter((weight): weight is number => weight != null && weight > 0);
  if (!weights.length) return { herfindahl: null, effectiveHoldings: null, largest: null };
  const herfindahl = weights.reduce((sum, weight) => sum + weight * weight, 0);
  return { herfindahl, effectiveHoldings: herfindahl > 0 ? 1 / herfindahl : null, largest: Math.max(...weights) };
}

export interface SeriesPoint { date: string; value: number }

/**
 * The portfolio's value through time, from each holding's own price history.
 *
 * Only dates every holding traded on are used. Carrying a stale price for a
 * missing session would draw a portfolio that moved when part of it had not,
 * and a portfolio line is only worth having if every constituent is in it.
 */
export function portfolioSeries(positions: Position[], histories: Record<string, SeriesPoint[] | undefined>): SeriesPoint[] {
  const held = positions.filter((position) => position.shares > 0 && histories[position.ticker]?.length);
  if (!held.length) return [];
  const maps = held.map((position) => ({
    shares: position.shares,
    prices: new Map(histories[position.ticker]!.map((point) => [point.date, point.value])),
  }));
  const dates = maps.reduce<string[]>((common, item, index) =>
    index === 0 ? [...item.prices.keys()] : common.filter((date) => item.prices.has(date)), []);
  return dates.sort().map((date) => ({
    date,
    value: maps.reduce((sum, item) => sum + item.shares * item.prices.get(date)!, 0),
  }));
}

/**
 * Two series rebased to 100 at their first common date.
 *
 * Comparing a portfolio against an index means comparing their shapes, not
 * their sizes: one is a sum of money and the other is a level. Rebasing both
 * from the first date they share is the only comparison that is not an
 * accident of how much happens to be invested.
 */
export function rebasePair(portfolio: SeriesPoint[], benchmark: SeriesPoint[]) {
  const index = new Map(benchmark.map((point) => [point.date, point.value]));
  const common = portfolio.filter((point) => index.has(point.date));
  const first = common[0];
  if (!first || first.value <= 0) return [];
  const base = index.get(first.date)!;
  if (!(base > 0)) return [];
  return common.map((point) => ({
    date: point.date,
    portfolio: (point.value / first.value) * 100,
    benchmark: (index.get(point.date)! / base) * 100,
  }));
}

/**
 * The windows a portfolio's own history is read over, in the order offered.
 *
 * A month and the year to date are the two a reader checks between quarters,
 * and neither is a number of years: one is a month back from the last close,
 * the other is the first of January whatever month it happens to be.
 */
export const WINDOWS = ["1M", "YTD", "1Y", "3Y", "5Y", "10Y", "Max"] as const;
export type WindowId = typeof WINDOWS[number];

/**
 * The windows that want a session a day rather than a session a week.
 *
 * A month of weekly closes is four points, which is a shape nobody can read;
 * ten years of daily ones is twenty times the payload to draw the same line at
 * the same width. Each window asks for the granularity it can actually show,
 * the same rule the company price chart follows.
 */
export const DAILY_WINDOWS: ReadonlySet<WindowId> = new Set<WindowId>(["1M", "YTD"]);

/** The tail of a series covering one window, measured from its own last date. */
export function overWindow(series: SeriesPoint[], id: WindowId): SeriesPoint[] {
  const end = series.at(-1)?.date;
  if (!end || id === "Max") return series;
  if (id === "YTD") return series.filter((point) => point.date >= `${end.slice(0, 4)}-01-01`);
  if (id === "1M") {
    const from = new Date(`${end}T00:00:00Z`);
    if (Number.isNaN(from.getTime())) return series;
    from.setUTCMonth(from.getUTCMonth() - 1);
    const cutoff = from.toISOString().slice(0, 10);
    return series.filter((point) => point.date >= cutoff);
  }
  return withinWindow(series, Number(id.slice(0, -1)));
}

/** The tail of a series covering the last `years`, by date rather than by count. */
export function withinWindow(series: SeriesPoint[], years: number): SeriesPoint[] {
  const end = series.at(-1)?.date;
  if (!end || !Number.isFinite(years) || years <= 0) return series;
  const cutoff = new Date(`${end}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  if (Number.isNaN(cutoff.getTime())) return series;
  const from = cutoff.toISOString().slice(0, 10);
  return series.filter((point) => point.date >= from);
}

export interface SeriesStats {
  start: SeriesPoint | null;
  end: SeriesPoint | null;
  /** Total return across the window. */
  change: number | null;
  /** Compounded annually, on the same function every growth figure here uses. */
  cagr: number | null;
  /** The deepest peak-to-trough fall inside the window. */
  drawdown: number | null;
  /** When that fall bottomed. */
  drawdownDate: string | null;
  /** The best and worst single steps, which say how bumpy the ride was. */
  bestStep: number | null;
  worstStep: number | null;
  years: number | null;
}

/**
 * What a value series did across the window it is drawn over.
 *
 * The drawdown is measured against the running peak rather than the starting
 * value: a book that doubled and then halved has lost nothing against where it
 * began and half of everything against where it got to, and the second is the
 * number that describes what holding it felt like.
 */
export function seriesStats(series: SeriesPoint[]): SeriesStats {
  const start = series[0] ?? null;
  const end = series.at(-1) ?? null;
  const empty: SeriesStats = { start, end, change: null, cagr: null, drawdown: null, drawdownDate: null, bestStep: null, worstStep: null, years: null };
  if (!start || !end || series.length < 2 || start.value <= 0) return empty;

  let peak = start.value; let drawdown = 0; let drawdownDate: string | null = null;
  let bestStep: number | null = null; let worstStep: number | null = null;
  for (let index = 0; index < series.length; index++) {
    const point = series[index];
    if (point.value > peak) peak = point.value;
    if (peak > 0) {
      const fall = point.value / peak - 1;
      if (fall < drawdown) { drawdown = fall; drawdownDate = point.date; }
    }
    if (index > 0) {
      const previous = series[index - 1].value;
      if (previous > 0) {
        const step = point.value / previous - 1;
        bestStep = bestStep == null ? step : Math.max(bestStep, step);
        worstStep = worstStep == null ? step : Math.min(worstStep, step);
      }
    }
  }
  const compounded = cagrBetweenDates(start.value, end.value, start.date, end.date);
  return {
    start, end,
    change: end.value / start.value - 1,
    cagr: compounded.value,
    drawdown: drawdownDate ? drawdown : null,
    drawdownDate,
    bestStep, worstStep,
    years: compounded.years,
  };
}

/**
 * The book's market value on every date it can honestly be priced.
 *
 * Unlike `portfolioSeries`, which multiplies today's share counts across all of
 * history, this asks what was actually held on each date. The difference is not
 * cosmetic: with fixed shares, a position opened this morning is drawn as
 * though it had been held for ten years, and the line shows a decade of gains
 * the reader never made. A book whose holdings change is the normal case, and
 * this is the only series that describes one.
 *
 * A date where a held company has no price is skipped rather than carried
 * forward. Holding the last known price would draw the portfolio moving on a
 * day part of it did not trade, which is the same reasoning `portfolioSeries`
 * applies — only now the set of holdings is itself a function of the date.
 */
export function holdingsSeries(
  shareTimeline: Record<string, Array<{ date: string; shares: number }>>,
  histories: Record<string, SeriesPoint[] | undefined>,
  from: string | null,
): SeriesPoint[] {
  const tickers = Object.keys(shareTimeline);
  if (!tickers.length) return [];

  const priceMaps = new Map(tickers.map((ticker) => [ticker, new Map((histories[ticker] ?? []).map((point) => [point.date, point.value]))]));
  // Every date any holding has a price for, from the first trade onwards.
  const dates = [...new Set(tickers.flatMap((ticker) => (histories[ticker] ?? []).map((point) => point.date)))]
    .filter((date) => !from || date >= from)
    .sort();

  const series: SeriesPoint[] = [];
  for (const date of dates) {
    let value = 0;
    let complete = true;
    for (const ticker of tickers) {
      const shares = sharesAsOf(shareTimeline[ticker], date);
      if (shares <= 0) continue;
      const price = priceMaps.get(ticker)?.get(date);
      if (price == null) { complete = false; break; }
      value += shares * price;
    }
    if (complete) series.push({ date, value });
  }
  return series;
}

/** The share count on a date, from a timeline sorted ascending. */
export function sharesAsOf(timeline: Array<{ date: string; shares: number }> | undefined, date: string): number {
  if (!timeline?.length) return 0;
  let shares = 0;
  for (const entry of timeline) {
    if (entry.date > date) break;
    shares = entry.shares;
  }
  return shares;
}

/**
 * The book's return with deposits and withdrawals taken out of it.
 *
 * A portfolio that grows from ten thousand to twenty because another nine
 * thousand was paid in has returned ten percent, not a hundred, and its raw
 * value line says the opposite. Chaining daily returns — each measured after
 * removing that day's external flow — gives the figure that describes the
 * decisions rather than the deposits, which is also the only figure that can be
 * honestly drawn against an index.
 *
 * Rebased to 100 at the start so it sits on the same axis as a rebased index.
 */
export function timeWeightedSeries(values: SeriesPoint[], flows: Map<string, number>): SeriesPoint[] {
  if (values.length < 2) return values.length ? [{ date: values[0].date, value: 100 }] : [];
  const dated = [...flows.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const series: SeriesPoint[] = [{ date: values[0].date, value: 100 }];
  let index = 100;
  for (let step = 1; step < values.length; step++) {
    const from = values[step - 1].date, to = values[step].date;
    // Every flow that happened *between* two observations, not merely on the
    // day of one. A weekly series lands on week boundaries and a trade lands on
    // a Tuesday, so matching dates exactly found nothing and counted a purchase
    // as a gain — one seeded book showed a 93% week for buying more stock.
    const flow = dated.reduce((sum, [date, amount]) => date > from && date <= to ? sum + amount : sum, 0);
    const previous = values[step - 1].value;
    if (previous > 0) {
      const growth = (values[step].value - flow) / previous;
      if (Number.isFinite(growth) && growth > 0) index *= growth;
    }
    series.push({ date: to, value: index });
  }
  return series;
}
