/*
 * Builds the institutional holders table from the SEC's own quarterly 13F set.
 *
 *   SEC_USER_AGENT="you you@example.com" node scripts/fetch-13f-holders.mjs
 *
 * Every institutional manager with over $100m under discretion reports its US
 * equity positions on Form 13F within forty-five days of a quarter end, and the
 * SEC republishes the whole quarter as one archive: about four million holdings
 * in a single file rather than eleven thousand filings fetched one at a time.
 * That is the difference between this being a page section and being a project.
 *
 * It runs where a filesystem and four hundred megabytes exist — a laptop or CI,
 * once a quarter — and leaves a small artifact the Worker can serve. Nothing
 * here runs in a request.
 *
 * Two joins and one refusal:
 *
 *   · A holding names a CUSIP, and this application knows companies by ticker.
 *     The crosswalk is the SEC's own fails-to-deliver file, which publishes
 *     CUSIP and symbol side by side twice a month. Separators differ between
 *     the two conventions — Berkshire's B shares are `BRKB` there and `BRK.B`
 *     here — so both sides are stripped to letters and digits before matching.
 *     No name matching anywhere: a fuzzy join on "BLACKROCK" would attach one
 *     company's holders to another and never say so.
 *
 *   · A holding names an accession, and the manager's name is on the cover page
 *     of that filing.
 *
 *   · An option is not a holding. Rows carrying a put or a call are dropped,
 *     and only share amounts are counted — a right to buy a million shares is
 *     not a million shares.
 */
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, createReadStream, rmSync, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AGENT = process.env.SEC_USER_AGENT;
if (!AGENT) {
  console.error("Set SEC_USER_AGENT to a contact string. The SEC refuses anonymous automated reads.");
  process.exit(1);
}

/** How many managers are kept per company. A page shows a table, not a register. */
const TOP = 15;

const work = join(tmpdir(), "finscope-13f");
mkdirSync(work, { recursive: true });

