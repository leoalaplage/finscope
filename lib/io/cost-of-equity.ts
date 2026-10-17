/**
 * USD CAPM inputs. Beta is an estimate from total returns, not an observed
 * company fundamental. The adjustment and floor are explicit model policies.
 */

/**
 * The premium demanded for holding equities rather than the Treasury.
 *
 * The one figure here nobody filed and nobody can. Five per cent is the middle
 * of the range the long historical studies and the implied-premium literature
 * arrive at, and it is held constant rather than tuned per company for the same
 * reason the terminal rate is: a premium chosen per company is where a cost of
 * capital becomes an opinion wearing a formula.
 */
export const EQUITY_RISK_PREMIUM = .05;
/** The lowest beta a cost of equity is struck on. */
export const BETA_FLOOR = .6;

/** Period-to-period returns from a series of closes, gaps skipped. */
export function returnsOf(closes: Array<number | null | undefined>): number[] {
  const known = closes.filter((close): close is number => close != null && Number.isFinite(close) && close > 0);
  const moves: number[] = [];
  for (let index = 1; index < known.length; index++) moves.push(known[index] / known[index - 1] - 1);
  return moves;
}

/** The fewest weeks worth regressing. Two years, give or take a holiday. */
export const MIN_BETA_OBSERVATIONS = 100;

/**
 * The slope of this company's returns against the market's.
 *
 * Covariance over market variance. Numeric callers must already have aligned
 * periods; tail alignment is retained for existing callers. Market histories
 * must go through alignedWeeklyReturns, which matches both interval endpoints.
 */
export function rawBeta(company: number[], market: number[]): number | null {
  const length = Math.min(company.length, market.length);
  if (length < MIN_BETA_OBSERVATIONS) return null;
  const left = company.slice(-length);
  const right = market.slice(-length);
  if (left.some((value) => !Number.isFinite(value)) || right.some((value) => !Number.isFinite(value))) return null;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / length;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < length; index++) {
    covariance += (left[index] - meanLeft) * (right[index] - meanRight);
    variance += (right[index] - meanRight) ** 2;
  }
  return variance > 0 ? covariance / variance : null;
}

/** Blume adjustment: two thirds measured beta, one third market beta of one. */
export function adjustedBeta(raw: number): number {
  return (2 / 3) * raw + (1 / 3);
}

export interface CostOfEquity {
  rate: number;
  riskFree: number;
  beta: number;
  rawBeta: number;
  premium: number;
  /** Adjusted beta after the explicit model floor; the one used in CAPM. */
  appliedBeta: number;
  /** How many periods the beta was measured over, so the page can say. */
  observations: number;
}

/**
 * The capital asset pricing model, on figures this site already holds.
 *
 * Refused rather than approximated where either ingredient is missing: a cost
 * of equity struck on an assumed risk-free rate is a guess with a formula
 * around it, and the page falls back to the reader's own choice instead.
 */
export function costOfEquity(
  riskFree: number | null,
  company: number[],
  market: number[],
  premium = EQUITY_RISK_PREMIUM,
): CostOfEquity | null {
  if (riskFree == null || !Number.isFinite(riskFree) || riskFree < 0 || riskFree > .25) return null;
  if (!Number.isFinite(premium) || premium <= 0 || premium > .25) return null;
  const raw = rawBeta(company, market);
  // A beta at or under nothing is not a measurement of this company's risk; the reader chooses instead.
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  // The floor is a conservative product assumption, not a measured beta.
  // Both the adjusted estimate and applied beta remain available to disclose it.
  const beta = adjustedBeta(raw);
  const appliedBeta = Math.max(beta, BETA_FLOOR);
  const rate = riskFree + appliedBeta * premium;
  // The terminal-growth comparison belongs to the valuation engine: a valid
  // CAPM estimate does not become invalid because a separate scenario uses g.
  if (!(rate > 0) || rate > .30) return null;
  return { rate, riskFree, beta, appliedBeta, rawBeta: raw, premium, observations: Math.min(company.length, market.length) };
}


export interface DatedClose {
  date: string;
  /** Split- and dividend-adjusted price, consistently used throughout. */
  adjustedClose?: number | null;
}

export interface AlignedWeeklyReturns {
  company: number[];
  market: number[];
  startDate: string | null;
  endDate: string | null;
}

/**
 * Match exact start AND end dates before estimating beta. Removing a missing
 * bar and matching array tails silently regresses different weeks. A missing
 * price invalidates its adjacent intervals; a missing week must not turn into
 * a two-week return paired with a one-week benchmark return.
 *
 * This deliberately requires adjusted prices: mixing a raw close into an
 * adjusted series would manufacture returns around splits and dividends.
 */
export function alignedWeeklyReturns(companyBars: DatedClose[], marketBars: DatedClose[]): AlignedWeeklyReturns {
  const intervals = (bars: DatedClose[]) => {
    const sorted = [...new Map(bars.filter((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.date)).map((bar) => [bar.date, bar])).values()]
      .sort((a, b) => a.date.localeCompare(b.date));
    const result = new Map<string, { value: number; start: string; end: string }>();
    for (let index = 1; index < sorted.length; index++) {
      const before = sorted[index - 1]; const after = sorted[index];
      const days = (Date.parse(after.date) - Date.parse(before.date)) / 86_400_000;
      const left = before.adjustedClose; const right = after.adjustedClose;
      if (!(days >= 4 && days <= 10) || left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) continue;
      result.set(`${before.date}/${after.date}`, { value: right / left - 1, start: before.date, end: after.date });
    }
    return result;
  };
  const company = intervals(companyBars); const market = intervals(marketBars);
  const matched = [...company.entries()].flatMap(([key, point]) => {
    const benchmark = market.get(key);
    return benchmark ? [{ ...point, benchmark: benchmark.value }] : [];
  });
  return {
    company: matched.map((point) => point.value),
    market: matched.map((point) => point.benchmark),
    startDate: matched[0]?.start ?? null,
    endDate: matched.at(-1)?.end ?? null,
  };
}
