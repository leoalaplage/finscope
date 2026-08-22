import { DEFAULT_WATCHLIST } from "./company-registry";
import { datasetCache, selfFetcher } from "./runtime-env";

/**
 * The cache key version.
 *
 * Bump it whenever normalization changes *meaning* — a new concept, a corrected
 * sign, a different quarter rule — so a dataset is never served under semantics
 * it was not built with. Changing it twice within one piece of work is the
 * mistake to avoid: the first half of a change warms the new key and the second
 * half then reads its own stale output back.
 *
 * v2: capex falls back to productive-asset and software concepts.
 * v3: diluted share counts are recovered from reported EPS.
 * v4: net income prefers income attributable to common; reported EPS is
 *     split-adjusted like every other per-share value.
 * v5: total equity is mapped, which invested capital and ROIC depend on.
 * v6: a share count recovered from EPS carries its filing date, so a split is
 *     not applied to a figure the filer had already restated.
 * v7: derived quarters may not mix revenue concepts; CME's 2012 split is known.
 * v8: a directly reported fourth quarter is preferred over subtraction, and an
 *     impossible derived quarter is dropped instead of published.
 * v9: total assets, goodwill, acquired intangibles, interest expense and
 *     dividends per share are carried; and total debt is the sum of its current
 *     and non-current portions rather than whichever one the filer tagged.
 * v10: balance-sheet detail (total liabilities, PP&E, inventory, receivables,
 *     payables, investments, retained earnings) and the operating-expense
 *     breakdown, which the statement diagrams and the balance-sheet view need.
 * v11: a dividend per share tagged as a rate against every context is rebuilt
 *     from its quarters, and a share count is recovered from the dividend for
 *     filers publishing neither a share count nor diluted earnings per share.
 * v12: a quarter uses the concept its own annual figure uses. Mastercard tags
 *     its quarters with a gross contract-revenue concept while its year uses
 *     net `Revenues`, so its quarterly and trailing revenue — and every margin,
 *     per-share and valuation figure built on one — was about 40% too high.
 * v13: a quarter may be built from a concept other than its year's, where that
 *     concept is provably the same measure. Adopting the revenue standard in
 *     2018 made filers restate a year under a new concept while its quarters
 *     kept the old one, and seventeen of the twenty-one companies here lost
 *     about five quarters to it — Apple two whole years.
 */
export const KEY_VERSION = "v13";

/**
 * A week, refreshed daily. The gap between the two is the point.
 *
 * The filings behind a dataset change quarterly at most, so a day-old copy is
 * indistinguishable from a fresh one. What is very distinguishable is an absent
 * one: with the lifetime set to a day and the warm running once a day, every
 * key expired at the very moment its replacement was due, so a single missed or
 * slow run — and Cloudflare does not promise to deliver a cron on time — left
 * the whole watchlist blank until the next day. A week of lifetime against a
 * day of refresh means six missed runs in a row before a reader notices
 * anything at all.
 */
export const CACHE_SECONDS = 604_800;

export function datasetKey(ticker: string) {
  return `company:${KEY_VERSION}:${ticker.toUpperCase()}`;
}

/**
 * What the digest itself contains, versioned apart from the dataset.
 *
 * A digest depends on two things: the meaning of the periods underneath it, and
 * the set of figures it carries. The first is `KEY_VERSION`; this is the
 * second, so adding a field rebuilds the digests without forcing every company
 * to be parsed from raw XBRL again.
 *
 * s2: carries each company's QS Screener row.
 * s3: carries the three five-year figures the watchlist card shows — free cash
 *     flow margin after stock-based compensation, cash return on capital, and
 *     the compound growth of free cash flow per share.
 */
const SUMMARY_SHAPE = "s3";

/**
 * The card-sized digest stored beside each dataset.
 *
 * Carries the dataset's version too, so a summary is never read back under
 * semantics it was not built with.
 */
export function summaryKey(ticker: string) {
  return `summary:${KEY_VERSION}.${SUMMARY_SHAPE}:${ticker.toUpperCase()}`;
}

export interface WarmReport { warmed: string[]; failed: Array<{ ticker: string; reason: string }> }

/** A plausible exchange symbol: letters, digits, and the dot and dash classes use. */
const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

/**
 * How many companies one reader may ask to be looked up at once.
 *
 * The list arrives in a query string, so it is untrusted; this is what stops a
 * hand-written URL from asking the Worker to read a thousand keys.
 */
export const WATCHLIST_LIMIT = 60;

/**
 * The companies a reader actually follows, read from an untrusted query string.
 *
 * The watchlist used to be exactly the list in `company-registry`, so both the
 * watchlist endpoint and the warm behind it read that file and nothing else. A
 * company the reader added themselves therefore never had a digest written for
 * it and never had one returned: its card read "Financials not loaded" for
 * ever, its figures stayed empty even once "Load all" had fetched the dataset,
 * and every load paid the full twelve-megabyte parse because nothing warmed it.
 *
 * Bounded on the way in — a ticker's shape, no duplicates, a modest count — and
 * falling back to the built-in list when the parameter is absent or unusable,
 * which is what an older client sends.
 */
