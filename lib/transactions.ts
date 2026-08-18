import type { Position } from "./portfolio";

/**
 * A single buy or sell, on the day it happened.
 *
 * This replaces the standing `{ ticker, shares, cost }` a portfolio used to be.
 * That shape could say what is held and what it cost on average, and nothing
 * else: not when the money went in, not what a sale realised, not what the book
 * looked like last year. Every one of those questions is answered by replaying
 * a list like this, and none of them can be answered without it.
 *
 * A sale carries a positive `shares` and `kind: "sell"` rather than a negative
 * quantity. Signed quantities read compactly and then quietly admit a "buy of
 * minus ten", which is a thing no brokerage statement has ever said.
 */
export interface Transaction {
  /** Stable across edits, so React keys and undo do not depend on the order. */
  id: string;
  ticker: string;
  /** Trade date, `YYYY-MM-DD`. */
  date: string;
  kind: "buy" | "sell";
  shares: number;
  /** Price per share actually dealt at. */
  price: number;
  /** Commission and taxes, added to a buy's cost and taken off a sale's proceeds. */
  fee?: number;
  /**
   * Carried over from the days before the portfolio had dates.
   *
   * Its date is the day the migration ran, not the day anything was bought, so
   * anything that depends on a real trade date says it is unknown rather than
   * quietly dating the whole book to a Tuesday in August.
   */
  migrated?: boolean;
}

export interface Lot {
  ticker: string;
  shares: number;
  /** Average cost of the shares still held, fees included. */
  averageCost: number;
  /** What the remaining shares cost in total. */
  costBasis: number;
  /** Profit banked by sales of this ticker, fees included. */
  realised: number;
  /** The dates bounding this ticker's activity. */
  firstDate: string;
  lastDate: string;
  /** How many transactions this holding is built from. */
  count: number;
}

export function newTransactionId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function isValidTransaction(entry: Partial<Transaction>): entry is Transaction {
  return typeof entry.ticker === "string" && entry.ticker.length > 0
    && typeof entry.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    && (entry.kind === "buy" || entry.kind === "sell")
    && typeof entry.shares === "number" && Number.isFinite(entry.shares) && entry.shares > 0
    && typeof entry.price === "number" && Number.isFinite(entry.price) && entry.price >= 0;
}

/** Chronological, with a stable tie-break so a day's trades keep their order. */
export function sortTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/**
 * What is held, and what it cost, after replaying every transaction in order.
 *
 * Average cost rather than FIFO. It is what the previous model already
 * documented, it is what most brokerages show a retail account by default, and
 * it has the property that matters here: the cost of what remains does not
 * depend on which particular shares the reader imagines they sold. FIFO would
 * give a different realised figure per sale and the same total in the end.
 *
 * A sale of more shares than are held is clamped to the position rather than
 * rejected, and the excess is ignored: the reader is mid-typing, and a page
 * that throws away the rest of a correct history over one bad row is worse than
 * one that shows the position going flat.
 */
export function buildLots(transactions: Transaction[]): Record<string, Lot> {
  const lots: Record<string, Lot> = {};
  for (const entry of sortTransactions(transactions)) {
    if (!isValidTransaction(entry)) continue;
    const ticker = entry.ticker.toUpperCase();
    const lot = lots[ticker] ?? { ticker, shares: 0, averageCost: 0, costBasis: 0, realised: 0, firstDate: entry.date, lastDate: entry.date, count: 0 };
    const fee = entry.fee && Number.isFinite(entry.fee) ? entry.fee : 0;

    if (entry.kind === "buy") {
      // A fee paid to acquire is part of what the shares cost.
      lot.costBasis += entry.shares * entry.price + fee;
      lot.shares += entry.shares;
    } else {
      const sold = Math.min(entry.shares, lot.shares);
      if (sold > 0) {
        const costOfSold = lot.averageCost * sold;
        lot.realised += sold * entry.price - fee - costOfSold;
        lot.costBasis = Math.max(0, lot.costBasis - costOfSold);
        lot.shares -= sold;
      }
    }
    // Recomputed rather than carried, so a position sold to nothing and bought
    // again starts from its new cost instead of remembering the old one.
    lot.averageCost = lot.shares > 0 ? lot.costBasis / lot.shares : 0;
    if (lot.shares <= 0) lot.costBasis = lot.shares === 0 ? 0 : lot.costBasis;
    lot.lastDate = entry.date;
    if (entry.date < lot.firstDate) lot.firstDate = entry.date;
    lot.count += 1;
    lots[ticker] = lot;
  }
  return lots;
}

