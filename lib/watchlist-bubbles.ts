import type { PerformanceRow } from "@/app/api/performance/route";
import type { WindowId } from "./performance";

export function bubbleLayout(rows: PerformanceRow[], window: WindowId, sector: string | null) {
  const available = rows.filter((row) => Number.isFinite(row.changes[window]));
  const sectors = [...new Set(available.map((row) => row.sector || "Unclassified"))].sort();
  const shown = available.filter((row) => !sector || (row.sector || "Unclassified") === sector);
  const groups = sector ? sectors.filter((name) => name === sector) : sectors;
  const values = shown.map((row) => row.changes[window]! * 100);
  const bottom = Math.min(0, ...values), top = Math.max(0, ...values);
  const padding = Math.max((top - bottom) * .18, .5);
  const min = bottom - padding, max = top + padding;
  const largest = Math.max(1, ...shown.map((row) => row.marketCap ?? 0));
  const points = groups.flatMap((name, group) => {
    const members = shown.filter((row) => (row.sector || "Unclassified") === name).sort((a, b) => a.ticker.localeCompare(b.ticker));
    return members.map((row, index) => ({
      ...row, sector: name, value: row.changes[window]! * 100,
      x: 65 + (group + (index + 1) / (members.length + 1)) / groups.length * 1090,
      y: 32 + (max - row.changes[window]! * 100) / (max - min) * 350,
      // Circle area is proportional to capitalization; missing caps are hollow markers.
      r: row.marketCap != null && row.marketCap > 0 ? 42 * Math.sqrt(row.marketCap / largest) : 6,
    }));
  });
  return { points, sectors, groups, min, max, missing: rows.length - available.length, colors: sectorColors(sectors) };
}

/**
 * One colour per sector on screen, by its place among them.
 *
 * Hashing a sector's name onto eleven colours gave two sectors the same colour
 * as often as not, and the index carries some thirty sectors — more than any
 * fixed palette. Each sector present takes the next hue round the circle by the
 * golden angle, so neighbours in the list are never neighbours in colour and no
 * two sectors share one however many there are. Taken from every sector
 * present, not the ones a filter leaves, so choosing one never recolours it.
 */
export function sectorColors(sectors: string[]): Map<string, string> {
  return new Map([...new Set(sectors)].sort().map((sector, index) => [sector, `hsl(${Math.round((index * 137.508 + 200) % 360)} 62% 54%)`]));
}
