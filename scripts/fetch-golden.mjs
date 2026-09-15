/*
 * Rebuilds the reference companies the golden test reads.
 *
 *   SEC_USER_AGENT="you you@example.com" node scripts/fetch-golden.mjs [TICKER ...]
 *
 * Each is its SEC company-facts document cut to the concept names the adapter
 * reads (the same cut scripts/fetch-fixture.mjs makes), from 2010 on, gzipped:
 * a golden company has to take exactly the path it takes in production, and
 * thirty of them uncompressed would be tens of megabytes in the repository.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

export const GOLDEN = {
  AAPL: "0000320193", NVDA: "0001045810", MSFT: "0000789019", AMZN: "0001018724", MA: "0001141391",
  INTU: "0000896878", HIMS: "0001773751", ECL: "0000031462", VLO: "0001035002", URI: "0001067701",
  ANET: "0001596532", VZ: "0000732712", DAL: "0000027904", FTV: "0001659166", RSG: "0001060391",
  JPM: "0000019617", TRV: "0000086312", UNH: "0000731766", "BRK-B": "0001067983", IVZ: "0000914208",
  PLD: "0001045609", ASML: "0000937966", TSM: "0001046179", COST: "0000909832", CPRT: "0000900075",
  KO: "0000021344", BKNG: "0001075531", ADBE: "0000796343", LLY: "0000059478", CELH: "0001341766",
};

const agent = process.env.SEC_USER_AGENT;
if (!agent) {
  console.error("Set SEC_USER_AGENT to a contact string. The SEC refuses anonymous automated reads.");
  process.exit(1);
}
const adapters = ["../lib/adapters/sec.ts"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
const wanted = new Set([...adapters.matchAll(/"([A-Z][A-Za-z0-9]{6,})"/g)].map((match) => match[1]));
const from = "2010-01-01";
const asked = process.argv.slice(2);
const tickers = asked.length ? asked : Object.keys(GOLDEN);
mkdirSync(new URL("../tests/fixtures/golden/", import.meta.url), { recursive: true });

for (const ticker of tickers) {
  const cik = GOLDEN[ticker];
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": agent, Accept: "application/json" } });
  if (!response.ok) { console.error(`${ticker}: EDGAR returned ${response.status}`); continue; }
  const payload = await response.json();
  const facts = {};
  let kept = 0;
  for (const [taxonomy, concepts] of Object.entries(payload.facts ?? {})) {
    for (const [tag, concept] of Object.entries(concepts)) {
      if (!wanted.has(tag)) continue;
      const units = {};
      for (const [unit, entries] of Object.entries(concept.units ?? {})) {
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
  const body = gzipSync(JSON.stringify({ cik: payload.cik, entityName: payload.entityName, facts }), { level: 9 });
  writeFileSync(new URL(`../tests/fixtures/golden/${ticker.toLowerCase()}.json.gz`, import.meta.url), body);
  console.log(`${ticker}: ${kept} concepts, ${(body.length / 1024).toFixed(0)} KB`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}