export function requestedTickers(param: string | null | undefined, fallback: string[]): string[] {
  const asked = [...new Set((param ?? "").split(",").map((item) => item.trim().toUpperCase()).filter((item) => TICKER.test(item)))];
  return asked.length ? asked.slice(0, WATCHLIST_LIMIT) : fallback;
}

/**
 * Whether a company is already cached, without reading it.
 *
 * KV has no existence check, so this asks for the value — but as a stream, and
 * cancels it. Asking for `"text"` instead, which is what this used to do, pulls
 * the entire five-megabyte dataset into the isolate to answer a yes/no
 * question, and doing that twenty-one times in one warm run allocated over a
 * hundred megabytes against a hundred-and-twenty-eight megabyte ceiling.
 *
 * Both keys are checked. The watchlist reads the digest, and a dataset cached
 * without one would leave that company's card blank forever.
 */
async function isCached(cache: KVNamespace, ticker: string) {
  const dataset = await cache.get(datasetKey(ticker), "stream");
  if (!dataset) return false;
  await dataset.cancel();
  // The digest is a few hundred bytes, so reading it outright costs nothing.
  return (await cache.get(summaryKey(ticker), "text")) != null;
}

/** The watchlist companies that have no usable cache entry yet. */
export async function missingTickers(
  tickers = DEFAULT_WATCHLIST.filter((company) => company.resolutionStatus !== "unresolved").map((company) => company.ticker),
): Promise<string[]> {
  const cache = datasetCache();
  if (!cache) return [];
  const missing: string[] = [];
  for (const ticker of tickers) {
    try {
      if (!(await isCached(cache, ticker))) missing.push(ticker);
    } catch {
      // An unreadable key is a key worth rebuilding.
      missing.push(ticker);
    }
  }
  return missing;
}

/**
 * How long a ticker is claimed for while someone is building it.
 *
 * Requests arriving together must not each rebuild the same company, so a
 * claim is written before the build starts. It outlives the build by a wide
 * margin because KV reads may lag a write by up to a minute: a claim that
 * expired as soon as the build finished would be invisible to the very
 * requests it exists to hold off.
 */
const CLAIM_SECONDS = 120;

function claimKey(ticker: string) {
  return `warming:${KEY_VERSION}:${ticker.toUpperCase()}`;
}

/**
 * Asks this Worker to build one company, through whichever door works.
 *
 * The service binding in production, the global fetch under `vite dev`. See
 * selfFetcher for why the two cannot be the same call.
 */
async function requestCompany(origin: string, ticker: string): Promise<Response> {
  const request = new Request(new URL(`/api/company/${encodeURIComponent(ticker)}`, origin), { headers: { "X-FinScope-Warm": "1" } });
  const self = selfFetcher();
  return self ? self.fetch(request) : fetch(request);
}

/** Where the last few warm outcomes are left for a human to read. */
export const WARM_LOG_KEY = "warm-log";

/**
 * Leaves a note about what the warm just did, in the cache it is filling.
 *
 * A background job that fails silently is a job nobody knows is broken, and
 * that is precisely how this cache came to be nearly empty in production while
 * every page insisted the data was merely "not loaded". `console.log` goes to a
 * log stream nobody is watching and which cannot be read after the fact; a KV
 * key can be read at any time with `wrangler kv key get`.
 *
 * Best-effort and bounded: this is diagnostics, and diagnostics must never be
 * the reason the thing it is diagnosing fails.
 */
async function recordWarm(cache: KVNamespace, line: string) {
  try {
    const stamped = `${new Date().toISOString()} ${line}`;
    const previous = (await cache.get(WARM_LOG_KEY, "text")) ?? "";
    const lines = [stamped, ...previous.split("\n").filter(Boolean)].slice(0, 20);
    await cache.put(WARM_LOG_KEY, lines.join("\n"), { expirationTtl: CACHE_SECONDS });
  } catch {
    // Never let the notebook stop the work.
  }
}

/**
 * Builds a few of the missing companies, on the way to serving a request.
 *
 * The daily timer is how the cache is *meant* to be filled, but a timer is a
 * promise about the future and a reader is here now. Before this existed the
 * home page's numbers depended entirely on that timer having run: a fresh cache
 * — a new key version, a first deploy, or `npm run dev`, whose Miniflare
 * namespace no timer has ever touched — served twenty-one cards reading
 * "Financials not loaded" and no amount of waiting changed it.
 *
 * A few at a time, sequentially, and never on the reader's critical path: this
 * runs inside `waitUntil` after the response has gone out. The batch is small
 * because a fetch invocation is not a cron and cannot be relied on to live for
 * two minutes, and because building companies four-deep in parallel is exactly
 * what exhausts an isolate's CPU budget. The client polls while cards are still
 * missing, so each poll advances the batch and the page fills in over a handful
 * of round trips rather than one long one.
 */
