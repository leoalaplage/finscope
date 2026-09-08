/*
 * Rebuilds a test fixture from a filer's own SEC company-facts document.
 *
 *   SEC_USER_AGENT="you you@example.com" node scripts/fetch-fixture.mjs XOM 0000034088
 *
 * The SEC serves every concept a filer has ever tagged — three to four
 * megabytes a company, most of it taxonomies this application never opens. A
 * fixture has to be small enough to live in the repository and complete enough
 * that the normalizer takes exactly the path it takes in production, so the cut
 * is made on the adapter's own list of concept names rather than on a guess,
 * and on the fields its schema actually parses.
 *
 * These fixtures existed before as downloads in /tmp that only the machine
 * which wrote them had. The tests reading them therefore passed on that machine
 * and failed everywhere else, which meant two real regressions were guarded
 * nowhere. Committing them is the point; this script is how they are refreshed.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [ticker, cik, from = "2015-01-01"] = process.argv.slice(2);
if (!ticker || !cik) {
  console.error("usage: node scripts/fetch-fixture.mjs <TICKER> <CIK> [from-date]");
  process.exit(1);
}

const agent = process.env.SEC_USER_AGENT;
if (!agent) {
  console.error("Set SEC_USER_AGENT to a contact string. The SEC refuses anonymous automated reads.");
  process.exit(1);
}

const adapter = readFileSync(new URL("../lib/adapters/sec.ts", import.meta.url), "utf8");
const wanted = new Set([...adapter.matchAll(/"([A-Z][A-Za-z0-9]{6,})"/g)].map((match) => match[1]));

const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`, {
  headers: { "User-Agent": agent, Accept: "application/json" },
});
if (!response.ok) {
  console.error(`EDGAR returned ${response.status} for CIK ${cik}.`);
  process.exit(1);
}
const payload = await response.json();

const facts = {};
let kept = 0;
for (const [taxonomy, concepts] of Object.entries(payload.facts ?? {})) {
  for (const [tag, concept] of Object.entries(concepts)) {
    if (!wanted.has(tag)) continue;
    const units = {};
    for (const [unit, entries] of Object.entries(concept.units ?? {})) {
      // `frame`, the concept label and its description are never read by the
      // adapter, and they are most of the bytes.
      const recent = entries
        .filter((entry) => (entry.end ?? "") >= from)
        .map(({ start, end, val, accn, fy, fp, form, filed }) => ({ start, end, val, accn, fy, fp, form, filed }));
      if (recent.length) units[unit] = recent;
    }
    if (!Object.keys(units).length) continue;
    (facts[taxonomy] ??= {})[tag] = { units };
    kept += 1;
  }
}

const out = new URL(`../tests/fixtures/${ticker.toLowerCase()}-facts.json`, import.meta.url);
writeFileSync(out, JSON.stringify({ cik: payload.cik, entityName: payload.entityName, facts }));
console.log(`${ticker}: ${kept} concepts from ${from} → ${out.pathname}`);
