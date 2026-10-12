import { fetchEstimates } from "./adapters/nasdaq-estimates";
import { recordSnapshot, snapshotOf, type EstimateSnapshot, type Estimates } from "./estimates";
import { cachedJson } from "./market-cache";
import { datasetCache } from "./runtime-env";
import { UNIVERSE } from "./universe";
import { consensusRow, mergeConsensus, SCREENER_CONSENSUS_KEY, type ConsensusRow, type ConsensusTable } from "./screener-consensus";

/**
 * Where analysts' estimates are kept: the consensus for twelve hours, and one
 * snapshot a day per company for two years, which is the revision history no
 * free source publishes (lib/estimates.ts).
 *
 * A snapshot is taken whenever the consensus is read fresh — by a reader, or
 * by the half-hourly timer, which walks the whole index a dozen companies at a
 * time so every member has a reading every day whether anyone opened it.
 */

export const ESTIMATES_SECONDS = 12 * 3600;
const estimatesKey = (ticker: string) => `estimates:v1:${ticker.toUpperCase()}`;
const historyKey = (ticker: string) => `estimates-history:v1:${ticker.toUpperCase()}`;
const CURSOR_KEY = "estimates-cursor:v1";
/** Twelve a run, forty-eight runs a day: the index once a day, four requests each. */
export const ESTIMATES_PER_RUN = 12;

export async function readHistory(ticker: string): Promise<EstimateSnapshot[]> {
  try {
    return (await datasetCache()?.get<EstimateSnapshot[]>(historyKey(ticker), "json")) ?? [];
  } catch {
    return [];
  }
}

async function remember(estimates: Estimates) {
  const cache = datasetCache();
  if (!cache) return;
  // Nothing to remember from a company no analyst covers.
  if (!estimates.quarterly.length && !estimates.yearly.length && !estimates.target) return;
  const history = recordSnapshot(await readHistory(estimates.ticker), snapshotOf(estimates, estimates.asOf.slice(0, 10)));
  await cache.put(historyKey(estimates.ticker), JSON.stringify(history)).catch(() => undefined);
}

/** The consensus, read at most every twelve hours, its snapshot taken each time it is read fresh. */
export async function getEstimates(ticker: string): Promise<{ body: string; hit: boolean }> {
  return cachedJson(estimatesKey(ticker), ESTIMATES_SECONDS, async () => {
    const estimates = await fetchEstimates(ticker);
    await remember(estimates);
    return estimates;
  }, (estimates) => {
    // Both halves answered: kept twelve hours. One of them: a minute, so the
    // missing half is asked again soon. Neither: not kept at all.
    const forecast = estimates.quarterly.length > 0 || estimates.yearly.length > 0;
    const opinion = estimates.target != null || estimates.ratings != null;
    return forecast && opinion ? "full" : forecast || opinion ? "partial" : "empty";
  });
}

/** The timer's share: the next dozen members of the index, read and snapshotted. */
export async function snapshotEstimatesSlice(limit = ESTIMATES_PER_RUN): Promise<{ read: string[]; next: number } | null> {
  const cache = datasetCache();
  if (!cache) return null;
  const start = Number((await cache.get(CURSOR_KEY, "text").catch(() => null)) ?? 0) || 0;
  const read: string[] = [];
  const updates: ConsensusRow[] = [];
  for (let step = 0; step < limit; step++) {
    const member = UNIVERSE[(start + step) % UNIVERSE.length];
    try {
      const result = await getEstimates(member.ticker);
      updates.push(consensusRow(JSON.parse(result.body) as Estimates));
      read.push(member.ticker);
    } catch { /* The next pass reads it. */ }
  }
  if (updates.length) {
    const previous = await cache.get<ConsensusTable>(SCREENER_CONSENSUS_KEY, "json").catch(() => null);
    const nextTable = mergeConsensus(previous, updates, UNIVERSE.map((member) => member.ticker), new Date().toISOString());
    await cache.put(SCREENER_CONSENSUS_KEY, JSON.stringify(nextTable)).catch(() => undefined);
  }
  const next = (start + limit) % UNIVERSE.length;
  await cache.put(CURSOR_KEY, String(next)).catch(() => undefined);
  return { read, next };
}
