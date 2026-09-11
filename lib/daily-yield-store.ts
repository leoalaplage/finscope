import { historyStart, readDailyYields, recentOnly, type DailyFeed, type Observation } from "./adapters/daily-yields";
import { cachedJson } from "./market-cache";
import { datasetCache } from "./runtime-env";

/**
 * One government's five years of readings, fetched once for everybody.
 *
 * The strip and every chart window read the same stored series and slice it,
 * rather than each asking the publisher for its own piece. Two of these files
 * are more than a megabyte — the whole of Banco de España's table since 1987,
 * the whole of Japan's since 1974 — and asking for either on every cold chart
 * would be slow for the reader and rude to the bank.
 *
 * Half an hour. Each of these is struck once a business day, so a shorter life
 * would only re-read a file that has not changed; a longer one would hold
 * yesterday's figure for a morning after the bank had published today's.
 */
const TTL_SECONDS = 1_800;
const SHAPE = "v1";

/**
 * Where a feed that forgets keeps what it has already shown.
 *
 * No expiry: this is the only copy of last month's gilt curve this site will
 * ever have, because the Bank's spreadsheet drops it on the first of the next.
 * Seeded once from the Bank's own archive, then extended a day at a time.
 */
export const historyKey = (id: string) => `yields-history:v1:${id}`;

/** Two runs of readings as one, the later word winning on any date both carry. */
export function mergeReadings(kept: Observation[], fresh: Observation[]): Observation[] {
  const byDate = new Map<string, number>();
  for (const each of kept) byDate.set(each.date, each.value);
  for (const each of fresh) byDate.set(each.date, each.value);
  return [...byDate].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

async function withHistory(id: string, fresh: Observation[]): Promise<Observation[]> {
  const cache = datasetCache();
  let kept: Observation[] = [];
  try {
    const stored = await cache?.get(historyKey(id), "text");
    if (stored) kept = JSON.parse(stored) as Observation[];
  } catch {
    // A history that cannot be read is a shorter series, not a failed one: the
    // current month still draws, and longer windows say they cannot yet.
  }
  const merged = mergeReadings(kept, fresh);
  if (merged.length !== kept.length || merged.at(-1)?.value !== kept.at(-1)?.value) {
    try { await cache?.put(historyKey(id), JSON.stringify(merged)); } catch { /* Kept next time instead. */ }
  }
  return merged;
}

export async function dailyYields(id: string, feed: DailyFeed): Promise<Observation[]> {
  const { body } = await cachedJson<Observation[]>(
    `yields:${SHAPE}:${id}`,
    TTL_SECONDS,
    async () => {
      const fresh = await readDailyYields(feed);
      if (!recentOnly(feed)) return fresh;
      const since = historyStart();
      return (await withHistory(id, fresh)).filter((each) => each.date >= since);
    },
    (series) => series.length ? "full" : "empty",
  );
  return JSON.parse(body) as Observation[];
}
