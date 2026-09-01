import { DEFAULT_WATCHLIST } from "./company-registry";
import { datasetCache, selfFetcher } from "./runtime-env";
import { TICKER_PATTERN } from "./market-profile";
import type { WatchlistSummary } from "./watchlist-summary";

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
 * v14: an annual report on Form 20-F or 40-F is read like a 10-K, and a
 *     company that normalizes to no periods at all is an error rather than an
 *     empty answer. ASML files 623 US GAAP concepts, every one of them on a
 *     20-F, and came back as a company with nothing in it and a 200 status.
 * v15: a quarter republished as a comparative inside a later annual report is
 *     read, and dated by the year it belongs to rather than by the calendar
 *     year of its end. Microsoft's restated fiscal 2017 quarters were in the
 *     filings all along under the restated concept, carrying the filing's own
 *     `fp: "FY"`; seven companies gain quarters and no existing value moves.
 * v16: revenue is the total the filer states rather than the contract revenue
 *     inside it — Berkshire's 2025 moves from 247.2bn to the 371.4bn its own
 *     income statement carries — and the period-end share count is read from
 *     the balance sheet rather than only from the cover page, which gives ten
 *     of the audited filers a true count where market capitalisation had been
 *     falling back to the diluted weighted average. Both change stored facts.
 * v17: financial companies carry a verified economic type, and debt may be
 *     rebuilt from explicitly non-overlapping long- and short-term borrowing
 *     totals. JPMorgan's stated borrowing total includes both 435.2bn of
 *     long-term debt and 64.8bn of short-term borrowings; CME's published
 *     unsecured debt and finance-lease components are likewise kept distinct.
 * v18: `DebtCurrent` — debt due within a year, short-term borrowing and current
 *     maturities together — is read as a synonym for the current portion rather
 *     than as a separate short-term line, so one balance is counted once
 *     however many concepts name it. NVIDIA files 999m under both concepts and
 *     came out at 9,467m of borrowings against the 8,468m it states itself.
 *     A long-term total whose current side is a filed zero is now complete on
 *     its own, which is what Adobe publishes and what its invested capital and
 *     ROIC were withheld for want of.
 * v19: a dynamically resolved filer carries its official SEC SIC and therefore
 *     receives a financial economic type before any industrial ROIC, FCFF or
 *     enterprise-value measure is considered. Exact ticker matches are also
 *     prioritised before the twelve-result search limit.
 * v20: annual filings labelled `fp: Q4` carry the same comparative facts as FY
 *     filings, recovering Mastercard's reported 2017 quarters. Exact quarters
 *     originally filed under SalesRevenueNet also survive a later ASC 606
 *     annual-only restatement, recovering Microsoft's fiscal 2016 history
 *     without allocating or estimating the restatement.
 *     Total debt, in the same version, is the most complete filed reading at
 *     the balance-sheet date rather than only a pair of balances that prove
 *     each other. A sweep of 110 US filers found 27% with no debt total at all
 *     — Meta, Home Depot, Caterpillar, McDonald's, Thermo Fisher, Micron —
 *     none of them debt-free: each files a borrowing balance, and not the pair
 *     the older rule required. Net debt, enterprise value and the returns on
 *     capital move with it.
 * v21: facts are assigned to the actual annual window that contains them,
 *     rather than one modal fiscal-end month/day; instant balances are joined
 *     by exact date regardless of the filing's fy/fp label; and an exact
 *     originally reported quarterly basis survives any later annual-only
 *     restatement, not only the ASC 606 revenue transition. These rules remove
 *     generic 52/53-week, context-label and concept-migration gaps.
 * v22: splits are read from the filings. A filer declares its ratio —
 *     Amazon's twenty-for-one on 27 May 2022 — and the ratio is applied where
 *     it explains a break in that company's own share counts, which extends
 *     the correction from the twenty-one curated companies to any filer a
 *     reader types. Amazon's 2019 earnings per share moves from $22.99 to
 *     $1.15, and Broadcom, Walmart, Lam Research, Alibaba, Canadian Pacific
 *     and Flowserve are restated onto one basis with it.
 */
export const KEY_VERSION = "v22";

