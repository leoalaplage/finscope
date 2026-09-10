/**
 * What this company's own risk implies you should want from it.
 *
 * The discounted cash flow's one unfiled number used to be four buttons — six,
 * eight, ten, twelve per cent — and a reader with no view picked the middle
 * one. That is not a small detail: moving it from eight to twelve changes the
 * growth the price is asking for by seven to twelve points, so the button
 * decided the answer.
 *
 * A cost of equity is the standard way to stop guessing, and every ingredient
 * is already on this site. The risk-free rate is the ten-year Treasury, which
 * the macro page serves live. The beta is five years of weekly returns against
 * the S&P 500, both of which the market endpoint already returns. Only the
 * equity risk premium is chosen, and it is one number stated once rather than
 * four offered without explanation.
 *
 * It is still an estimate and the reader can still override it. What changes is
 * that the default is a reading of this company rather than a round number:
 * Johnson & Johnson comes out at 7.2% and Palantir at 13.7%, which is the
 * difference the buttons were pretending did not exist.
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

/** Period-to-period returns from a series of closes, gaps skipped. */
export function returnsOf(closes: Array<number | null | undefined>): number[] {
  const known = closes.filter((close): close is number => close != null && Number.isFinite(close) && close > 0);
  const moves: number[] = [];
  for (let index = 1; index < known.length; index++) moves.push(known[index] / known[index - 1] - 1);
  return moves;
}

/** The fewest weeks worth regressing. Two years, give or take a holiday. */
const SHORTEST = 100;

/**
 * The slope of this company's returns against the market's.
 *
 * Covariance over the market's variance, on the overlapping tail of the two
 * series — a company listed three years ago has three years of weeks and the
 * index has five, and regressing them from opposite ends would pair Monday
 * with Thursday for the whole run.
 */
export function rawBeta(company: number[], market: number[]): number | null {
  const length = Math.min(company.length, market.length);
  if (length < SHORTEST) return null;
  const left = company.slice(-length);
  const right = market.slice(-length);
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

/**
 * The same beta, pulled a third of the way towards one.
 *
 * Betas revert: a measured 0.2 is partly a real property of the business and
 * partly five years of luck, and next period's will sit closer to the market's
 * own 1.0 than this period's did. Blume's adjustment is the standard correction
 * and it is not cosmetic here — Johnson & Johnson measures 0.20 on five years
 * of weeks, which no data provider publishes and no analyst would use; adjusted
 * it is 0.47, which is what everybody else reports.
 */
export function adjustedBeta(raw: number): number {
  return (2 / 3) * raw + (1 / 3);
}

export interface CostOfEquity {
  rate: number;
  riskFree: number;
  beta: number;
  rawBeta: number;
  premium: number;
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
  const raw = rawBeta(company, market);
  if (raw == null || !Number.isFinite(raw)) return null;
  const beta = adjustedBeta(raw);
  const rate = riskFree + beta * premium;
  // A negative-beta company would price below the Treasury, and a rate at or
  // under the terminal growth makes a perpetuity infinite. Neither is a reading
  // this page can use, so it hands the choice back rather than clamping.
  if (!(rate > .04) || rate > .30) return null;
  return { rate, riskFree, beta, rawBeta: raw, premium, observations: Math.min(company.length, market.length) };
}
