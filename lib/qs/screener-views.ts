import { QS_GRADES, QS_PILLARS, type PillarName, type ScoredCompany } from "./screener";
import { stated } from "../sector";

/**
 * What the screener's charts read off a scored list. Pure, so every figure the
 * page draws can be checked without drawing it.
 *
 * Nothing here scores anything: the engine (lib/qs/screener.ts) has already
 * done that. These are the same rows, counted, grouped and placed.
 */

export const median = (values: Array<number | null | undefined>): number | null => {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((left, right) => left - right);
  if (!known.length) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
};

/**
 * The business without its price: Quality, Health and Growth, weighted as the
 * chosen preset weighs them and re-weighted over the pillars a company carries.
 * Value is the other axis of the map, so it is left out of this one.
 */
export function businessScore(row: ScoredCompany, weights: Record<PillarName, number>): number | null {
  let sum = 0;
  let weight = 0;
  for (const pillar of QS_PILLARS) {
    if (pillar === "Value") continue;
    const value = row.piliers[pillar];
    if (value == null || !Number.isFinite(value)) continue;
    sum += value * weights[pillar];
    weight += weights[pillar];
  }
  return weight > 0 ? sum / weight : null;
}

/** How many companies hold each letter, in the engine's order, unrated last. */
export function gradeCounts(rows: ScoredCompany[]): Array<{ grade: string; count: number }> {
  const counts = new Map<string, number>([...QS_GRADES, "NR"].map((grade) => [grade, 0]));
  for (const row of rows) counts.set(row.note, (counts.get(row.note) ?? 0) + 1);
  return [...counts].map(([grade, count]) => ({ grade, count }));
}

/** A letter's place from best (0) to worst (1), for a colour that reads as a ramp. */
export function gradeRank(grade: string): number | null {
  const index = QS_GRADES.indexOf(grade);
  return index < 0 ? null : QS_GRADES.length > 1 ? index / (QS_GRADES.length - 1) : 0;
}

export const sectorOf = (row: ScoredCompany) => stated(row.Secteur) ?? "Unclassified";

/** Each sector's median score and how many companies it rests on, best first. */
export function sectorScores(rows: ScoredCompany[]): Array<{ sector: string; median: number; count: number; best: string }> {
  const groups = new Map<string, ScoredCompany[]>();
  for (const row of rows) groups.set(sectorOf(row), [...(groups.get(sectorOf(row)) ?? []), row]);
  return [...groups].flatMap(([sector, members]) => {
    const value = median(members.map((member) => member.total));
    if (value == null) return [];
    const best = [...members].filter((member) => member.total != null).sort((left, right) => right.total! - left.total!)[0];
    return [{ sector, median: value, count: members.length, best: best.Ticker }];
  }).sort((left, right) => right.median - left.median || left.sector.localeCompare(right.sector));
}

export interface ScreenerFilter {
  query: string;
  grades: string[];
  sector: string | null;
  sweetOnly: boolean;
  noAlerts: boolean;
}

export const NO_FILTER: ScreenerFilter = { query: "", grades: [], sector: null, sweetOnly: false, noAlerts: false };

export function filterRows(rows: ScoredCompany[], filter: ScreenerFilter): ScoredCompany[] {
  const query = filter.query.trim().toUpperCase();
  return rows.filter((row) => (!query || row.Ticker.toUpperCase().includes(query) || sectorOf(row).toUpperCase().includes(query))
    && (!filter.grades.length || filter.grades.includes(row.note))
    && (!filter.sector || sectorOf(row) === filter.sector)
    && (!filter.sweetOnly || row.sweet_spot)
    && (!filter.noAlerts || row.alertes === 0));
}

export const isFiltered = (filter: ScreenerFilter) =>
  Boolean(filter.query.trim() || filter.grades.length || filter.sector || filter.sweetOnly || filter.noAlerts);

/** The list's own centre on each pillar, so one company's bars can be read against it. */
export function pillarMedians(rows: ScoredCompany[]): Record<PillarName, number | null> {
  return Object.fromEntries(QS_PILLARS.map((pillar) => [pillar, median(rows.map((row) => row.piliers[pillar]))])) as Record<PillarName, number | null>;
}

/** The measures read as percentages; the rest are multiples. */
const PERCENT_MEASURES = new Set(["ROIC", "ROIC5", "OpM", "FCFM5", "FCF_NI", "GM5", "ShOut5", "SBC", "Rev5", "RevFwd3", "LevFCF5", "NI5", "RevPS5", "FCFPS5", "FCFYield"]);

/** One measure's raw reading, as the method table and the company card both write it. */
export function measureValue(key: string, value: number | null | undefined, absent = "—"): string {
  if (value == null || !Number.isFinite(value)) return absent;
  return PERCENT_MEASURES.has(key) ? `${value.toFixed(1)}%` : `${value.toFixed(2)}×`;
}
