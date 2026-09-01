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

/*
 * A 200 is not enough evidence that a Company Facts download is complete.
 * During the first sweep Exxon was stored as an 80KB payload containing only
 * recent 10-Q facts; the same endpoint normally returns 3MB and its full 10-K
 * history. That single partial response was then classified as a normalizer
 * failure forever because the downloader never revisited an existing file.
 * Four distinct quarterly filings without any annual form is impossible for an
 * established filer and is a useful provider-completeness signal that does not
 * depend on company size or payload bytes.
 */
const inspectCompanyFacts = (text, expectsAnnual = false) => {
  try {
    const body = JSON.parse(text);
    const observations = Object.values(body.facts ?? {}).flatMap((namespace) => Object.values(namespace ?? {}))
      .flatMap((concept) => Object.values(concept.units ?? {})).flat();
    const forms = new Set(observations.map((fact) => fact.form));
    const quarters = new Set(observations.filter((fact) => fact.form === "10-Q").map((fact) => fact.accn));
    const hasAnnual = ["10-K", "20-F", "40-F"].some((form) => forms.has(form));
    return { valid: Boolean(body.entityName) && observations.length > 0 && (!expectsAnnual || hasAnnual) && (hasAnnual || quarters.size < 4), reason: !body.entityName ? "missing entity" : !observations.length ? "no observations" : expectsAnnual && !hasAnnual ? "submissions list an annual filing but Company Facts contains none" : "four or more 10-Q filings but no annual form" };
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : String(error) };
  }
};

const companyFacts = async (url, expectsAnnual) => {
  let failure = "unknown response";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await get(url);
    if (!response.ok) failure = `HTTP ${response.status}`;
    else {
      const text = await response.text();
      const inspected = inspectCompanyFacts(text, expectsAnnual);
      if (inspected.valid) return { text };
      failure = `incomplete payload (${inspected.reason})`;
    }
    await pause(attempt * 500);
  }
  return { failure };
};

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
  // The submissions feed is the independent evidence that an established
  // filer has annual reports. It catches a partial Company Facts response even
  // when that response happens to contain only two recent 10-Q accessions.
  if (!sic[ticker]?.formsComplete) {
    const response = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
    if (response.ok) {
      const body = await response.json();
      const forms = new Set(body.filings?.recent?.form ?? []);
      // High-volume filers can push the last 10-K out of `recent`; the SEC
      // lists older submission pages separately. Read pages until an annual is
      // found, rather than declaring a partial Company Facts payload valid.
      for (const file of body.filings?.files ?? []) {
        if (["10-K", "20-F", "40-F"].some((form) => forms.has(form))) break;
        const archived = await get(`https://data.sec.gov/submissions/${file.name}`);
        if (archived.ok) for (const form of (await archived.json()).form ?? []) forms.add(form);
        await pause(150);
      }
      sic[ticker] = { sic: body.sic ?? null, sicDescription: body.sicDescription ?? null, forms: [...forms], formsComplete: true };
    } else sic[ticker] = { sic: null, forms: [], formsComplete: true };
    writeFileSync(`${dir}/sic.json`, JSON.stringify(sic));
    await pause(150);
  }
  const expectsAnnual = sic[ticker].forms.some((form) => ["10-K", "20-F", "40-F"].includes(form));
  const factFile = `${dir}/facts/${ticker}.json`;
  const missingFile = `${dir}/facts/${ticker}.missing`;
  const existing = existsSync(factFile) ? inspectCompanyFacts(readFileSync(factFile, "utf8"), expectsAnnual) : null;
  if (!existing?.valid && !existsSync(missingFile)) {
    const result = await companyFacts(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, expectsAnnual);
    if (result.text) writeFileSync(factFile, result.text);
    else writeFileSync(missingFile, result.failure);
    await pause(150);
  }
}
console.log(`ready in ${dir}: ${sample.length} filers`);
