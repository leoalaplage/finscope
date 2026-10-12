/**
 * Analysts' estimates: the consensus, how it is moving, and what it implies.
 *
 * The only figures on this site that are forecasts rather than filings, and
 * every screen that shows one says so. They come from Zacks, as Nasdaq
 * publishes them (lib/adapters/nasdaq-estimates.ts): earnings per share for
 * the next five fiscal quarters and the next fiscal years, with the high and
 * low estimate, the number of analysts and the revisions of the last four
 * weeks; the consensus a week and a month ago; the price target and the
 * analysts' recommendations.
 *
 * Nobody publishes the history of a consensus for free beyond a month, so the
 * site keeps its own: one snapshot a day per company (`snapshotOf`), from
 * which the revision charts are drawn.
 *
 * Pure: the adapter fetches, the endpoint stores, this computes.
 */

export interface EpsEstimate {
  /** The fiscal period's end month, as Nasdaq writes it: "Sep 2026". */
  fiscalEnd: string;
  consensus: number | null;
  high: number | null;
  low: number | null;
  analysts: number | null;
  /** Revisions over the last four weeks. */
  up: number | null;
  down: number | null;
}

export interface Estimates {
  ticker: string;
  asOf: string;
  quarterly: EpsEstimate[];
  yearly: EpsEstimate[];
  /** The consensus for the next quarter and the current fiscal year, now, a week ago and a month ago. */
  momentum: {
    quarter: { label: string | null; now: number | null; weekAgo: number | null; monthAgo: number | null };
    year: { label: string | null; now: number | null; weekAgo: number | null; monthAgo: number | null };
  } | null;
  target: { low: number | null; mean: number | null; high: number | null } | null;
  ratings: { buy: number; hold: number; sell: number; label: string | null; brokers: number | null } | null;
  /** Recommendations month by month over the last year, as Nasdaq keeps them. */
  ratingHistory: Array<{ date: string; buy: number; hold: number; sell: number }>;
  source: string;
}

/** One day's reading, kept to draw how the consensus has moved. */
export interface EstimateSnapshot {
  date: string;
  /** Next fiscal quarter's EPS consensus, and the quarter it is for. */
  q1: number | null; q1End: string | null;
  /** Current and next fiscal year's EPS consensus, and the years. */
  fy1: number | null; fy1End: string | null;
  fy2: number | null; fy2End: string | null;
  /** Earnings per share expected over the next twelve months. */
  ntm: number | null;
  target: number | null;
  analysts: number | null;
  buy: number | null; hold: number | null; sell: number | null;
}

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);

/**
 * Earnings per share expected over the next twelve months: the sum of the next
 * four quarters' consensus, which is the convention a forward P/E is struck on.
 * Without four quarters, the current fiscal year stands in.
 */
export function nextTwelveMonthsEps(estimates: Pick<Estimates, "quarterly" | "yearly">): number | null {
  const next = estimates.quarterly.slice(0, 4).map((row) => row.consensus);
  if (next.length === 4 && next.every(finite)) return (next as number[]).reduce((sum, value) => sum + value, 0);
  const year = estimates.yearly[0]?.consensus;
  return finite(year) ? year : null;
}

/** Growth the consensus expects from the current fiscal year to the next. */
export function expectedGrowth(estimates: Pick<Estimates, "yearly">): number | null {
  const [first, second] = estimates.yearly.map((row) => row.consensus);
  return finite(first) && finite(second) && first > 0 ? second / first - 1 : null;
}

export interface ForwardReading {
  ntmEps: number | null;
  /** Price over next-twelve-months EPS; not stated on expected losses. */
  forwardPe: number | null;
  /** Expected growth from this fiscal year to the next. */
  growth: number | null;
  /** Forward P/E over that growth in percent; not stated without positive growth. */
  peg: number | null;
  /** Mean price target over the price, less one. */
  upside: number | null;
  /** Share of recommendations that are buys. */
  buyShare: number | null;
}

export function forwardReading(estimates: Estimates, price: number | null | undefined): ForwardReading {
  const ntmEps = nextTwelveMonthsEps(estimates);
  const forwardPe = finite(price) && price > 0 && finite(ntmEps) && ntmEps > 0 ? price / ntmEps : null;
  const growth = expectedGrowth(estimates);
  const peg = forwardPe != null && growth != null && growth > 0 ? forwardPe / (growth * 100) : null;
  const upside = finite(price) && price > 0 && finite(estimates.target?.mean) ? estimates.target!.mean! / price - 1 : null;
  const ratings = estimates.ratings;
  const total = ratings ? ratings.buy + ratings.hold + ratings.sell : 0;
  return { ntmEps, forwardPe, growth, peg, upside, buyShare: total > 0 ? ratings!.buy / total : null };
}

export function snapshotOf(estimates: Estimates, date: string): EstimateSnapshot {
  return {
    date,
    q1: estimates.quarterly[0]?.consensus ?? null, q1End: estimates.quarterly[0]?.fiscalEnd ?? null,
    fy1: estimates.yearly[0]?.consensus ?? null, fy1End: estimates.yearly[0]?.fiscalEnd ?? null,
    fy2: estimates.yearly[1]?.consensus ?? null, fy2End: estimates.yearly[1]?.fiscalEnd ?? null,
    ntm: nextTwelveMonthsEps(estimates),
    target: estimates.target?.mean ?? null,
    analysts: estimates.yearly[0]?.analysts ?? estimates.quarterly[0]?.analysts ?? null,
    buy: estimates.ratings?.buy ?? null, hold: estimates.ratings?.hold ?? null, sell: estimates.ratings?.sell ?? null,
  };
}

/** A day's snapshot added to a history: one per day, the latest reading of the day kept, oldest first, two years at most. */
export function recordSnapshot(history: EstimateSnapshot[], snapshot: EstimateSnapshot, keepDays = 730): EstimateSnapshot[] {
  const others = history.filter((entry) => entry.date !== snapshot.date);
  const cutoff = new Date(Date.parse(`${snapshot.date}T00:00:00Z`) - keepDays * 86_400_000).toISOString().slice(0, 10);
  return [...others, snapshot].filter((entry) => entry.date >= cutoff).sort((left, right) => left.date.localeCompare(right.date));
}
