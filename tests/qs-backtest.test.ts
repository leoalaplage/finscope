import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { datasetAsOf, hasHistoryOn, publishedOn } from "../lib/qs/as-of";
import { qsRow, qsTable } from "../lib/qs-export";
import { screen, type ScoredCompany } from "../lib/qs/screener";
import { evidenceFor, QS_EVIDENCE } from "../lib/qs/evidence";
import type { CompanyDataset } from "../lib/types";
import { companyShuffleTest, shuffleTest, spearman } from "./helpers/ranking";

/**
 * What the score said, and what happened next.
 *
 * The site asserts that a quality score means something and has never shown
 * that it does. This measures it: strike the score on a past morning using
 * only what was public that morning, then look at the total return of the
 * years that followed, and see whether the ranking said anything.
 *
 * Two things make the measurement honest. The first is `datasetAsOf`, which
 * drops every period published after the cohort date — a 2019 score built from
 * a 2021 annual report is a score with tomorrow's newspaper in it, and that is
 * how a backtest produces a wonderful result that means nothing. The second is
 * that the comparison is made *within* each cohort, by rank: 2019 was a good
 * year for everything and 2022 was a bad one, and a pooled average would be
 * measuring the market rather than the score.
 *
 * One bias cannot be removed and is stated rather than hidden: the companies
 * measured are companies that still exist and are still followed. The ones that
 * failed are not in the sample, and they were disproportionately the ones this
 * score would have marked down — so the bias runs *against* the hypothesis. A
 * positive result under it is worth something; a null result proves nothing.
 *
 * What it says over the whole index — 501 companies, seven cohorts, scored on
 * filings alone, each figure the chance of a strict shuffle doing as well:
 *
 *   1 year   rank correlation 0.07   0.0%
 *   3 years  rank correlation 0.09   0.1%
 *   5 years  rank correlation 0.12   0.1%
 *
 * All three beat the shuffle, which the same measurement over thirty-five
 * companies could not show at three or five years: that null was a want of
 * companies rather than a want of signal. The effect is small and it is not
 * uniform — the top quartile beat the bottom by about three points a year over
 * five years, positive in all five cohorts, while the companies scored at the
 * end of 2021 went on to underperform by twenty-two points over the year that
 * followed. A ranking, then, not a promise.
 *
 * It needs whole normalized datasets, four megabytes each, so it skips itself
 * when they are absent. To run it:
 *
 *   node scripts/fetch-backtest-datasets.mjs /tmp/finscope-backtest TICKER…
 *   QS_BACKTEST_FIXTURES=/tmp/finscope-backtest npx vitest run tests/qs-backtest.test.ts
 */
const FIXTURES = process.env.QS_BACKTEST_FIXTURES ?? "";
const available = FIXTURES !== "" && existsSync(`${FIXTURES}/tickers.json`);

interface PricePointRow { requestedDate: string; point?: { totalReturnClose?: number | null; priceClose?: number | null } | null }

const annualised = (from: number, to: number, years: number) => (to / from) ** (1 / years) - 1;
const pct = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;

