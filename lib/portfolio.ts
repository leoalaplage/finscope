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
export interface Position { ticker: string; shares: number }

export interface ValuedPosition {
  ticker: string;
  name: string;
  sector: string;
  shares: number;
  price: number | null;
  value: number | null;
  /** Share of the portfolio's priced value. Null while the price is unknown. */
  weight: number | null;
  summary: WatchlistSummary | null;
}

export interface PortfolioValuation {
  positions: ValuedPosition[];
  /** Total of the positions that could be priced. */
  value: number;
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
  return {
    positions: priced.map((item) => ({
      ticker: item.position.ticker,
      name: names[item.position.ticker]?.name ?? summaries[item.position.ticker]?.name ?? item.position.ticker,
      sector: names[item.position.ticker]?.sector ?? "Unclassified",
      shares: item.position.shares,
      price: item.price,
      value: item.value,
      weight: item.value != null && total > 0 ? item.value / total : null,
      summary: summaries[item.position.ticker] ?? null,
    })),
    value: total,
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