/**
 * Versions whose stored data may still be served while this one is being built.
 *
 * Changing the key version empties the cache for every company at once, and
 * rebuilding twenty-one filers from raw XBRL takes far longer than the platform
 * will allow in one go — so every bump has meant a stretch of watchlist cards
 * reading "Building financials…" and, twice now, a throttled Worker. Serving
 * the previous copy in the meantime removes the outage entirely: the reader
 * sees the company they asked for while the new one is built behind them.
 *
 * Listed rather than assumed, and per bump. A version that *adds* periods
 * without moving any existing figure — which v15 was, measured against the raw
 * filings for all twenty-one companies — is safe to stand in for. One that
 * corrects a wrong number is not, and leaves this empty so nothing serves the
 * figure it exists to replace. v17 therefore lists nothing: a v16 copy has the
 * old generic financial classification and lacks the new borrowing totals, so
 * serving it would make the interface disagree with the new fail-closed rules.
 * v18 likewise cannot serve v17 while rebuilding: v17 has no reading of the
 * broad current-debt concept at all, so it both withholds Adobe's borrowings
 * and, where a filer names one current balance twice, would have counted it
 * twice.
 * v19 cannot serve v18 either: a dynamic bank cached by v18 is still labelled
 * as an operating company and can expose industrial ratios that v19 withholds.
 * The cost is the familiar one: cards read
 * "Building financials…" until the warm-up has been round the watchlist.
 */
const SERVEABLE_WHILE_BUILDING: Array<{ version: string; shape: string }> = [];

/**
 * The same key under a version we are willing to serve from while rebuilding.
 *
 * A digest is addressed by two things, the dataset version *and* the shape of
 * the digest itself, and the fallback used to pair an older version with the
 * *current* shape — a key that has never existed whenever a bump moved both,
 * which is most of them. So the mechanism built to keep cards populated during
 * a rebuild could not find anything to populate them with, and every bump
 * emptied the watchlist whether or not the previous copy was safe to show. The
 * shape a version was written under is now recorded beside it.
 */
export function fallbackDatasetKeys(ticker: string) {
  return SERVEABLE_WHILE_BUILDING.map(({ version }) => `company:${version}:${ticker.toUpperCase()}`);
}
export function fallbackSummaryKeys(ticker: string) {
  return SERVEABLE_WHILE_BUILDING.map(({ version, shape }) => `summary:${version}.${shape}:${ticker.toUpperCase()}`);
}

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
 * s4: carries when the filings were read and whether the company is a financial
 *     institution — the first so the timer can find a stale company without
 *     reading the dataset, the second so a card never states a free-cash-flow
 *     margin for a broker.
 * s5: gross profit is read as the subtraction it is where the filer publishes
 *     both sides and no subtotal, so six companies — Alphabet and Meta among
 *     them — have a gross margin in their screener row for the first time.
 *     Recomputed from the stored dataset; no filing is parsed again for it.
 * s6: the screener's price inputs carry the currency the statements are kept in
 *     and which share count they are on, so the columns finished in the browser
 *     refuse a quote in another currency instead of dividing across two.
 * s7: the current period is the later of TTM and annual. A stale historical TTM
 *     no longer wins merely because one exists, so cached cards and QS rows use
 *     the same genuinely current period as the company page.
 */
const SUMMARY_SHAPE = "s7";

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

/**
 * How old a cached company may be before the timer rebuilds it.
 *
 * The lifetime of a key and the age at which it is refreshed are two different
 * questions, and conflating them is what made a set of published results
 * invisible for up to a week. `CACHE_SECONDS` answers "how long may this be
 * served if everything else fails"; this answers "when should it be replaced".
 *
 * Twenty hours, against crons six hours apart, means a company built at 07:00
 * is eligible again at the following 07:00 run: once a day, every day, with no
 * run rebuilding what the previous one just did. A quarterly filing is
 * therefore on screen within a day of being published rather than within a
 * week, and the daily cost is exactly what the design always intended — one
 * rebuild per company per day.
 */
export const REFRESH_AFTER_MS = 20 * 3_600_000;

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
  const asked = [...new Set((param ?? "").split(",").map((item) => item.trim().toUpperCase()).filter((item) => TICKER_PATTERN.test(item)))];
  return asked.length ? asked.slice(0, WATCHLIST_LIMIT) : fallback;
}

/**
 * Whether a company is cached, and whether that copy is still current.
 *
 * KV has no existence check, so this asks for the value — but as a stream, and
 * cancels it. Asking for `"text"` instead, which is what this used to do, pulls
 * the entire five-megabyte dataset into the isolate to answer a yes/no
 * question, and doing that twenty-one times in one warm run allocated over a
 * hundred megabytes against a hundred-and-twenty-eight megabyte ceiling.
 *
 * Both keys are checked. The watchlist reads the digest, and a dataset cached
 * without one would leave that company's card blank forever.
 *
 * The digest is also where the answer to "how old is this" comes from. It is a
 * few hundred bytes and carries the moment the filings were read, so the age of
 * a five-megabyte dataset costs one small read rather than parsing the dataset
 * back. A digest written before that field existed parses to `NaN` and is
 * reported stale, which rebuilds it once and then behaves.
 */
