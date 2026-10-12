import { searchSecCompanies } from "../adapters/sec";
import { datasetCache, keepAlive, selfFetcher } from "../runtime-env";
import { UNIVERSE, universeMember } from "../universe";
import type { SegmentData } from "./build";
import { fetchSegments } from "./source";

/**
 * Where a company's segments are kept (lib/segments/build.ts).
 *
 * A build reads a dozen filings — some forty requests to EDGAR — so it is done
 * once and stored, then read back for three days. An older copy is served at
 * once and rebuilt behind it. The half-hourly timer builds two members of the
 * index a run, largest first, each in an invocation of its own through the
 * service binding, so a reader rarely waits for one.
 */

const segmentsKey = (ticker: string) => `segments:v1:${ticker.toUpperCase()}`;
const CURSOR_KEY = "segments-cursor:v1";
const FRESH_MS = 3 * 86_400_000;
/** A build that missed a report is served, and tried again a quarter of an hour later. */
const RETRY_MS = 15 * 60_000;
/** Kept a month at most: a company that stops filing should not show segments forever. */
const KEEP_SECONDS = 30 * 86_400;

/** The largest companies first, so the ones most read are built first after a deploy. */
export const SEGMENT_PRIORITY = ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "AVGO", "BRK.B", "TSLA", "JPM", "LLY", "V", "NFLX", "XOM", "COST", "MA", "WMT", "UNH", "PG", "JNJ", "ORCL", "HD", "ABBV", "BAC", "KO", "PLTR", "AMD", "CRM", "CVX", "CSCO"];

async function cikOf(ticker: string): Promise<string | null> {
  const member = universeMember(ticker);
  if (member) return member.cik;
  const dashed = ticker.toUpperCase().replace(/\./g, "-");
  const found = (await searchSecCompanies(ticker)).find((entry) => entry.ticker.toUpperCase() === ticker.toUpperCase() || entry.ticker.toUpperCase() === dashed);
  return found?.cik ?? null;
}

export async function buildAndStore(ticker: string): Promise<SegmentData | null> {
  const cik = await cikOf(ticker);
  if (!cik) return null;
  const data = await fetchSegments(ticker, cik);
  // A build that read no filing is a failed read, not a company without segments.
  if (!data.filings.length) throw new Error("EDGAR did not answer.");
  // Nor does a partial build replace a complete one.
  const held = data.complete === false ? await datasetCache()?.get<SegmentData>(segmentsKey(ticker), "json").catch(() => null) : null;
  if (held && held.complete !== false && held.filings.length >= data.filings.length) return held;
  await datasetCache()?.put(segmentsKey(ticker), JSON.stringify(data), { expirationTtl: KEEP_SECONDS }).catch(() => undefined);
  return data;
}

export async function getSegments(ticker: string, rebuild = false): Promise<SegmentData | null> {
  if (!rebuild) {
    const stored = await datasetCache()?.get<SegmentData>(segmentsKey(ticker), "json").catch(() => null);
    if (stored) {
      if (Date.now() - Date.parse(stored.builtAt) > (stored.complete === false ? RETRY_MS : FRESH_MS)) keepAlive(buildAndStore(ticker));
      return stored;
    }
  }
  return buildAndStore(ticker);
}

/** The timer's share: the next two companies, each rebuilt in an invocation of its own. */
export async function primeSegmentsSlice(origin: string, limit = 2): Promise<string[]> {
  const cache = datasetCache();
  if (!cache) return [];
  const order = [...SEGMENT_PRIORITY, ...UNIVERSE.map((member) => member.ticker).filter((ticker) => !SEGMENT_PRIORITY.includes(ticker))];
  const start = Number((await cache.get(CURSOR_KEY, "text").catch(() => null)) ?? 0) || 0;
  const done: string[] = [];
  for (let step = 0; step < limit; step++) {
    const ticker = order[(start + step) % order.length];
    const request = new Request(new URL(`/api/segments/${encodeURIComponent(ticker)}`, origin), { headers: { "X-FinScope-Warm": "1", "X-FinScope-Rebuild": "1" } });
    const self = selfFetcher();
    try {
      const response = await (self ? self.fetch(request) : fetch(request));
      await response.body?.cancel();
      if (response.ok) done.push(ticker);
    } catch { /* The next pass reaches it again. */ }
  }
  await cache.put(CURSOR_KEY, String((start + limit) % order.length)).catch(() => undefined);
  return done;
}
