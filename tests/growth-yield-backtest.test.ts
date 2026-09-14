import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cagrForPeriods } from "../lib/finance";
import { companyView } from "../lib/io/view";
import { datasetAsOf, hasHistoryOn } from "../lib/qs/as-of";
import type { CompanyDataset } from "../lib/types";
import { companyShuffleTest, spearman } from "./helpers/ranking";

/**
 * Whether a price is cheap for the growth behind it, measured rather than
 * asserted.
 *
 * The idea is the PEG's — a multiple set against a growth rate — built on what
 * this site reads, which is cash. A division fails on FinScope: measured
 * across the index today, a P/FCF over growth in FCF per share can be struck
 * for only 62% of companies, because a growth rate at or below zero has no
 * meaningful quotient and one between nought and two per cent sends it to a
 * thousand. So the candidates are an addition instead: the cash a price yields
 * plus the growth of what that cash is a share of, which is the return a buyer
 * earns if the business goes on as it has — the Gordon identity, in the units
 * a reader requires of an investment.
 *
 * Every figure is struck as it was known on the cohort's morning. The price is
 * the day's close adjusted for later splits, and the share count is the filed
 * one restated onto the same basis by the normaliser — checked against the
 * record before this was written: Apple at the end of 2016 values at 618bn
 * here against about 617bn, NVIDIA at the end of 2019 at 144bn against 144bn.
 *
 * Variants are compared on their own coverage and on the companies every one
 * of them can score, because a measure defined only for easy cases looks
 * better than it is.
 *
 * It needs the index datasets, so it skips itself when they are absent:
 *
 *   node scripts/fetch-backtest-datasets.mjs /tmp/finscope-index TICKER…
 *   GROWTH_YIELD_FIXTURES=/tmp/finscope-index npx vitest run tests/growth-yield-backtest.test.ts
 */
const FIXTURES = process.env.GROWTH_YIELD_FIXTURES ?? "";
const available = FIXTURES !== "" && existsSync(`${FIXTURES}/tickers.json`);

interface Inputs {
  fcfYield: number | null;
  revenuePerShare5: number | null;
  revenuePerShare10: number | null;
  fcfPerShare5: number | null;
  fcfPerShare10: number | null;
  priceToFcf: number | null;
}

const blend = (five: number | null, ten: number | null) =>
  five == null ? null : ten == null ? five : (five + ten) / 2;
const capped = (growth: number | null, ceiling: number | null) =>
  growth == null ? null : ceiling == null ? growth : Math.min(growth, ceiling);
const conservative = (revenue: number | null, fcf: number | null) =>
  revenue == null ? null : fcf == null ? revenue : Math.min(revenue, fcf);
const plus = (a: number | null, b: number | null) => (a == null || b == null ? null : a + b);

/** Every candidate, written so that a higher score always means cheaper for its growth. */
const VARIANTS: Array<{ name: string; score: (x: Inputs) => number | null }> = [
  { name: "V0 FCF yield alone", score: (x) => x.fcfYield },
  { name: "V1 yield + revenue/share 5Y", score: (x) => plus(x.fcfYield, x.revenuePerShare5) },
  { name: "V2 yield + FCF/share 5Y", score: (x) => plus(x.fcfYield, x.fcfPerShare5) },
  { name: "V3 yield + lower of the two 5Y", score: (x) => plus(x.fcfYield, conservative(x.revenuePerShare5, x.fcfPerShare5)) },
  { name: "V4 yield + revenue/share 5Y·10Y", score: (x) => plus(x.fcfYield, blend(x.revenuePerShare5, x.revenuePerShare10)) },
  { name: "V5 V4, growth capped at 15%", score: (x) => plus(x.fcfYield, capped(blend(x.revenuePerShare5, x.revenuePerShare10), .15)) },
  { name: "V6 V4, growth capped at 20%", score: (x) => plus(x.fcfYield, capped(blend(x.revenuePerShare5, x.revenuePerShare10), .20)) },
  { name: "V7 V4, growth capped at 25%", score: (x) => plus(x.fcfYield, capped(blend(x.revenuePerShare5, x.revenuePerShare10), .25)) },
  { name: "G  revenue/share 5Y·10Y alone", score: (x) => blend(x.revenuePerShare5, x.revenuePerShare10) },
  {
    name: "PEG-FCF (classic, inverted)",
    score: (x) => x.priceToFcf != null && x.priceToFcf > 0 && x.fcfPerShare5 != null && x.fcfPerShare5 > 0
      ? -(x.priceToFcf / (x.fcfPerShare5 * 100)) : null,
  },
];

