/*
 * Downloads the company datasets and prices behind tests/qs-backtest.test.ts.
 *
 * The backtest asks whether the Quality Score, struck only on what was public
 * on a past morning, said anything about the years that followed. That needs
 * the whole normalized dataset per company — every period with the day it was
 * published — which is four megabytes each and belongs nowhere near the
 * repository, so it lands outside it and the test skips itself when it is not
 * there.
 *
 *   node scripts/fetch-backtest-datasets.mjs [dir] [tickers…]
 *   QS_BACKTEST_FIXTURES=<that dir> npx vitest run tests/qs-backtest.test.ts
 *
 * With no tickers it takes the built-in watchlist. Prices come from the same
 * endpoint the site uses, asked for the exact dates the cohorts need, so the
 * measurement prices a company the way the page would have priced it.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

const ORIGIN = process.env.FINSCOPE_ORIGIN ?? "https://finscope-financial-research.leoalaplage.workers.dev";
const dir = process.argv[2] ?? "/tmp/finscope-backtest";
const asked = process.argv.slice(3);

/** The days a cohort is struck on, and the days its return is measured to. */
export const COHORTS = ["2016-12-30", "2017-12-29", "2018-12-31", "2019-12-31", "2020-12-31", "2021-12-31", "2022-12-30"];
const HORIZONS = [1, 3, 5];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const forward = (date, years) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
};

const dates = [...new Set([
  ...COHORTS,
  ...COHORTS.flatMap((date) => HORIZONS.map((years) => forward(date, years))),
])].filter((date) => date <= new Date().toISOString().slice(0, 10)).sort();

async function tickers() {
  if (asked.length) return asked.map((each) => each.toUpperCase());
  const response = await fetch(`${ORIGIN}/api/watchlist?tickers=`);
  if (response.ok) {
    const payload = await response.json();
    const held = (payload.summaries ?? []).map((each) => each.ticker);
    if (held.length) return held;
  }
  throw new Error("No tickers given and the watchlist could not be read.");
}

mkdirSync(`${dir}/datasets`, { recursive: true });

const list = await tickers();
writeFileSync(`${dir}/tickers.json`, JSON.stringify(list, null, 1));
writeFileSync(`${dir}/dates.json`, JSON.stringify({ cohorts: COHORTS, horizons: HORIZONS, dates }, null, 1));

const prices = existsSync(`${dir}/prices.json`) ? JSON.parse(readFileSync(`${dir}/prices.json`, "utf8")) : {};

for (const ticker of list) {
  const file = `${dir}/datasets/${ticker}.json`;
  if (!existsSync(file)) {
    process.stdout.write(`${ticker} dataset… `);
    const response = await fetch(`${ORIGIN}/api/company/${encodeURIComponent(ticker)}`, { headers: { "X-FinScope-Warm": "1" } });
    if (!response.ok) { console.log(`skipped (${response.status})`); continue; }
    const text = await response.text();
    writeFileSync(file, text);
    console.log(`${(text.length / 1e6).toFixed(1)}MB`);
    await pause(300);
  }
  if (!prices[ticker]) {
    process.stdout.write(`${ticker} prices… `);
    const response = await fetch(`${ORIGIN}/api/prices/${encodeURIComponent(ticker)}?dates=${dates.join(",")}`);
    if (!response.ok) { console.log(`skipped (${response.status})`); continue; }
    const payload = await response.json();
    prices[ticker] = payload.points ?? payload;
    writeFileSync(`${dir}/prices.json`, JSON.stringify(prices));
    console.log(`${(prices[ticker] ?? []).length} dates`);
    await pause(300);
  }
}

console.log(`\n${list.length} companies in ${dir}`);
