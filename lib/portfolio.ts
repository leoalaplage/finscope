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

/** The windows a portfolio's own history is read over. */
export const WINDOWS = [
  { id: "1Y", years: 1 }, { id: "3Y", years: 3 }, { id: "5Y", years: 5 },
  { id: "10Y", years: 10 }, { id: "Max", years: Infinity },
] as const;
export type WindowId = typeof WINDOWS[number]["id"];

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
