import type { Snapshot } from "./term/rules";

/**
 * SIGS: the names breaking out of their year and trading far more shares than
 * usual — in the S&P 500 and in the reader's own list — from the scanner's
 * snapshot of daily bars (lib/term/tech-universe.ts) and the half-hourly
 * prices (lib/universe-build.ts).
 *
 * Two moments, said apart: the last whole session (the bar that set a new
 * 52-week high or low, the volume against its twenty-day average) and today,
 * where a price above the year's high, highs included up to yesterday, is a
 * new high as it happens. Volume is only counted once a session is whole.
 */

export interface SignalRow { ticker: string; name: string; values: Snapshot }

export interface Signal {
  ticker: string;
  name: string;
  kind: "high" | "low" | "volume";
  /** "today" from the live price; "last" from the last whole session. */
  when: "today" | "last";
  price: number | null;
  /** The day's move as a fraction: today's, or the session's. */
  change: number | null;
  /** The volume against its twenty-day average, for a volume signal. */
  ratio: number | null;
  watched: boolean;
}

export interface Signals {
  /** The last whole session's date. */
  session: string | null;
  highs: Signal[];
  lows: Signal[];
  volume: Signal[];
  /** Across the S&P 500, today where priced, else the last session. */
  counts: { highs: number; lows: number; volume: number; members: number };
}

const now = (values: Snapshot, field: keyof Snapshot) => values[field]?.[0] ?? null;
const before = (values: Snapshot, field: keyof Snapshot) => values[field]?.[1] ?? null;

/** Pure: every signal, the reader's names first, then the largest moves; `limit` a list for the index's. */
export function signalsOf(input: {
  rows: Array<SignalRow & { asOf?: number }>;
  prices: Record<string, { price: number | null; changePercent: number | null }>;
  members: Set<string>;
  watched: Set<string>;
  limit?: number;
  volumeRatio?: number;
}): Signals {
  const limit = input.limit ?? 12;
  const threshold = input.volumeRatio ?? 2;
  const all: Signal[] = [];
  let session: string | null = null;
  for (const row of input.rows) {
    const watched = input.watched.has(row.ticker);
    if (!watched && !input.members.has(row.ticker)) continue;
    const v = row.values;
    if (row.asOf) { const date = new Date(row.asOf * 1000).toISOString().slice(0, 10); if (!session || date > session) session = date; }
    const close = now(v, "close"), high52 = now(v, "high52"), low52 = now(v, "low52");
    const live = input.prices[row.ticker];
    const base = { ticker: row.ticker, name: row.name, watched, ratio: null };
    // Today: the live price past the year's range as it stood at the last close.
    const today = live?.price != null && live.price !== close ? live.price : null;
    const todayChange = live?.changePercent == null ? null : live.changePercent / 100;
    const lastChange = now(v, "chg1") == null ? null : now(v, "chg1")! / 100;
    if (today != null && high52 != null && today > high52) all.push({ ...base, kind: "high", when: "today", price: today, change: todayChange });
    else if (now(v, "high") != null && high52 != null && now(v, "high")! >= high52 && (before(v, "high52") == null || high52 > before(v, "high52")!)) {
      all.push({ ...base, kind: "high", when: "last", price: close, change: lastChange });
    }
    if (today != null && low52 != null && today < low52) all.push({ ...base, kind: "low", when: "today", price: today, change: todayChange });
    else if (now(v, "low") != null && low52 != null && now(v, "low")! <= low52 && (before(v, "low52") == null || low52 < before(v, "low52")!)) {
      all.push({ ...base, kind: "low", when: "last", price: close, change: lastChange });
    }
    const ratio = now(v, "volumeRatio");
    if (ratio != null && ratio >= threshold) all.push({ ...base, kind: "volume", when: "last", price: close, change: lastChange, ratio: Math.round(ratio * 100) / 100 });
  }
  const order = (key: (signal: Signal) => number) => (a: Signal, b: Signal) => Number(b.watched) - Number(a.watched) || key(b) - key(a);
  const pick = (kind: Signal["kind"], key: (signal: Signal) => number) => {
    const found = all.filter((signal) => signal.kind === kind).sort(order(key));
    // The reader's names whatever their number, and the index's largest up to the limit.
    return [...found.filter((signal) => signal.watched), ...found.filter((signal) => !signal.watched).slice(0, limit)];
  };
  const inIndex = (kind: Signal["kind"]) => all.filter((signal) => signal.kind === kind && input.members.has(signal.ticker)).length;
  return {
    session,
    highs: pick("high", (signal) => signal.change ?? 0),
    lows: pick("low", (signal) => -(signal.change ?? 0)),
    volume: pick("volume", (signal) => signal.ratio ?? 0),
    counts: { highs: inIndex("high"), lows: inIndex("low"), volume: inIndex("volume"), members: input.members.size },
  };
}
