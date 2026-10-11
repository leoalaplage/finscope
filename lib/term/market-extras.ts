import { readSnapshot, holds, type Snapshot } from "./rules";

/**
 * What the index looks like underneath its level, from the scanner's snapshot
 * of every member (lib/term/tech-universe.ts): how many are above their
 * averages, at their highs or lows, stretched either way; how each sector has
 * done over a week, a month and a quarter; and which members are trading far
 * more shares than usual.
 *
 * Pure, so the arithmetic is tested; the route only reads the two tables.
 */

export interface ExtrasRow { ticker: string; name: string; sector: string; values: Snapshot }

export interface Breadth {
  counted: number;
  aboveSma50: number;
  aboveSma200: number;
  /** Within one percent of the 52-week high, or of the low. */
  highs52: number;
  lows52: number;
  overbought: number;
  oversold: number;
  goldenCrosses: string[];
  deathCrosses: string[];
}

export interface SectorRun { sector: string; companies: number; d5: number | null; d20: number | null; d60: number | null }

export interface VolumeMover { ticker: string; name: string; ratio: number; change: number | null; close: number | null }

const value = (row: ExtrasRow, field: keyof Snapshot) => row.values[field]?.[0] ?? null;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function breadthOf(rows: ExtrasRow[]): Breadth {
  const counted = rows.filter((row) => value(row, "close") != null);
  const count = (test: (row: ExtrasRow) => boolean) => counted.filter(test).length;
  const above = (field: "sma50" | "sma200") => count((row) => {
    const close = value(row, "close");
    const average = value(row, field);
    return close != null && average != null && close > average;
  });
  const crossed = (op: "crossesAbove" | "crossesBelow") =>
    counted.filter((row) => holds({ left: "sma50", op, right: "sma200" }, readSnapshot(row.values))).map((row) => row.ticker);
  return {
    counted: counted.length,
    aboveSma50: above("sma50"),
    aboveSma200: above("sma200"),
    highs52: count((row) => (value(row, "fromHigh52") ?? -Infinity) >= -1),
    lows52: count((row) => (value(row, "fromLow52") ?? Infinity) <= 1),
    overbought: count((row) => (value(row, "rsi14") ?? 0) > 70),
    oversold: count((row) => (value(row, "rsi14") ?? 100) < 30),
    goldenCrosses: crossed("crossesAbove"),
    deathCrosses: crossed("crossesBelow"),
  };
}

/**
 * Each sector's median return over a week, a month and a quarter of sessions,
 * best month first — except that a "sector" of one or two companies is one
 * company's chart, not a sector's, and goes to the bottom whatever it did.
 */
export function sectorRuns(rows: ExtrasRow[]): SectorRun[] {
  const bySector = new Map<string, ExtrasRow[]>();
  for (const row of rows) bySector.set(row.sector, [...(bySector.get(row.sector) ?? []), row]);
  const medianOf = (members: ExtrasRow[], field: "chg5" | "chg20" | "chg60") =>
    median(members.map((row) => value(row, field)).filter((item): item is number => item != null));
  return [...bySector].map(([sector, members]) => ({
    sector, companies: members.length, d5: medianOf(members, "chg5"), d20: medianOf(members, "chg20"), d60: medianOf(members, "chg60"),
  })).sort((a, b) => Number(b.companies >= 3) - Number(a.companies >= 3) || (b.d20 ?? -Infinity) - (a.d20 ?? -Infinity));
}

/** The members trading the most shares against their own twenty-session average. */
export function unusualVolume(rows: ExtrasRow[], limit = 10): VolumeMover[] {
  return rows
    .map((row) => ({ ticker: row.ticker, name: row.name, ratio: value(row, "volumeRatio"), change: value(row, "chg1"), close: value(row, "close") }))
    .filter((row): row is VolumeMover => row.ratio != null && row.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, limit);
}
