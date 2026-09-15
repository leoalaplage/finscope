import { claimKey, requestCompany, summaryKey } from "./dataset-cache";
import { MIDCAP } from "./midcap";
import { datasetCache } from "./runtime-env";
import { UNIVERSE } from "./universe";
import type { WatchlistSummary } from "./watchlist-summary";

/**
 * More companies ready before anybody asks for them.
 *
 * A company outside the S&P 500 is built the first time someone opens it: the
 * page waits, polls, and a reader who searched for a mid-cap sees "reading the
 * filings" where every index company answers at once. That wait is where the
 * impression that "there is nothing here" comes from.
 *
 * So two more lists are kept built, beside the index the screener already
 * rotates through: the S&P MidCap 400, and every company a reader has actually
 * opened that had to be built for them — the companies people search for,
 * found by their searching rather than guessed. Forty a run on the half-hourly
 * timer, a cursor walking the list, so the whole of it comes round in about
 * seven hours; a company is built when it is missing and rebuilt when its
 * figures were read more than three days ago. The filing watcher still brings
 * a company up to date within half an hour of a report for the index; these
 * are kept by this rotation instead.
 */

export const EXTRA_CURSOR_KEY = "warm-extra:v1:cursor";
export const OPENED_KEY = "opened:v1";
/** How many opened companies are remembered, newest first. */
export const OPENED_LIMIT = 300;
export const EXTRA_PER_RUN = 40;
export const EXTRA_STALE_HOURS = 72;

export interface Opened { ticker: string; at: string }

/** A newly opened company goes to the front; the list keeps its newest few hundred. */
export function rememberIn(opened: Opened[], ticker: string, at: string, limit = OPENED_LIMIT): Opened[] {
  const symbol = ticker.toUpperCase();
  return [{ ticker: symbol, at }, ...opened.filter((each) => each.ticker !== symbol)].slice(0, limit);
}

/** Everything kept warm by this rotation: opened companies first, then the mid-caps, never the index twice. */
export function extraTickers(opened: Opened[], indexTickers: Iterable<string> = UNIVERSE.map((member) => member.ticker)): string[] {
  const index = new Set([...indexTickers].map((ticker) => ticker.toUpperCase()));
  return [...new Set([...opened.map((each) => each.ticker), ...MIDCAP.map((member) => member.ticker)].map((ticker) => ticker.toUpperCase()))]
    .filter((ticker) => !index.has(ticker));
}

/** The next slice of a list from a cursor, wrapping round, and where the cursor goes after it. */
export function nextSlice<T>(list: readonly T[], cursor: number, limit = EXTRA_PER_RUN): { slice: T[]; next: number } {
  if (!list.length) return { slice: [], next: 0 };
  const start = ((cursor % list.length) + list.length) % list.length;
  const slice = Array.from({ length: Math.min(limit, list.length) }, (_, offset) => list[(start + offset) % list.length]);
  return { slice, next: (start + slice.length) % list.length };
}

/** Records a company a reader opened that had to be built for them. */
export async function rememberOpened(ticker: string): Promise<void> {
  const cache = datasetCache();
  if (!cache) return;
  try {
    const opened = ((await cache.get<Opened[]>(OPENED_KEY, "json")) ?? []);
    await cache.put(OPENED_KEY, JSON.stringify(rememberIn(opened, ticker, new Date().toISOString())));
  } catch { /* A missed note costs one company a slower first visit, once. */ }
}

export interface ExtraReport { built: string[]; rebuilt: string[]; failed: string[]; next: number; size: number }

/** One run of the rotation. */
export async function warmExtraSlice(origin: string, limit = EXTRA_PER_RUN, now = new Date()): Promise<ExtraReport | null> {
  const cache = datasetCache();
  if (!cache) return null;
  const opened = (await cache.get<Opened[]>(OPENED_KEY, "json").catch(() => null)) ?? [];
  const list = extraTickers(opened);
  const cursor = Number((await cache.get(EXTRA_CURSOR_KEY, "text").catch(() => null)) ?? 0) || 0;
  const { slice, next } = nextSlice(list, cursor, limit);
  const report: ExtraReport = { built: [], rebuilt: [], failed: [], next, size: list.length };
  const staleBefore = now.getTime() - EXTRA_STALE_HOURS * 3_600_000;

  for (const ticker of slice) {
    try {
      const digest = await cache.get<WatchlistSummary>(summaryKey(ticker), "json").catch(() => null);
      const readAt = digest ? Date.parse(digest.retrievedAt) : Number.NaN;
      const missing = !digest;
      if (!missing && Number.isFinite(readAt) && readAt >= staleBefore) continue;
      if (await cache.get(claimKey(ticker), "text").catch(() => null)) continue;
      await cache.put(claimKey(ticker), "1", { expirationTtl: 120 }).catch(() => undefined);
      const response = await requestCompany(origin, ticker, !missing);
      await response.body?.cancel();
      if (!response.ok) report.failed.push(ticker);
      else (missing ? report.built : report.rebuilt).push(ticker);
    } catch {
      report.failed.push(ticker);
    }
  }
  await cache.put(EXTRA_CURSOR_KEY, String(next)).catch(() => undefined);
  return report;
}
