import { fetchCandles } from "@/lib/adapters/candles";
import { companyByTicker } from "@/lib/company-registry";
import { datasetCache, keepAlive } from "@/lib/runtime-env";
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
/**
 * The shape of a row's values. A row of an older shape keeps serving until it
 * is read again — first in line, ahead of merely stale ones — so a new field
 * fills in without the scanner ever going empty. 2 added the one-year and
 * year-to-date returns the heat map reads; 3 the six-month return the RS
 * rating weighs.
 */
export const ROW_SHAPE = 4;
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
  shape?: number;
}

export interface TechTable {
  builtAt: string;
  members: number;
  rows: TechRow[];
  /**
   * Members Yahoo answered with no usable history — a company taken over or
   * delisted since the index list was dated — and when. They are not asked
   * for again for a day, and the table counts as whole without them.
   */
  unreadable?: Record<string, string>;
}

const UNREADABLE_HOURS = 24;

/** Members set aside within the last day. */
export function setAside(table: TechTable | null, now = new Date()): Set<string> {
  const since = now.getTime() - UNREADABLE_HOURS * 3_600_000;
  return new Set(Object.entries(table?.unreadable ?? {}).filter(([, at]) => Date.parse(at) > since).map(([ticker]) => ticker));
}

/** Every member read, or set aside as unreadable. */
export const isWhole = (table: TechTable | null, now = new Date()) =>
  table != null
  && table.rows.filter((row) => row.shape === ROW_SHAPE).length
    + [...setAside(table, now)].filter((ticker) => !table.rows.some((row) => row.ticker === ticker)).length >= table.members;

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
  const aside = setAside(table, now);
  const missing = UNIVERSE.filter((member) => !built.has(member.ticker) && !aside.has(member.ticker)).map((member) => member.ticker);
  const shapes = new Map((table?.rows ?? []).map((row) => [row.ticker, row.shape]));
  const outdated = UNIVERSE.filter((member) => built.has(member.ticker) && shapes.get(member.ticker) !== ROW_SHAPE).map((member) => member.ticker);
  const old = UNIVERSE.filter((member) => shapes.get(member.ticker) === ROW_SHAPE && (built.get(member.ticker) ?? Infinity) < stale)
    .sort((a, b) => built.get(a.ticker)! - built.get(b.ticker)!)
    .map((member) => member.ticker);
  return [...missing, ...outdated, ...old].slice(0, limit);
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
  const unreadable: Record<string, string> = { ...(table?.unreadable ?? {}) };
  let read = 0;

  await Promise.all(Array.from({ length: AT_ONCE }, async () => {
    for (let ticker = queue.shift(); ticker; ticker = queue.shift()) {
      try {
        const candles = await fetchCandles(yahooSymbol(ticker), "1d");
        if (candles.c.length < 2) {
          // An answer with nothing in it is the company, not the network.
          unreadable[ticker] = new Date().toISOString();
          failed.push(ticker);
          continue;
        }
        delete unreadable[ticker];
        rows.set(ticker, {
          ticker, name: names.get(ticker) ?? ticker, asOf: candles.t[candles.t.length - 1], builtAt: new Date().toISOString(),
          values: snapshotOf(computeSeries(candles)), shape: ROW_SHAPE,
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
    unreadable,
  };
  try {
    await cache.put(TECH_KEY, JSON.stringify(next));
  } catch {
    // The run is lost and the next one reads the same members again.
  }
  return { read, failed, rows: next.rows.length };
}

const FILL_LOCK = "technicals:filling";
const ON_DEMAND = 50;

/**
 * While the snapshot is not whole — the first day, or after its version
 * changes — a reader's visit starts a slice in the background, one at a time
 * under a short lock, so the screens that read it fill in minutes rather than
 * over an afternoon of half-hourly runs.
 */
export async function fillOnDemand(table: TechTable | null) {
  if (isWhole(table)) return;
  const cache = datasetCache();
  if (!cache) return;
  try {
    if (await cache.get(FILL_LOCK)) return;
    await cache.put(FILL_LOCK, "1", { expirationTtl: 90 });
  } catch {
    return;
  }
  keepAlive(buildTechnicalSlice(ON_DEMAND).finally(() => cache.delete(FILL_LOCK).catch(() => undefined)));
}
