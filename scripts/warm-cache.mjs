/*
 * Refills the dataset cache after a version bump, at a rate the Worker survives.
 *
 * Changing `KEY_VERSION` empties every company at once, and the four daily cron
 * runs rebuild six each — a day to come back. Meanwhile the watchlist reads
 * "Building financials…", which is what a reader reports as the site losing
 * their companies.
 *
 * Building one costs the Worker 200-500ms of CPU, and Cloudflare refuses
 * *everything* for minutes once a burst exhausts the allowance. Measured on
 * 1 September 2026: one build every 18 seconds ran fine for fifteen companies
 * and then hit the wall, and the script kept knocking every 18 seconds while
 * the door stayed shut — thirteen refusals in a row. So the pause between
 * builds is generous, and a refusal is answered by standing back for minutes
 * rather than trying again immediately.
 *
 *   node scripts/warm-cache.mjs NVDA AAPL GOOGL …
 *   node scripts/warm-cache.mjs --origin https://finscope.example.workers.dev
 */
const args = process.argv.slice(2);
const originFlag = args.indexOf("--origin");
const origin = originFlag === -1 ? "https://finscope-financial-research.leoalaplage.workers.dev" : args[originFlag + 1];
// `indexOf` returns -1 when the flag is absent, and -1 + 1 is 0 — which
// quietly dropped the first ticker of every call that did not pass an origin.
// Found by counting: five tickers in, "4/4 ready" out.
const skip = originFlag === -1 ? -1 : originFlag + 1;
const tickers = args.filter((value, index) => index !== originFlag && index !== skip && !value.startsWith("--"));

if (!tickers.length) {
  console.error("Usage: node scripts/warm-cache.mjs TICKER [TICKER…] [--origin https://…]");
  process.exit(1);
}

const BETWEEN_MS = 30_000;
const AFTER_REFUSAL_MS = 180_000;
const ATTEMPTS = 4;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let built = 0;
let refused = [];
for (const [index, ticker] of tickers.entries()) {
  let done = false;
  for (let attempt = 1; attempt <= ATTEMPTS && !done; attempt++) {
    let status = 0;
    let bytes = 0;
    try {
      const response = await fetch(`${origin}/api/company/${encodeURIComponent(ticker)}`);
      status = response.status;
      bytes = (await response.arrayBuffer()).byteLength;
    } catch {
      status = 0;
    }
    if (status === 200) {
      console.log(`${ticker} ready (${Math.round(bytes / 1e6 * 10) / 10}MB, attempt ${attempt})`);
      built++; done = true;
    } else if (status === 502) {
      // The filer itself cannot be built — no feed, IFRS, no US GAAP facts.
      console.log(`${ticker} cannot be built (${status})`);
      done = true;
    } else {
      console.log(`${ticker} refused (${status || "network"}), standing back ${AFTER_REFUSAL_MS / 1000}s`);
      await pause(AFTER_REFUSAL_MS);
    }
  }
  if (!done) refused.push(ticker);
  if (index < tickers.length - 1) await pause(BETWEEN_MS);
}
console.log(`${built}/${tickers.length} ready${refused.length ? `; still refused: ${refused.join(" ")}` : ""}`);
