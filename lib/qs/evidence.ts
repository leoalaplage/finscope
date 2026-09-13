/**
 * What the score has been shown to be worth, in one place.
 *
 * The site has always asserted that a quality grade means something. This is
 * the measurement behind the claim, and it lives here rather than in the
 * sentence that states it so that the sentence cannot drift from the figures:
 * `tests/qs-backtest.test.ts` recomputes all of this from filings and prices
 * and fails if what is published no longer matches what was measured.
 *
 * How it was measured, in one paragraph. Every company in the index was scored
 * on the last business day of each year from 2016 to 2022, using only periods
 * published on or before that morning — a score built from a report that had
 * not been filed yet is the mistake that makes every backtest look brilliant.
 * The total return of the one, three and five years that followed was then
 * ranked against the score, inside each cohort, because 2019 was a good year
 * for everything and 2022 was a bad one. Significance is a shuffle rather than
 * a table: the companies are permuted once and that permutation applied to
 * every cohort, which preserves the persistence of the scores and the overlap
 * of the returns that a naive test throws away.
 *
 * Two things it cannot show. The index is today's membership, so companies
 * that failed or were taken over are missing — a bias that removes bad
 * outcomes mostly from the bottom of the ranking, and therefore runs against
 * the score rather than for it. And these are five hundred large American
 * companies through a decade that rose; nothing here says what the score does
 * elsewhere.
 */

export interface HorizonEvidence {
  years: number;
  /** Spearman's rank correlation between the score and the return that followed. */
  rho: number;
  /** How often the strict shuffle did as well, as a fraction. */
  chance: number;
  /** Top quartile less bottom quartile, annualised, one figure per cohort. */
  spreads: number[];
}

export const QS_EVIDENCE = {
  measuredOn: "2026-09-13",
  universe: "S&P 500",
  companies: 501,
  observations: 3_089,
  cohorts: ["2016-12-30", "2017-12-29", "2018-12-31", "2019-12-31", "2020-12-31", "2021-12-31", "2022-12-30"],
  /** The score was struck on the filings alone; no valuation column was scored. */
  filingsOnly: true,
  horizons: [
    { years: 1, rho: 0.07, chance: 0.000, spreads: [.075, .016, .094, .064, .067, -.218, .118] },
    { years: 3, rho: 0.09, chance: 0.001, spreads: [.059, .078, .098, -.002, .007, -.028, .010] },
    { years: 5, rho: 0.12, chance: 0.001, spreads: [.060, .024, .058, .020, .004] },
  ] as HorizonEvidence[],
};

/** The mean of a horizon's cohort spreads, which is the figure worth quoting. */
export function averageSpread(horizon: HorizonEvidence): number {
  return horizon.spreads.reduce((sum, spread) => sum + spread, 0) / horizon.spreads.length;
}

export const evidenceFor = (years: number) => QS_EVIDENCE.horizons.find((horizon) => horizon.years === years) ?? null;
