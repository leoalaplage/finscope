/**
 * How a stock took its earnings: the move from the last close before each
 * earnings 8-K to the closes after it.
 *
 * The filing date is the release date, but not whether the release came before
 * the open or after the close, so the first reading spans both: from the close
 * the day before the filing to the close the session after it — the window
 * that holds the reaction either way. The others run on from that close to the
 * fifth and twentieth sessions after the filing.
 */

export interface Bars { t: number[]; c: number[] }
export interface Reaction { date: string; before: number; day: number | null; week: number | null; month: number | null }

const dateOf = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

export function reactions(filed: string[], bars: Bars, limit = 12): Reaction[] {
  const dates = bars.t.map(dateOf);
  const out: Reaction[] = [];
  for (const date of [...filed].sort().reverse()) {
    if (out.length >= limit) break;
    // The last session before the filing day, and the first one after it.
    const after = dates.findIndex((day) => day > date);
    let prior = -1;
    for (let index = 0; index < dates.length && dates[index] < date; index++) prior = index;
    if (prior < 0 || after < 0) continue;
    const before = bars.c[prior];
    const at = (index: number) => (index < bars.c.length ? bars.c[index] / before - 1 : null);
    out.push({ date, before, day: at(after), week: at(after + 4), month: at(after + 19) });
  }
  return out;
}

export interface ReactionSummary { count: number; averageMove: number | null; average: number | null; up: number; largestUp: number | null; largestDown: number | null }

export function summarise(rows: Reaction[]): ReactionSummary {
  const moves = rows.map((row) => row.day).filter((value): value is number => value != null);
  return {
    count: moves.length,
    averageMove: moves.length ? moves.reduce((sum, value) => sum + Math.abs(value), 0) / moves.length : null,
    average: moves.length ? moves.reduce((sum, value) => sum + value, 0) / moves.length : null,
    up: moves.filter((value) => value > 0).length,
    largestUp: moves.length ? Math.max(...moves) : null,
    largestDown: moves.length ? Math.min(...moves) : null,
  };
}
