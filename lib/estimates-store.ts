import { fetchEstimates } from "./adapters/nasdaq-estimates";
import { mergeSurprises, recordSnapshot, snapshotOf, type EpsSurprise, type EstimateSnapshot, type Estimates } from "./estimates";
import { cachedJson, marketKey } from "./market-cache";
import { datasetCache } from "./runtime-env";
import { coveredMembers } from "./covered-universe";
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
/** Every reported quarter against its consensus, kept: Nasdaq lists the last four, the chart grows past them. */
const surprisesKey = (ticker: string) => `estimates-surprises:v1:${ticker.toUpperCase()}`;
const CURSOR_KEY = "estimates-cursor:v1";
/** Twenty a run, forty-eight runs a day: the thousand covered companies about once a day, four requests each. */
export const ESTIMATES_PER_RUN = 20;
/** Kept consensus copied into the screener's table a run, where it has no row. */
const BACKFILL_PER_RUN = 80;

export async function readHistory(ticker: string): Promise<EstimateSnapshot[]> {
  try {
    return (await datasetCache()?.get<EstimateSnapshot[]>(historyKey(ticker), "json")) ?? [];
  } catch {
    return [];
  }
}

export async function readSurprises(ticker: string): Promise<EpsSurprise[]> {
  try {
    return (await datasetCache()?.get<EpsSurprise[]>(surprisesKey(ticker), "json")) ?? [];
  } catch {
    return [];
  }
}

async function remember(estimates: Estimates) {
  const cache = datasetCache();
  if (!cache) return;
  if (estimates.surprises?.length) {
    const kept = mergeSurprises(await readSurprises(estimates.ticker), estimates.surprises);
    await cache.put(surprisesKey(estimates.ticker), JSON.stringify(kept)).catch(() => undefined);
  }
  // Nothing to remember from a company no analyst covers.
  if (!estimates.quarterly.length && !estimates.yearly.length && !estimates.target) return;
  const history = recordSnapshot(await readHistory(estimates.ticker), snapshotOf(estimates, estimates.asOf.slice(0, 10)));
  await cache.put(historyKey(estimates.ticker), JSON.stringify(history)).catch(() => undefined);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Whether the nearest quarter of the consensus has already ended: its report is days away, or out. */
export function awaitingReport(estimates: Pick<Estimates, "quarterly">, today = new Date()): boolean {
  const [month, year] = (estimates.quarterly[0]?.fiscalEnd ?? "").split(" ");
  const index = MONTHS.indexOf(month);
  if (index < 0 || !/^\d{4}$/.test(year ?? "")) return false;
  return Date.UTC(Number(year), index + 1, 0) < today.getTime();
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
    // A quarter that has ended and is not yet among the reported ones is about to be: asked again within the half hour.
    if (forecast && opinion && awaitingReport(estimates)) return "brief";
    return forecast && opinion ? "full" : forecast || opinion ? "partial" : "empty";
  });
}

/** The timer's share: the next dozen members of the index, read and snapshotted. */
export async function snapshotEstimatesSlice(limit = ESTIMATES_PER_RUN): Promise<{ read: string[]; next: number } | null> {
  const cache = datasetCache();
  if (!cache) return null;
  const UNIVERSE = await coveredMembers();
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
  const previous = await cache.get<ConsensusTable>(SCREENER_CONSENSUS_KEY, "json").catch(() => null);
  /*
   * Members the screener's table has no row for yet are filled from the
   * consensus already kept for them, without asking Nasdaq again: a few dozen
   * reads of the store a run, so the table is whole within hours of a deploy
   * rather than after the day the rotation takes.
   */
  const held = new Set([...(previous?.rows ?? []).map((row) => row.ticker), ...updates.map((row) => row.ticker)]);
  for (const member of UNIVERSE.filter((entry) => !held.has(entry.ticker)).slice(0, BACKFILL_PER_RUN)) {
    const body = await cache.get<Estimates>(marketKey(estimatesKey(member.ticker)), "json").catch(() => null);
    if (body?.ticker) updates.push(consensusRow(body));
  }
  if (updates.length) {
    const nextTable = mergeConsensus(previous, updates, UNIVERSE.map((member) => member.ticker), new Date().toISOString());
    await cache.put(SCREENER_CONSENSUS_KEY, JSON.stringify(nextTable)).catch(() => undefined);
  }
  const next = (start + limit) % UNIVERSE.length;
  await cache.put(CURSOR_KEY, String(next)).catch(() => undefined);
  return { read, next };
}