type CacheState = "missing" | "stale" | "current";

/**
 * Whether a stored digest is recent enough that its dataset need not be built
 * again. A digest from before build times were recorded reads as `NaN` and is
 * reported stale, which rebuilds it once and then behaves.
 */
export function digestIsCurrent(stored: string | null): boolean {
  if (!stored) return false;
  let builtAt = Number.NaN;
  try {
    builtAt = Date.parse((JSON.parse(stored) as WatchlistSummary).retrievedAt);
  } catch {
    // An unreadable digest is one worth writing again.
  }
  return Number.isFinite(builtAt) && Date.now() - builtAt < REFRESH_AFTER_MS;
}

async function cacheState(cache: KVNamespace, ticker: string): Promise<CacheState> {
  const dataset = await cache.get(datasetKey(ticker), "stream");
  if (!dataset) return "missing";
  await dataset.cancel();
  const stored = await cache.get(summaryKey(ticker), "text");
  if (!stored) return "missing";
  return digestIsCurrent(stored) ? "current" : "stale";
}

/** The watchlist companies that have no usable cache entry at all. */
export async function missingTickers(
  tickers = DEFAULT_WATCHLIST.filter((company) => company.resolutionStatus !== "unresolved").map((company) => company.ticker),
): Promise<string[]> {
  return (await tickersNeedingWork(tickers)).missing;
}

/**
 * What a reader's own watchlist needs building, and what it needs refreshing.
 *
 * The daily timer walks the built-in list, so a company the reader added
 * themselves is refreshed by nothing at all: it was built once, on the visit
 * that added it, and then aged for ever. Costco came back reading filings from
 * six days earlier while every built-in company was current — the same
 * staleness the timer exists to prevent, for exactly the companies the timer
 * has never heard of.
 *
 * Missing and stale are kept apart because they are answered differently. A
 * missing company leaves an empty card and is worth building on the reader's
 * next request; a stale one has a perfectly good copy on screen, so at most one
 * per request is refreshed behind it.
 */