describe.skipIf(!available)("the quality score against the years after it", () => {
  it("measures whether a score struck on past filings ranked the returns that followed", () => {
    const tickers = JSON.parse(readFileSync(`${FIXTURES}/tickers.json`, "utf8")) as string[];
    const { cohorts, horizons } = JSON.parse(readFileSync(`${FIXTURES}/dates.json`, "utf8")) as { cohorts: string[]; horizons: number[] };
    const priced = JSON.parse(readFileSync(`${FIXTURES}/prices.json`, "utf8")) as Record<string, PricePointRow[]>;

    const totalReturn = new Map<string, Map<string, number>>();
    for (const [ticker, rows] of Object.entries(priced)) {
      const byDate = new Map<string, number>();
      for (const row of rows) {
        const value = row.point?.totalReturnClose ?? row.point?.priceClose ?? null;
        if (value != null && Number.isFinite(value) && value > 0) byDate.set(row.requestedDate, value);
      }
      totalReturn.set(ticker, byDate);
    }

    const forward = (date: string, years: number) => {
      const [y, m, d] = date.split("-").map(Number);
      return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
    };

    /*
     * One company at a time, scored into every cohort, then let go.
     *
     * A normalized dataset is four megabytes on disk and a good deal more once
     * parsed, so holding five hundred of them at once is how this measurement
     * stops being runnable on the index it most needs to run on. What survives
     * the loop is one small row per company per cohort.
     */
    const byCohort = new Map<string, ReturnType<typeof qsRow>[]>(cohorts.map((cohort) => [cohort, []]));
    const considered = new Map<string, number>(cohorts.map((cohort) => [cohort, 0]));
    let companies = 0;
    for (const ticker of tickers) {
      const file = `${FIXTURES}/datasets/${ticker}.json`;
      if (!existsSync(file)) continue;
      const dataset = JSON.parse(readFileSync(file, "utf8")) as CompanyDataset;
      companies += 1;
      for (const cohort of cohorts) {
        if (!hasHistoryOn(dataset, cohort)) continue;
        considered.set(cohort, (considered.get(cohort) ?? 0) + 1);
        const asOf = datasetAsOf(dataset, cohort);
        // The guarantee the whole measurement rests on, checked rather than
        // trusted: nothing in the scored company was public after that morning.
        for (const period of asOf.periods) expect(publishedOn(period) <= cohort, `${ticker} ${period.label}`).toBe(true);
        // No price is given, so the valuation columns stay empty and the score
        // is struck on the filings alone. A price would have to be reconciled
        // with share counts as they were reported then, which is a second
        // measurement and not this one.
        byCohort.get(cohort)!.push(qsRow(asOf, null));
      }
    }
    expect(companies, "datasets downloaded").toBeGreaterThan(4);

    /** Every company scored on a cohort date, with what it returned afterwards. */
    interface Observation { cohort: string; ticker: string; score: number; coverage: number; returns: Map<number, number> }
    const observations: Observation[] = [];
    const scoredPerCohort: Array<{ cohort: string; scored: number; considered: number }> = [];

    for (const cohort of cohorts) {
      const rows = byCohort.get(cohort) ?? [];
      if (rows.length < 4) continue;
      const result = screen(qsTable(rows), {});
      scoredPerCohort.push({ cohort, scored: result.all.length, considered: considered.get(cohort) ?? 0 });

      for (const company of result.all as ScoredCompany[]) {
        if (company.total == null) continue;
        const prices = totalReturn.get(company.Ticker);
        const start = prices?.get(cohort);
        if (!start) continue;
        const returns = new Map<number, number>();
        for (const years of horizons) {
          const end = prices?.get(forward(cohort, years));
          if (end) returns.set(years, annualised(start, end, years));
        }
        if (returns.size) observations.push({ cohort, ticker: company.Ticker, score: company.total, coverage: company.couverture, returns });
      }
    }

    expect(observations.length, "scored companies with a forward return").toBeGreaterThan(20);

    /** Kept so the published claim can be checked against what was just measured. */
    const measurements: Array<{ years: number; rho: number | null; spreads: number[] }> = [];
    const lines: string[] = [];
    lines.push(`${companies} companies, ${cohorts.length} cohorts, ${observations.length} scored observations`);
    lines.push(scoredPerCohort.map((each) => `${each.cohort.slice(0, 4)}: ${each.scored}`).join("  "));

    for (const years of horizons) {
      const perCohort: Array<{ cohort: string; rho: number | null; spread: number | null; n: number }> = [];
      const pooled: Array<[number, number]> = [];
      /** The same pairs, kept by cohort, so the shuffle can stay inside one. */
      const perCohortPairs: Array<Array<[number, number]>> = [];
      /** And the same again by company, for the shuffle that keeps them together. */
      const perCohortCompanies: Array<Array<{ ticker: string; score: number; returnRank: number }>> = [];
      for (const cohort of cohorts) {
        const set = observations.filter((each) => each.cohort === cohort && each.returns.has(years));
        if (set.length < 4) continue;
        const pairs = set.map((each) => [each.score, each.returns.get(years)!] as [number, number]);
        /*
         * Ranked inside the cohort before pooling, because cohorts are years:
         * everything bought at the end of 2018 did well and everything bought
         * at the end of 2021 did badly, and pooling the raw numbers would
         * measure that rather than the score.
         */
        const rankWithin = (values: number[]) => {
          const sorted = [...values].sort((a, b) => a - b);
          return values.map((value) => sorted.indexOf(value) / Math.max(1, sorted.length - 1));
        };
        const scoreRanks = rankWithin(pairs.map((pair) => pair[0]));
        const returnRanks = rankWithin(pairs.map((pair) => pair[1]));
        scoreRanks.forEach((rank, index) => pooled.push([rank, returnRanks[index]]));
        perCohortPairs.push(scoreRanks.map((rank, index) => [rank, returnRanks[index]] as [number, number]));
        perCohortCompanies.push(set.map((each, index) => ({ ticker: each.ticker, score: each.score, returnRank: returnRanks[index] })));

        const ordered = [...set].sort((a, b) => b.score - a.score);
        const quarter = Math.max(1, Math.floor(ordered.length / 4));
        const mean = (group: Observation[]) => group.reduce((sum, each) => sum + each.returns.get(years)!, 0) / group.length;
        perCohort.push({
          cohort, n: set.length,
          rho: spearman(pairs),
          spread: mean(ordered.slice(0, quarter)) - mean(ordered.slice(-quarter)),
        });
      }
      const overall = spearman(pooled);
      const chance = overall == null ? null : shuffleTest(perCohortPairs, overall);
      const strict = overall == null ? null : companyShuffleTest(perCohortCompanies, overall);
      lines.push("");
      lines.push(`${years}-year forward total return, annualised — pooled rank correlation ${overall == null ? "—" : overall.toFixed(2)} over ${pooled.length} observations`);
      lines.push(`  chance of doing this well: ${chance == null ? "—" : `${(chance * 100).toFixed(1)}%`} shuffling inside each cohort`
        + (strict == null ? "" : `, ${(strict.p * 100).toFixed(1)}% shuffling the ${strict.companies} companies once for all of them`));
      for (const row of perCohort) {
        lines.push(`  ${row.cohort}  n=${String(row.n).padStart(2)}  rho=${row.rho == null ? "—" : row.rho.toFixed(2).padStart(5)}  top quartile − bottom quartile: ${pct(row.spread)}`);
      }
      measurements.push({ years, rho: overall, spreads: perCohort.map((row) => row.spread ?? 0) });
    }
    // The point of the exercise: the numbers, printed, whatever they say.
    console.log(`\n${lines.join("\n")}\n`);

    /*
     * And the published claim, checked against them.
     *
     * A company page now tells the reader what this grade has been shown to be
     * worth. That sentence reads its figures from `lib/qs/evidence.ts`, and
     * this is what stops the two drifting apart: rerun the measurement over the
     * same index and the published numbers have to still be the measured ones,
     * or the run fails and says which.
     *
     * Only when the fixtures are the index the claim was measured on. A run
     * over thirty-five companies is a different measurement, and it should
     * print its answer rather than fail against a claim it is not testing.
     */
    if (companies >= QS_EVIDENCE.companies - 10) {
      for (const measured of measurements) {
        const published = evidenceFor(measured.years);
        expect(published, `${measured.years}-year evidence is published`).not.toBeNull();
        if (!published) continue;
        expect(published.rho, `${measured.years}-year rank correlation`).toBeCloseTo(measured.rho ?? 0, 2);
        expect(published.spreads.length, `${measured.years}-year cohorts`).toBe(measured.spreads.length);
        measured.spreads.forEach((spread, index) => {
          expect(published.spreads[index], `${measured.years}-year cohort ${index + 1} spread`).toBeCloseTo(spread, 3);
        });
      }
    }
    /*
     * Ten minutes, because the measurement this exists for takes forty seconds
     * over five hundred companies — two gigabytes of filings parsed, seven
     * cohorts scored and four thousand shuffles — and vitest's default five
     * seconds failed a run that had already printed its answer.
     */
  }, 600_000);
});