/** The holdings a valuation can be run against: what is still held today. */
export function positionsFromTransactions(transactions: Transaction[]): Position[] {
  return Object.values(buildLots(transactions))
    .filter((lot) => lot.shares > 1e-9)
    .map((lot) => ({ ticker: lot.ticker, shares: lot.shares, ...(lot.averageCost > 0 ? { cost: lot.averageCost } : {}) }));
}

/** Everything banked by sales, across every ticker. */
export function totalRealised(transactions: Transaction[]): number {
  return Object.values(buildLots(transactions)).reduce((sum, lot) => sum + lot.realised, 0);
}

/**
 * How many shares of a ticker were held at the end of a given day.
 *
 * The whole point of dating transactions: a value series drawn with today's
 * share counts would claim the reader owned their newest position for the last
 * ten years, and would draw a purchase made this morning as a decade of gains.
 */
export function sharesOn(transactions: Transaction[], ticker: string, date: string): number {
  let shares = 0;
  for (const entry of sortTransactions(transactions)) {
    if (entry.ticker.toUpperCase() !== ticker.toUpperCase() || entry.date > date) continue;
    if (!isValidTransaction(entry)) continue;
    shares = entry.kind === "buy" ? shares + entry.shares : Math.max(0, shares - entry.shares);
  }
  return shares;
}

/** The day the book begins. Nothing before it is worth drawing. */
export function firstTradeDate(transactions: Transaction[]): string | null {
  return sortTransactions(transactions.filter(isValidTransaction))[0]?.date ?? null;
}

/**
 * Money put in and taken out on a given day, across the whole book.
 *
 * A buy is money arriving in the portfolio and a sale is money leaving it. The
 * distinction matters for one reason: a deposit is not a gain. A book that goes
 * from £10k to £20k because £9k was paid in has returned ten percent, not a
 * hundred, and only the cash flows say which happened.
 */
export function flowsByDate(transactions: Transaction[]): Map<string, number> {
  const flows = new Map<string, number>();
  for (const entry of sortTransactions(transactions)) {
    if (!isValidTransaction(entry)) continue;
    const fee = entry.fee && Number.isFinite(entry.fee) ? entry.fee : 0;
    const amount = entry.kind === "buy" ? entry.shares * entry.price + fee : -(entry.shares * entry.price - fee);
    flows.set(entry.date, (flows.get(entry.date) ?? 0) + amount);
  }
  return flows;
}

/**
 * Each ticker's share count at every point it changed, oldest first.
 *
 * Built once and read many times. Answering "how many shares on this date"
 * by replaying the whole list per date, which is what `sharesOn` does, is fine
 * for one question and quadratic for a ten-year daily chart.
 */
export function shareTimeline(transactions: Transaction[]): Record<string, Array<{ date: string; shares: number }>> {
  const timeline: Record<string, Array<{ date: string; shares: number }>> = {};
  const running: Record<string, number> = {};
  for (const entry of sortTransactions(transactions)) {
    if (!isValidTransaction(entry)) continue;
    const ticker = entry.ticker.toUpperCase();
    const before = running[ticker] ?? 0;
    const after = entry.kind === "buy" ? before + entry.shares : Math.max(0, before - entry.shares);
    running[ticker] = after;
    const entries = timeline[ticker] ?? (timeline[ticker] = []);
    // Several trades on one day collapse to that day's closing position: a
    // daily price series cannot say anything about the order within a day.
    const last = entries.at(-1);
    if (last && last.date === entry.date) last.shares = after;
    else entries.push({ date: entry.date, shares: after });
  }
  return timeline;
}

/**
 * Turns the old standing positions into transactions, once.
 *
 * Anyone who used the portfolio before it had dates has a list of holdings with
 * no history attached. Discarding it would be the easy migration and the rude
 * one. Each becomes a single opening purchase, dated the day the migration
 * runs, which is the only honest date available — the old shape never recorded
 * when anything was bought. The figures that need a real date say so rather
 * than quietly treating today as the start of the book.
 */
export function transactionsFromPositions(positions: Position[], date: string): Transaction[] {
  return positions
    .filter((position) => Number.isFinite(position.shares) && position.shares > 0)
    .map((position, index) => ({
      id: `migrated-${position.ticker}-${index}`,
      ticker: position.ticker.toUpperCase(),
      date,
      kind: "buy" as const,
      shares: position.shares,
      price: position.cost ?? 0,
      migrated: true,
    }));
}