export async function warmSomeMissing(origin: string, batch = 3, tickers?: string[]): Promise<WarmReport> {
  const report: WarmReport = { warmed: [], failed: [] };
  const cache = datasetCache();
  if (!cache) return report;

  // Whichever companies the reader asked about, not whichever ones this file
  // happens to list: a company they added themselves is missing far more often
  // than a built-in one, and is the only kind nothing else will ever build.
  const missing = await missingTickers(tickers);
  if (missing.length) await recordWarm(cache, `warm-on-read: ${missing.length} missing, trying ${missing.slice(0, batch).join(",")} via ${origin}`);
  for (const ticker of missing) {
    if (report.warmed.length + report.failed.length >= batch) break;
    try {
      if (await cache.get(claimKey(ticker), "text")) continue;
      await cache.put(claimKey(ticker), "1", { expirationTtl: CLAIM_SECONDS });
    } catch {
      // Without a working claim, building anyway risks duplicated work but
      // never a wrong answer. An empty watchlist is the worse outcome.
    }
    try {
      const response = await requestCompany(origin, ticker);
      // The endpoint writes to KV before it answers, so the body is of no use
      // here. Cancelling it avoids buffering five megabytes to discard them.
      await response.body?.cancel();
      if (response.ok) report.warmed.push(ticker);
      else report.failed.push({ ticker, reason: `HTTP ${response.status}` });
    } catch (error) {
      report.failed.push({ ticker, reason: error instanceof Error ? error.message : "unreachable" });
    }
  }
  if (missing.length) await recordWarm(cache, `warm-on-read done: warmed ${report.warmed.join(",") || "none"}; failed ${report.failed.map((item) => `${item.ticker} (${item.reason})`).join(",") || "none"}`);
  return report;
}

/**
 * How long to wait between companies, and before trying a refused one again.
 *
 * Building a company from raw XBRL is expensive, and firing twenty-one of those
 * back to back gets the whole Worker throttled: after a burst, requests start
 * coming back refused within ten milliseconds of CPU, before they have even
 * fetched anything. Spacing them out keeps the average low enough that each one
 * is allowed to finish. Nobody is waiting on this — it runs on a timer.
 */
const PACE_MS = 3_000;
const RETRY_MS = 20_000;
const RETRIES = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rebuilds every watchlist company into the cache, one at a time.
 *
 * Each company is fetched through this Worker's own HTTP endpoint rather than
 * normalized inline. That is deliberate: normalizing a large filer is the most
 * expensive thing this application does, and running twenty-one of them inside
 * a single invocation is precisely the pattern that exhausts an isolate's CPU
 * budget and makes it refuse the rest. One subrequest per company gives each
 * its own budget, and a failure costs one company rather than the batch.
 *
 * Sequential on purpose. There is no deadline to beat — this runs on a timer
 * with nobody waiting — and the SEC asks automated clients to be gentle.
 */
export interface WarmPacing { paceMs?: number; retryMs?: number; retries?: number }

export async function warmWatchlist(
  origin: string,
  tickers = DEFAULT_WATCHLIST.map((company) => company.ticker),
  pacing: WarmPacing = {},
): Promise<WarmReport> {
  const { paceMs = PACE_MS, retryMs = RETRY_MS, retries = RETRIES } = pacing;
  const report: WarmReport = { warmed: [], failed: [] };
  const cache = datasetCache();

  for (const ticker of tickers) {
    // A key already written under this version is current by construction:
    // the version changes whenever meaning does.
    if (cache && await isCached(cache, ticker)) { report.warmed.push(ticker); continue; }
    let reason = "";
    // A refusal means the platform is throttling us, not that the company is
    // broken, so the wait before trying again is long rather than immediate.
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) await wait(retryMs);
      try {
        const response = await requestCompany(origin, ticker);
        // The endpoint has already written to KV by the time it answers, so
        // the body is dead weight — five megabytes of it, per company.
        await response.body?.cancel();
        if (response.ok) { reason = ""; break; }
        reason = `HTTP ${response.status}`;
      } catch (error) {
        reason = error instanceof Error ? error.message : "unreachable";
      }
    }
    if (reason) report.failed.push({ ticker, reason }); else report.warmed.push(ticker);
    await wait(paceMs);
  }
  if (cache) await recordWarm(cache, `cron via ${origin}: warmed ${report.warmed.length}/${tickers.length}` +
    (report.failed.length ? `; failed ${report.failed.map((item) => `${item.ticker} (${item.reason})`).join(",")}` : ""));
  return report;
}