const annualised = (from: number, to: number, years: number) => (to / from) ** (1 / years) - 1;
const forward = (date: string, years: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
};
const rankWithin = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((value) => sorted.indexOf(value) / Math.max(1, sorted.length - 1));
};

describe.skipIf(!available)("a price against the growth behind it", () => {
  it("measures which way of setting cash yield against growth ranked the returns that followed", () => {
    const tickers = JSON.parse(readFileSync(`${FIXTURES}/tickers.json`, "utf8")) as string[];
    const { cohorts, horizons } = JSON.parse(readFileSync(`${FIXTURES}/dates.json`, "utf8")) as { cohorts: string[]; horizons: number[] };
    const priced = JSON.parse(readFileSync(`${FIXTURES}/prices.json`, "utf8")) as Record<string, Array<{ requestedDate: string; point?: { priceClose?: number | null; close?: number | null; totalReturnClose?: number | null; currency?: string } | null }>>;

    interface Row { cohort: string; ticker: string; inputs: Inputs; returns: Map<number, number> }
    const rows: Row[] = [];

    for (const ticker of tickers) {
      const file = `${FIXTURES}/datasets/${ticker}.json`;
      if (!existsSync(file)) continue;
      const dataset = JSON.parse(readFileSync(file, "utf8")) as CompanyDataset;
      const points = new Map((priced[ticker] ?? []).map((row) => [row.requestedDate, row.point]));
      for (const cohort of cohorts) {
        if (!hasHistoryOn(dataset, cohort)) continue;
        const start = points.get(cohort);
        const price = start?.priceClose ?? start?.close ?? null;
        const total = start?.totalReturnClose ?? price;
        if (!price || !total) continue;

        const asOf = datasetAsOf(dataset, cohort);
        const view = companyView(asOf);
        const period = view.trailing.at(-1) ?? view.annual.at(-1);
        const shares = period?.valuationBasis?.shares ?? null;
        const fcf = period?.values.freeCashFlow ?? null;
        const currencyOk = !start?.currency || start.currency === period?.currency;
        const marketCap = shares && currencyOk ? price * shares : null;

        const annual = asOf.periods.filter((each) => each.periodicity === "annual");
        const growth = (metric: string, years: number) => cagrForPeriods(annual, metric, years).value ?? null;

        const inputs: Inputs = {
          fcfYield: marketCap && fcf != null ? fcf / marketCap : null,
          priceToFcf: marketCap && fcf != null && fcf > 0 ? marketCap / fcf : null,
          revenuePerShare5: growth("revenuePerShare", 5),
          revenuePerShare10: growth("revenuePerShare", 10),
          fcfPerShare5: growth("freeCashFlowPerShare", 5),
          fcfPerShare10: growth("freeCashFlowPerShare", 10),
        };
        const returns = new Map<number, number>();
        for (const years of horizons) {
          const end = points.get(forward(cohort, years));
          const endTotal = end?.totalReturnClose ?? end?.priceClose ?? end?.close ?? null;
          if (endTotal) returns.set(years, annualised(total, endTotal, years));
        }
        if (returns.size) rows.push({ cohort, ticker, inputs, returns });
      }
    }
    expect(rows.length, "company-cohorts with a price and a forward return").toBeGreaterThan(500);

    const lines: string[] = [`${new Set(rows.map((row) => row.ticker)).size} companies, ${rows.length} company-cohorts`];

    for (const years of horizons) {
      const eligible = rows.filter((row) => row.returns.has(years));
      const common = eligible.filter((row) => VARIANTS.every((variant) => variant.score(row.inputs) != null));
      lines.push("");
      lines.push(`${years}-year forward total return — ${eligible.length} company-cohorts, ${common.length} that every variant can score`);
      lines.push(`  ${"variant".padEnd(34)} ${"n".padStart(5)} ${"rho".padStart(6)} ${"p strict".padStart(9)} ${"top−bottom".padStart(11)} | ${"common rho".padStart(10)} ${"p".padStart(6)}`);

      const measure = (set: Row[], variant: (typeof VARIANTS)[number]) => {
        const pooled: Array<[number, number]> = [];
        const byCohort: Array<Array<{ ticker: string; score: number; returnRank: number }>> = [];
        const spreads: number[] = [];
        for (const cohort of cohorts) {
          const inCohort = set.flatMap((row) => {
            const score = row.cohort === cohort ? variant.score(row.inputs) : null;
            return score == null ? [] : [{ ticker: row.ticker, score, ret: row.returns.get(years)! }];
          });
          if (inCohort.length < 12) continue;
          const scoreRanks = rankWithin(inCohort.map((each) => each.score));
          const returnRanks = rankWithin(inCohort.map((each) => each.ret));
          scoreRanks.forEach((rank, index) => pooled.push([rank, returnRanks[index]]));
          byCohort.push(inCohort.map((each, index) => ({ ticker: each.ticker, score: each.score, returnRank: returnRanks[index] })));
          const ordered = [...inCohort].sort((a, b) => b.score - a.score);
          const quarter = Math.floor(ordered.length / 4);
          const mean = (group: typeof ordered) => group.reduce((sum, each) => sum + each.ret, 0) / group.length;
          spreads.push(mean(ordered.slice(0, quarter)) - mean(ordered.slice(-quarter)));
        }
        const rho = spearman(pooled);
        const strict = rho == null ? null : companyShuffleTest(byCohort, rho, 1_000);
        const spread = spreads.length ? spreads.reduce((sum, value) => sum + value, 0) / spreads.length : null;
        return { n: pooled.length, rho, p: strict?.p ?? null, spread };
      };

      const fmt = (value: number | null, digits = 2) => value == null ? "—" : value.toFixed(digits);
      for (const variant of VARIANTS) {
        const own = measure(eligible, variant);
        const shared = measure(common, variant);
        lines.push(`  ${variant.name.padEnd(34)} ${String(own.n).padStart(5)} ${fmt(own.rho).padStart(6)} ${(own.p == null ? "—" : `${(own.p * 100).toFixed(1)}%`).padStart(9)} ${(own.spread == null ? "—" : `${(own.spread * 100).toFixed(1)}%`).padStart(11)} | ${fmt(shared.rho).padStart(10)} ${(shared.p == null ? "—" : `${(shared.p * 100).toFixed(1)}%`).padStart(6)}`);
      }
    }
    // Year by year: a pooled correlation can be one good year carrying six flat ones.
    const steady = VARIANTS.filter((variant) => /^(V0|V4|V7|G )/.test(variant.name));
    for (const years of horizons) {
      lines.push("");
      lines.push(`${years}-year forward total return, cohort by cohort — rho / top−bottom quartile a year`);
      lines.push(`  ${"cohort".padEnd(12)}${steady.map((variant) => variant.name.slice(0, 2).trim().padStart(18)).join("")}`);
      for (const cohort of cohorts) {
        const inCohort = rows.filter((row) => row.cohort === cohort && row.returns.has(years));
        if (!inCohort.length) continue;
        const cells = steady.map((variant) => {
          const scored = inCohort.flatMap((row) => {
            const score = variant.score(row.inputs);
            return score == null ? [] : [{ score, ret: row.returns.get(years)! }];
          });
          if (scored.length < 12) return "—".padStart(18);
          const rho = spearman(scored.map((each) => [each.score, each.ret] as [number, number]));
          const ordered = [...scored].sort((a, b) => b.score - a.score);
          const quarter = Math.floor(ordered.length / 4);
          const mean = (group: typeof ordered) => group.reduce((sum, each) => sum + each.ret, 0) / group.length;
          const spread = mean(ordered.slice(0, quarter)) - mean(ordered.slice(-quarter));
          return `${(rho ?? 0).toFixed(2)} / ${(spread * 100).toFixed(1)}% (${scored.length})`.padStart(18);
        });
        lines.push(`  ${cohort.padEnd(12)}${cells.join("")}`);
      }
    }
    console.log(`\n${lines.join("\n")}\n`);
  }, 1_800_000);
});
