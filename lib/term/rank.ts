/**
 * Ranking a market table by performance: as listed, best first, or worst first.
 * A row without a figure goes last either way, and rows that tie keep their
 * listed order.
 *
 * Pure.
 */

export type RankDirection = "desc" | "asc";
export interface Rank { key: string; direction: RankDirection }

/** The next state when the same column is asked again: best first, worst first, as listed. */
export function nextRank(current: Rank | null, key: string): Rank | null {
  if (!current || current.key !== key) return { key, direction: "desc" };
  return current.direction === "desc" ? { key, direction: "asc" } : null;
}

export function ranked<T>(rows: readonly T[], rank: Rank | null, value: (row: T, key: string) => number | null | undefined): T[] {
  if (!rank) return [...rows];
  const sign = rank.direction === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: value(row, rank.key) }))
    .sort((left, right) => {
      const a = left.value, b = right.value;
      const missingA = a == null || !Number.isFinite(a), missingB = b == null || !Number.isFinite(b);
      if (missingA || missingB) return missingA === missingB ? left.index - right.index : missingA ? 1 : -1;
      return sign * (a - b) || left.index - right.index;
    })
    .map((entry) => entry.row);
}
