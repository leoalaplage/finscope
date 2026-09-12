import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { datasetAsOf, hasHistoryOn, publishedOn } from "../lib/qs/as-of";
import { qsRow, qsTable } from "../lib/qs-export";
import { screen, type ScoredCompany } from "../lib/qs/screener";
import type { CompanyDataset } from "../lib/types";

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
 * It needs whole normalized datasets, four megabytes each, so it skips itself
 * when they are absent. To run it:
 *
 *   node scripts/fetch-backtest-datasets.mjs /tmp/finscope-backtest TICKER…
 *   QS_BACKTEST_FIXTURES=/tmp/finscope-backtest npx vitest run tests/qs-backtest.test.ts
 */
const FIXTURES = process.env.QS_BACKTEST_FIXTURES ?? "";
const available = FIXTURES !== "" && existsSync(`${FIXTURES}/tickers.json`);

interface PricePointRow { requestedDate: string; point?: { totalReturnClose?: number | null; priceClose?: number | null } | null }

/** Spearman's rank correlation: Pearson's, computed on the ranks. */
export function spearman(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 4) return null;
  const rank = (values: number[]) => {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array<number>(values.length);
    for (let at = 0; at < order.length;) {
      let end = at;
      while (end + 1 < order.length && order[end + 1].value === order[at].value) end++;
      const shared = (at + end) / 2 + 1;
      for (let index = at; index <= end; index++) ranks[order[index].index] = shared;
      at = end + 1;
    }
    return ranks;
  };
  const left = rank(pairs.map((pair) => pair[0]));
  const right = rank(pairs.map((pair) => pair[1]));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanLeft = mean(left), meanRight = mean(right);
  let top = 0, leftSquares = 0, rightSquares = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index] - meanLeft, b = right[index] - meanRight;
    top += a * b; leftSquares += a * a; rightSquares += b * b;
  }
  return leftSquares && rightSquares ? top / Math.sqrt(leftSquares * rightSquares) : null;
}

/**
 * How often chance alone would have done this well.
 *
 * A rank correlation of 0.14 is a number, not a finding. The companies in a
 * cohort all rise and fall with the same market, so the usual table of
 * significance does not apply; what does is shuffling. Deal the same scores
 * out at random within each cohort, keep the returns where they are, pool the
 * ranks exactly as the measurement does, and see how often the shuffle beats
 * what the score actually achieved.
 *
 * A deterministic generator, because a measurement whose answer moves between
 * runs is a measurement nobody can check.
 */
export function shuffleTest(
  cohorts: Array<Array<[number, number]>>,
  observed: number,
  rounds = 2_000,
): number {
  let seed = 0x2f6e2b1;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };
  let beaten = 0;
  for (let round = 0; round < rounds; round++) {
    const pooled: Array<[number, number]> = [];
    for (const cohort of cohorts) {
      const scores = cohort.map((pair) => pair[0]);
      for (let at = scores.length - 1; at > 0; at--) {
        const swap = Math.floor(random() * (at + 1));
        [scores[at], scores[swap]] = [scores[swap], scores[at]];
      }
      cohort.forEach((pair, index) => pooled.push([scores[index], pair[1]]));
    }
    const rho = spearman(pooled);
    if (rho != null && rho >= observed) beaten += 1;
  }
  return beaten / rounds;
}

/**
 * The same test, but harder, and the one worth quoting.
 *
 * The lenient shuffle deals scores out afresh in every cohort, which pretends
 * the cohorts are independent. They are not: the same thirty-five companies
 * appear in all of them, a company scoring well in 2016 scores well in 2017,
 * and five-year returns from consecutive years overlap by four. Two hundred
 * and twenty-seven observations are nothing like two hundred and twenty-seven
 * independent ones, so that test reports a smaller number than it has earned.
 *
 * This one permutes the companies once and applies the same permutation to
 * every cohort — the score of Costco follows Chevron's returns in all seven
 * years, not in one. Everything the lenient test breaks is preserved: the
 * persistence of the scores, the overlap of the returns, the market they
 * shared. What remains is the only question that matters — whether the score
 * belongs to the company whose returns it is being credited with.
 */
export function companyShuffleTest(
  cohorts: Array<Array<{ ticker: string; score: number; returnRank: number }>>,
  observed: number,
  rounds = 2_000,
): { p: number; companies: number } | null {
  const common = cohorts.reduce<string[] | null>((kept, cohort) => {
    const here = new Set(cohort.map((entry) => entry.ticker));
    return kept == null ? [...here] : kept.filter((ticker) => here.has(ticker));
  }, null) ?? [];
  if (common.length < 8 || cohorts.length < 2) return null;

  let seed = 0x5bd1e995;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };

  // Ranked within the cohort, over the companies every cohort shares, so the
  // observed figure and the shuffled ones are measured on the same footing.
  const ranked = cohorts.map((cohort) => {
    const kept = cohort.filter((entry) => common.includes(entry.ticker));
    const scores = [...kept].sort((a, b) => a.score - b.score).map((entry) => entry.score);
    return new Map(kept.map((entry) => [entry.ticker, {
      score: scores.indexOf(entry.score) / Math.max(1, scores.length - 1),
      returnRank: entry.returnRank,
    }]));
  });

  const pooledFor = (assign: Map<string, string>) => {
    const pooled: Array<[number, number]> = [];
    for (const cohort of ranked) {
      for (const [ticker, entry] of cohort) {
        const lent = cohort.get(assign.get(ticker) ?? ticker);
        if (lent) pooled.push([lent.score, entry.returnRank]);
      }
    }
    return spearman(pooled);
  };

  const straight = pooledFor(new Map()) ?? observed;
  let beaten = 0;
  for (let round = 0; round < rounds; round++) {
    const shuffled = [...common];
    for (let at = shuffled.length - 1; at > 0; at--) {
      const swap = Math.floor(random() * (at + 1));
      [shuffled[at], shuffled[swap]] = [shuffled[swap], shuffled[at]];
    }
    const assign = new Map(common.map((ticker, index) => [ticker, shuffled[index]]));
    const rho = pooledFor(assign);
    if (rho != null && rho >= straight) beaten += 1;
  }
  return { p: beaten / rounds, companies: common.length };
}

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
    }
    // The point of the exercise: the numbers, printed, whatever they say.
    console.log(`\n${lines.join("\n")}\n`);
  });
});
