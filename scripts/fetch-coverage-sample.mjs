/*
 * Downloads the raw Company Facts behind tests/coverage-sweep.test.ts.
 *
 * A hundred and ten filers sampled across the SEC's own registry — the sixty
 * largest, then a spread down through the long tail — because the question the
 * sweep answers is what happens to a ticker nobody curated, not what happens to
 * the watchlist. About a gigabyte, so it lands outside the repository and the
 * sweep skips itself when it is not there.
 *
 *   node scripts/fetch-coverage-sample.mjs /tmp/finscope-coverage
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

const UA = process.env.SEC_USER_AGENT || "FinScope research application contact@example.com";
const dir = process.argv[2] ?? "/tmp/finscope-coverage";
const get = async (url) => fetch(url, { headers: { "User-Agent": UA } });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(`${dir}/facts`, { recursive: true });

if (!existsSync(`${dir}/sample.json`)) {
  const all = Object.values(await (await get("https://www.sec.gov/files/company_tickers.json")).json());
  // Ordered by size, so slicing bands samples the market rather than one end.
  const band = (from, to, count) => {
    const step = Math.max(1, Math.floor((to - from) / count));
    const out = [];
    for (let index = from; index < to && out.length < count; index += step) out.push(all[index]);
    return out;
  };
  const sample = [...all.slice(0, 60), ...band(60, 300, 20), ...band(300, 1200, 12), ...band(1200, 4000, 10), ...band(4000, all.length, 8)];
  const seen = new Set();
  writeFileSync(`${dir}/sample.json`, JSON.stringify(sample
    .filter((entry) => entry && !seen.has(entry.ticker) && seen.add(entry.ticker))
    .map((entry) => ({ ticker: entry.ticker, cik: String(entry.cik_str).padStart(10, "0"), name: entry.title }))));
}

const sample = JSON.parse(readFileSync(`${dir}/sample.json`, "utf8"));
const sic = existsSync(`${dir}/sic.json`) ? JSON.parse(readFileSync(`${dir}/sic.json`, "utf8")) : {};
for (const { ticker, cik } of sample) {
  if (!existsSync(`${dir}/facts/${ticker}.json`) && !existsSync(`${dir}/facts/${ticker}.missing`)) {
    const response = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    if (response.ok) writeFileSync(`${dir}/facts/${ticker}.json`, await response.text());
    else writeFileSync(`${dir}/facts/${ticker}.missing`, String(response.status));
    await pause(150);
  }
  // The SIC decides the economic model, exactly as a dynamic resolution does.
  if (!sic[ticker]) {
    const response = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
    sic[ticker] = response.ok ? await response.json().then((body) => ({ sic: body.sic ?? null, sicDescription: body.sicDescription ?? null })) : { sic: null };
    writeFileSync(`${dir}/sic.json`, JSON.stringify(sic));
    await pause(150);
  }
}
console.log(`ready in ${dir}: ${sample.length} filers`);
