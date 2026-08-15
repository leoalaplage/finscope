import { DEFAULT_WATCHLIST } from "./company-registry";
import { datasetCache } from "./runtime-env";

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
 */
export const KEY_VERSION = "v9";

/** A day. The filings behind a dataset change quarterly at most. */
export const CACHE_SECONDS = 86_400;

export function datasetKey(ticker: string) {
  return `company:${KEY_VERSION}:${ticker.toUpperCase()}`;
}

export interface WarmReport { warmed: string[]; failed: Array<{ ticker: string; reason: string }> }

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
export async function warmWatchlist(origin: string, tickers = DEFAULT_WATCHLIST.map((company) => company.ticker)): Promise<WarmReport> {
  const report: WarmReport = { warmed: [], failed: [] };
  const cache = datasetCache();

  for (const ticker of tickers) {
    // A key already written under this version is current by construction:
    // the version changes whenever meaning does.
    if (cache && await cache.get(datasetKey(ticker), "text")) { report.warmed.push(ticker); continue; }
    let reason = "";
    // Two attempts. A refused invocation is usually a busy isolate rather than
    // a broken company, and the second attempt lands somewhere else.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(new URL(`/api/company/${encodeURIComponent(ticker)}`, origin), { headers: { "X-FinScope-Warm": "1" } });
        if (response.ok) { await response.arrayBuffer(); reason = ""; break; }
        reason = `HTTP ${response.status}`;
      } catch (error) {
        reason = error instanceof Error ? error.message : "unreachable";
      }
    }
    if (reason) report.failed.push({ ticker, reason }); else report.warmed.push(ticker);
  }
  return report;
}