const download = async (url, to) => {
  if (existsSync(to)) return to;
  const response = await fetch(url, { headers: { "User-Agent": AGENT } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(to));
  return to;
};

const listing = async (page, pattern) => {
  const html = await (await fetch(page, { headers: { "User-Agent": AGENT } })).text();
  return [...html.matchAll(pattern)].map((match) => match[0]);
};

/** The newest quarterly archive the SEC currently lists. */
const [latest13f] = await listing(
  "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets",
  /\/files\/structureddata\/data\/form-13f-data-sets\/[a-z0-9]+-[a-z0-9]+_form13f\.zip/g,
);
if (!latest13f) throw new Error("The SEC's 13F data-set page listed no archive.");

/**
 * The newest fails-to-deliver files, for the CUSIP-to-symbol join.
 *
 * A fortnight of them names only the securities that actually failed to settle
 * in that fortnight, and the most liquid companies sometimes fail in none:
 * Exxon was absent from the two first used, so it had no holders at all while
 * every mid-cap around it did. Several months of files together name eighteen
 * thousand symbols against fifteen, and every mega-cap appears in them.
 */
const fails = (await listing(
  "https://www.sec.gov/data/foiadocsfailsdatahtm",
  /\/files\/data\/fails-deliver-data\/cnsfails\d{6}[ab]\.zip/g,
)).slice(0, 12);
if (!fails.length) throw new Error("The SEC's fails-to-deliver page listed no file.");

console.log(`13F archive: ${latest13f}`);
console.log(`crosswalk:   ${fails.join(", ")}`);

const zip13f = await download(`https://www.sec.gov${latest13f}`, join(work, "form13f.zip"));
execFileSync("unzip", ["-o", "-q", zip13f, "COVERPAGE.tsv", "INFOTABLE.tsv", "SUBMISSION.tsv", "-d", work]);

/* --- the CUSIP-to-ticker crosswalk ---------------------------------------- */

const plain = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const symbolOf = new Map();
for (const path of fails) {
  const file = await download(`https://www.sec.gov${path}`, join(work, path.split("/").pop()));
  // The file inside is not always named after the archive, so it is read from
  // the listing rather than derived — one month's spelling should not cost the
  // whole crosswalk.
  const listed = execFileSync("unzip", ["-Z", "-1", file], { encoding: "utf8" })
    .split("\n").map((line) => line.trim()).filter((line) => line.toLowerCase().endsWith(".txt"));
  if (!listed.length) { console.warn(`  no text file in ${path}`); continue; }
  execFileSync("unzip", ["-o", "-q", file, "-d", work]);
  for (const name of listed) {
    for (const line of readFileSync(join(work, name), "latin1").split("\n").slice(1)) {
      const [, cusip, symbol] = line.split("|");
      if (cusip?.trim() && symbol?.trim()) symbolOf.set(cusip.trim(), plain(symbol));
    }
  }
}
console.log(`crosswalk holds ${symbolOf.size.toLocaleString()} CUSIPs`);

/* --- the manager behind each filing --------------------------------------- */

const columns = (header) => Object.fromEntries(header.split("\t").map((name, index) => [name, index]));
const readTsv = async (path, each) => {
  const lines = createInterface({ input: createReadStream(path, { encoding: "latin1" }), crlfDelay: Infinity });
  let index = null;
  for await (const line of lines) {
    if (!index) { index = columns(line); continue; }
    each(line.split("\t"), index);
  }
};

const cover = new Map();
await readTsv(join(work, "COVERPAGE.tsv"), (row, at) => {
  cover.set(row[at.ACCESSION_NUMBER], { name: row[at.FILINGMANAGER_NAME], amendment: (row[at.AMENDMENTTYPE] ?? "").trim() });
});
const filing = new Map();
await readTsv(join(work, "SUBMISSION.tsv"), (row, at) => {
  filing.set(row[at.ACCESSION_NUMBER], {
    cik: row[at.CIK],
    period: row[at.PERIODOFREPORT],
    type: row[at.SUBMISSIONTYPE],
    filed: row[at.FILING_DATE],
  });
});
console.log(`${filing.size.toLocaleString()} filings`);

/*
 * One quarter, and one report per manager within it.
 *
 * The archive is named for a span of filing dates, not for a quarter: this one
 * carries ten thousand reports for the March quarter and a tail of hundreds for
 * December, September and every quarter back to 2008, filed late or amended. A
 * manager appearing in two of them is two different quarters, and adding them
 * together doubles that manager's position.
 *
 * Amendments do the same again. Vanguard Capital Management filed three reports
 * for the March quarter — an original and two amendments — and summing all
 * three put it at thirteen per cent of Apple against BlackRock's eight, which
 * is what sent me looking. The SEC's own semantics settle it: a RESTATEMENT
 * replaces the holdings it amends, so only the newest one counts; a NEW
 * HOLDINGS amendment adds to them, so it is kept alongside the original. A
 * notice filing (13F-NT) reports no holdings at all — another manager reports
 * them — and is dropped.
 */
const periods = new Map();
for (const { period } of filing.values()) periods.set(period, (periods.get(period) ?? 0) + 1);
const asOf = [...periods].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

const byManager = new Map();
for (const [accession, entry] of filing) {
  if (entry.period !== asOf) continue;
  if (!entry.type.startsWith("13F-HR")) continue;
  const held = byManager.get(entry.cik) ?? [];
  held.push({ accession, ...entry, amendment: cover.get(accession)?.amendment ?? "" });
  byManager.set(entry.cik, held);
}

const use = new Set();
let restated = 0;
for (const reports of byManager.values()) {
  const restatements = reports.filter((report) => report.amendment === "RESTATEMENT");
  if (restatements.length) {
    restated += 1;
    const newest = restatements.reduce((best, report) => (report.filed > best.filed ? report : best));
    use.add(newest.accession);
    continue;
  }
  for (const report of reports) use.add(report.accession);
}
console.log(`${asOf}: ${byManager.size.toLocaleString()} managers, ${use.size.toLocaleString()} reports counted (${restated} restated)`);

/* --- the holdings --------------------------------------------------------- */

/**
 * What one share was worth, according to everybody who reported holding it.
 *
 * The value column changed convention: Form 13F used to be filed in thousands
 * of dollars and is now filed in whole ones, and five per cent of managers are
 * still on the old footing. T. Rowe Price reported 33m shares of Meta at
 * $18.9m — a price of fifty-seven cents for a share that traded at $572.
 *
 * There is no need to fetch a price to catch it. Seven thousand managers hold
 * Meta and the median of what they implicitly paid a share *is* the price;
 * a filer a thousandth of that is filing in thousands, and nothing else is a
 * thousandth of anything. It is the same inference the screener makes about a
 * market-cap column stated in an unknown unit, for the same reason: the scale
 * is a fact about the source, not about the company.
 *
 * First pass: what did each company's filers imply a share was worth.
 */
const impliedPrices = new Map();
let rows = 0;
await readTsv(join(work, "INFOTABLE.tsv"), (row, at) => {
  rows += 1;
  if (!use.has(row[at.ACCESSION_NUMBER])) return;
  if (row[at.PUTCALL]?.trim()) return;
  if (row[at.SSHPRNAMTTYPE]?.trim() !== "SH") return;
  const ticker = symbolOf.get(row[at.CUSIP]?.trim());
  if (!ticker) return;
  const shares = Number(row[at.SSHPRNAMT]);
  const value = Number(row[at.VALUE]);
  if (!(shares > 0) || !(value > 0)) return;
  const seen = impliedPrices.get(ticker) ?? [];
  seen.push(value / shares);
  impliedPrices.set(ticker, seen);
});

const priceOf = new Map();
for (const [ticker, seen] of impliedPrices) {
  seen.sort((left, right) => left - right);
  priceOf.set(ticker, seen[Math.floor(seen.length / 2)]);
}
impliedPrices.clear();
console.log(`${rows.toLocaleString()} rows, a share price implied for ${priceOf.size.toLocaleString()} companies`);

/*
 * Second pass, with the value read in the unit its filer used.
 *
 * A thousandth of the company's median is corrected. Anything else outside a
 * fivefold band of it is a figure this cannot account for — a mistyped share
 * count, a class the CUSIP does not distinguish — and the value is withheld
 * rather than guessed at. The shares are kept either way: they are what the
 * percentage is struck from, and they are not in doubt.
 */
const held = new Map();
let counted = 0, rescaled = 0, withheld = 0;
await readTsv(join(work, "INFOTABLE.tsv"), (row, at) => {
  const accession = row[at.ACCESSION_NUMBER];
  if (!use.has(accession)) return;
  // An option is not a holding, and neither is a principal amount of debt.
  if (row[at.PUTCALL]?.trim()) return;
  if (row[at.SSHPRNAMTTYPE]?.trim() !== "SH") return;
  const ticker = symbolOf.get(row[at.CUSIP]?.trim());
  if (!ticker) return;
  const shares = Number(row[at.SSHPRNAMT]);
  if (!Number.isFinite(shares) || shares <= 0) return;
  const name = cover.get(accession)?.name;
  if (!name) return;
  counted += 1;

  const typical = priceOf.get(ticker);
  const raw = Number(row[at.VALUE]);
  let value = null;
  if (Number.isFinite(raw) && raw > 0 && typical > 0) {
    const implied = raw / shares;
    const ratio = implied / typical;
    if (ratio > 0.2 && ratio < 5) value = raw;
    else if (ratio > 0.0002 && ratio < 0.005) { value = raw * 1000; rescaled += 1; }
    else withheld += 1;
  }

  const company = held.get(ticker) ?? new Map();
  const running = company.get(name) ?? { shares: 0, value: 0, unpriced: false };
  running.shares += shares;
  if (value == null) running.unpriced = true;
  else running.value += value;
  company.set(name, running);
  held.set(ticker, company);
});
console.log(`${counted.toLocaleString()} holdings counted, ${rescaled.toLocaleString()} filed in thousands and rescaled, ${withheld.toLocaleString()} values withheld, ${held.size.toLocaleString()} companies`);

const out = {};
for (const [ticker, managers] of held) {
  const ranked = [...managers].sort((left, right) => right[1].shares - left[1].shares);
  out[ticker] = {
    asOf,
    managers: ranked.length,
    // Every manager's shares, so a share of the company can be struck against
    // the whole of what was reported rather than against the fifteen shown.
    reported: ranked.reduce((sum, [, holding]) => sum + holding.shares, 0),
    // A manager any part of whose value could not be read carries none: half a
    // position priced and half not is a figure about neither.
    top: ranked.slice(0, TOP).map(([name, holding]) => ({
      name,
      shares: holding.shares,
      value: holding.unpriced ? 0 : holding.value,
    })),
  };
}

/*
 * Written as key-value pairs rather than one document.
 *
 * Eleven thousand companies is ten megabytes, which is a Worker's whole script
 * budget spent on a table most readers will never open. One key each is a
 * single read for the company actually being looked at, and the shape travels
 * in the key so a rebuilt quarter never sits behind the last one.
 *
 * `wrangler kv bulk put` takes ten thousand pairs a file, so they are chunked.
 */
// Read from the one place that defines it, so the script cannot write under a
// name the application does not read.
const HOLDERS_SHAPE = /HOLDERS_SHAPE = "([^"]+)"/.exec(readFileSync("lib/holders.ts", "utf8"))?.[1];
if (!HOLDERS_SHAPE) throw new Error("lib/holders.ts no longer declares HOLDERS_SHAPE.");
const pairs = Object.entries(out).map(([ticker, value]) => ({
  key: `holders:${HOLDERS_SHAPE}:${ticker}`,
  value: JSON.stringify(value),
}));

mkdirSync("data", { recursive: true });
const CHUNK = 9_000;
const files = [];
for (let index = 0; index < pairs.length; index += CHUNK) {
  const name = `data/holders-${files.length + 1}.json`;
  writeFileSync(name, JSON.stringify(pairs.slice(index, index + CHUNK)));
  files.push(name);
}
const bytes = files.reduce((sum, name) => sum + readFileSync(name).length, 0);
console.log(`${pairs.length.toLocaleString()} companies as of ${asOf}, ${(bytes / 1e6).toFixed(1)} MB across ${files.join(", ")}`);
console.log("\nUpload with:");
for (const name of files) {
  console.log(`  npx wrangler kv bulk put --binding DATASET_CACHE --remote ${name}`);
}
rmSync(join(work, "INFOTABLE.tsv"), { force: true });
