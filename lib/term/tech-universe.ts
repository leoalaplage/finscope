import { fetchCandles } from "@/lib/adapters/candles";
import { companyByTicker } from "@/lib/company-registry";
import { datasetCache } from "@/lib/runtime-env";
import { UNIVERSE } from "@/lib/universe";
import { computeSeries, snapshotOf, type Snapshot } from "./rules";

/**
 * The S&P 500 as the scanner reads it: every field of lib/term/rules.ts on
 * each member's last two daily bars.
 *
 * Scanning five hundred companies means reading five hundred price histories,
 * which no reader's request can do and no browser should. So the half-hourly
 * scheduled run (worker/index.ts) reads a hundred of them a run, oldest first, and
 * keeps the answer under one key; a reader's scan is then one read of one
 * table, and the rule is evaluated in their browser. A member is read again
 * once its row is six hours old, so the whole index turns over a few times a
 * day and is never more than a session behind.
 */

export const TECH_KEY = "technicals:v1";
export const TECH_PER_RUN = 100;
export const TECH_STALE_HOURS = 6;
const AT_ONCE = 6;

export interface TechRow {
  ticker: string;
  name: string;
  /** The last bar's time, in the candles' exchange-date seconds. */
  asOf: number;
  builtAt: string;
  values: Snapshot;
}

export interface TechTable { builtAt: string; members: number; rows: TechRow[] }

export async function readTechTable(): Promise<TechTable | null> {
  try {
    return (await datasetCache()?.get(TECH_KEY, "json")) as TechTable | null;
  } catch {
    return null;
  }
}

/** Members never read first, then the oldest past their six hours. */
export function nextTechnicals(table: TechTable | null, limit = TECH_PER_RUN, now = new Date()): string[] {
  const built = new Map((table?.rows ?? []).map((row) => [row.ticker, Date.parse(row.builtAt)]));
  const stale = now.getTime() - TECH_STALE_HOURS * 3_600_000;
  const missing = UNIVERSE.filter((member) => !built.has(member.ticker)).map((member) => member.ticker);
  const old = UNIVERSE.filter((member) => (built.get(member.ticker) ?? Infinity) < stale)
    .sort((a, b) => built.get(a.ticker)! - built.get(b.ticker)!)
    .map((member) => member.ticker);
  return [...missing, ...old].slice(0, limit);
}

/** Yahoo writes a share class with a dash where the SEC and this site write a dot. */
export const yahooSymbol = (ticker: string) => companyByTicker(ticker)?.yahooTicker ?? ticker.replace(/\./g, "-");

export async function buildTechnicalSlice(limit = TECH_PER_RUN): Promise<{ read: number; failed: string[]; rows: number } | null> {
  const cache = datasetCache();
  if (!cache) return null;
  const table = await readTechTable();
  const rows = new Map((table?.rows ?? []).map((row) => [row.ticker, row]));
  const names = new Map(UNIVERSE.map((member) => [member.ticker, member.name]));
  const queue = nextTechnicals(table, limit);
  const failed: string[] = [];
  let read = 0;

  await Promise.all(Array.from({ length: AT_ONCE }, async () => {
    for (let ticker = queue.shift(); ticker; ticker = queue.shift()) {
      try {
        const candles = await fetchCandles(yahooSymbol(ticker), "1d");
        if (candles.c.length < 2) throw new Error("no history");
        rows.set(ticker, {
          ticker, name: names.get(ticker) ?? ticker, asOf: candles.t[candles.t.length - 1], builtAt: new Date().toISOString(),
          values: snapshotOf(computeSeries(candles)),
        });
        read++;
      } catch {
        // Kept as it was, and asked for again next run.
        failed.push(ticker);
      }
    }
  }));

  const next: TechTable = {
    builtAt: new Date().toISOString(),
    members: UNIVERSE.length,
    rows: UNIVERSE.map((member) => rows.get(member.ticker)).filter((row): row is TechRow => row != null),
  };
  try {
    await cache.put(TECH_KEY, JSON.stringify(next));
  } catch {
    // The run is lost and the next one reads the same members again.
  }
  return { read, failed, rows: next.rows.length };
}