export async function tickersNeedingWork(tickers: string[]): Promise<{ missing: string[]; stale: string[] }> {
  const cache = datasetCache();
  if (!cache) return { missing: [], stale: [] };
  const missing: string[] = []; const stale: string[] = [];
  for (const ticker of tickers) {
    try {
      const state = await cacheState(cache, ticker);
      if (state === "missing") missing.push(ticker);
      else if (state === "stale") stale.push(ticker);
    } catch {
      // An unreadable key is a key worth rebuilding.
      missing.push(ticker);
    }
  }
  return { missing, stale };
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
 *
 * `rebuild` is what makes refreshing a stale company possible at all. The
 * endpoint answers a cached copy before it considers doing any work — which is
 * the whole point of the cache — so a warm request for a company that is
 * present but out of date would be served the very copy it was sent to
 * replace, and the timer would report success having changed nothing.
 */
async function requestCompany(origin: string, ticker: string, rebuild = false): Promise<Response> {
  const headers: Record<string, string> = { "X-FinScope-Warm": "1" };
  if (rebuild) headers["X-FinScope-Rebuild"] = "1";
  const request = new Request(new URL(`/api/company/${encodeURIComponent(ticker)}`, origin), { headers });
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
export async function warmSomeMissing(origin: string, batch = 3, tickers?: string[], staleBudget = 1): Promise<WarmReport> {
  const report: WarmReport = { warmed: [], failed: [] };
  const cache = datasetCache();
  if (!cache) return report;

  // Whichever companies the reader asked about, not whichever ones this file
  // happens to list: a company they added themselves is missing far more often
  // than a built-in one, and is the only kind nothing else will ever build —
  // or refresh, which is why one aged company comes along for the ride.
  const asked = tickers ?? DEFAULT_WATCHLIST.filter((company) => company.resolutionStatus !== "unresolved").map((company) => company.ticker);
  const { missing, stale } = await tickersNeedingWork(asked);
  const refresh = stale.slice(0, staleBudget);
  const work: Array<{ ticker: string; rebuild: boolean }> = [
    ...missing.map((ticker) => ({ ticker, rebuild: false })),
    ...refresh.map((ticker) => ({ ticker, rebuild: true })),
  ];
  if (!work.length) return report;
  await recordWarm(cache, `warm-on-read: ${missing.length} missing, ${stale.length} stale, trying ${work.slice(0, batch).map((item) => item.ticker).join(",")} via ${origin}`);
  for (const { ticker, rebuild } of work) {
    if (report.warmed.length + report.failed.length >= batch) break;
    try {
      if (await cache.get(claimKey(ticker), "text")) continue;
      await cache.put(claimKey(ticker), "1", { expirationTtl: CLAIM_SECONDS });
    } catch {
      // Without a working claim, building anyway risks duplicated work but
      // never a wrong answer. An empty watchlist is the worse outcome.
    }
    try {
      const response = await requestCompany(origin, ticker, rebuild);
      // The endpoint writes to KV before it answers, so the body is of no use
      // here. Cancelling it avoids buffering five megabytes to discard them.
      await response.body?.cancel();
      if (response.ok) report.warmed.push(ticker);
      else report.failed.push({ ticker, reason: `HTTP ${response.status}` });
    } catch (error) {
      report.failed.push({ ticker, reason: error instanceof Error ? error.message : "unreachable" });
    }
  }
  await recordWarm(cache, `warm-on-read done: warmed ${report.warmed.join(",") || "none"}; failed ${report.failed.map((item) => `${item.ticker} (${item.reason})`).join(",") || "none"}`);
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
/**
 * How many companies one run may build or rebuild.
 *
 * Not an optimisation — a safety limit, learned the hard way. Rebuilding
 * eighteen filers inside ninety seconds got this Worker throttled outright:
 * every subsequent request was refused within ten milliseconds of CPU, and the
 * site answered "Worker exceeded resource limits" for several minutes —
 * including the prerendered front page, which costs no CPU of its own and is
 * refused anyway once the account is being throttled.
 *
 * Refreshing the whole watchlist in one pass would therefore have taken the
 * site down at 07:00 every morning. Six per run against four runs a day covers
 * twenty-four companies, so every one is still refreshed daily — just never
 * more than six at a time. A company skipped for budget is not a failure: its
 * stored copy is perfectly serveable, it is simply a few hours older than the
 * ideal, and the next run takes it.
 *
 * A company with nothing cached at all is outside this budget. That one has no
 * copy to serve and a reader is looking at an empty card.
 */
const REBUILD_BUDGET = 6;

export interface WarmPacing { paceMs?: number; retryMs?: number; retries?: number; rebuildBudget?: number }

export async function warmWatchlist(
  origin: string,
  tickers = DEFAULT_WATCHLIST.map((company) => company.ticker),
  pacing: WarmPacing = {},
): Promise<WarmReport> {
  const { paceMs = PACE_MS, retryMs = RETRY_MS, retries = RETRIES, rebuildBudget = REBUILD_BUDGET } = pacing;
  const report: WarmReport = { warmed: [], failed: [] };
  const cache = datasetCache();
  let rebuilt = 0;

  for (const ticker of tickers) {
    /*
     * Only a copy that is both present and recent is left alone.
     *
     * This used to skip anything already cached, on the reasoning that the key
     * version changes whenever normalization changes meaning. That is true and
     * beside the point: the version tracks *our* semantics, not the company's
     * filings. With nothing else refreshing a key, the only thing that ever
     * replaced a dataset was its own week-long expiry — so Veeva published a
     * quarter the day after its build and the site showed the previous quarter
     * for the rest of the week, which is exactly the day a reader looks.
     */
    const state = cache ? await cacheState(cache, ticker) : "missing";
    if (state === "current") { report.warmed.push(ticker); continue; }
    /*
     * The budget covers the whole run, not only the aged half.
     *
     * An aged copy is still a good copy, and spending the rest of the run on
     * it — and getting the whole Worker throttled for it — is not a trade
     * worth making when the next run is six hours away. But a *missing* one is
     * every bit as expensive to build, and a key-version change makes every
     * company missing at once. Bounding only the aged half meant the first run
     * after such a change tried all twenty-one, which is exactly the burst
     * that refused every request to this Worker for four minutes.
     *
     * A company skipped for budget is not a failure: it is either serveable
     * from an older copy or already reported as missing to the reader, and the
     * next run takes it.
     */
    if (rebuilt >= rebuildBudget) { report.warmed.push(ticker); continue; }
    rebuilt += 1;
    let reason = "";
    // A refusal means the platform is throttling us, not that the company is
    // broken, so the wait before trying again is long rather than immediate.
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) await wait(retryMs);
      try {
        const response = await requestCompany(origin, ticker, state === "stale");
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
