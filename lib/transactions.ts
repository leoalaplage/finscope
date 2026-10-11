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

/**
 * Trades typed one a line, the way a contract note reads.
 *
 * `2024-03-01 BUY AAPL 10 @ 150.25 fee 1` — a date, a side, a ticker, a share
 * count, the price, and optionally a fee. The side may be written buy, b,
 * achat, sell, s or vente; the date as `YYYY-MM-DD` or `DD/MM/YYYY`. A line
 * that is not yet complete is skipped in silence: this runs on every
 * keystroke.
 */
export function parseTrades(text: string): Transaction[] {
  const trades: Transaction[] = [];
  for (const [index, line] of text.split(/\n+/).entries()) {
    const match = line.trim().match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\s+(buy|b|achat|acheter|sell|s|vente|vendre)\s+([A-Za-z][A-Za-z0-9.-]{0,11})\s+([\d.,]+)\s*(?:@|at|à|x)?\s*\$?([\d.,]+)(?:\s+(?:fee|frais|comm)?\s*\$?([\d.,]+))?/i);
    if (!match) continue;
    const date = match[1].includes("/")
      ? (() => { const [day, month, year] = match[1].split("/").map(Number); return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; })()
      : match[1];
    const number = (text: string | undefined) => (text == null ? null : Number(text.replace(/,(?=\d{3}\b)/g, "").replace(",", ".")));
    const shares = number(match[4]); const price = number(match[5]); const fee = number(match[6]);
    const entry = {
      id: `typed-${index}-${match[3].toUpperCase()}-${match[1]}`, ticker: match[3].toUpperCase(), date,
      kind: /^(sell|s|vente|vendre)$/i.test(match[2]) ? "sell" as const : "buy" as const,
      shares: shares ?? 0, price: price ?? -1, ...(fee ? { fee } : {}),
    };
    if (isValidTransaction(entry)) trades.push(entry);
  }
  return trades;
}

/** The trades back into the lines `parseTrades` reads, oldest first. */
export function writeTrades(transactions: Transaction[]): string {
  return sortTransactions(transactions.filter(isValidTransaction)).map((entry) =>
    `${entry.date} ${entry.kind.toUpperCase()} ${entry.ticker} ${entry.shares} @ ${Number(entry.price.toFixed(4))}${entry.fee ? ` fee ${entry.fee}` : ""}`).join("\n");
}

/**
 * The money-weighted return: the one annual rate at which every amount paid in
 * and taken out, and what is held today, net to nothing. Unlike the
 * time-weighted return it rewards putting more in before a rise — it is the
 * investor's own return, timing and all.
 */
export function xirr(transactions: Transaction[], value: number, today: string): number | null {
  const flows = sortTransactions(transactions.filter(isValidTransaction)).map((entry) => {
    const fee = entry.fee ?? 0;
    return { date: entry.date, amount: entry.kind === "buy" ? -(entry.shares * entry.price + fee) : entry.shares * entry.price - fee };
  });
  flows.push({ date: today, amount: value });
  if (!flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;
  const start = Date.parse(flows[0].date);
  const years = flows.map((flow) => (Date.parse(flow.date) - start) / (365.25 * 86_400_000));
  if (years.at(-1)! < 1 / 52) return null;
  const npv = (rate: number) => flows.reduce((sum, flow, index) => sum + flow.amount / (1 + rate) ** years[index], 0);
  // Bisection between −99% and +1,000% a year: slow, and never diverges.
  let low = -0.99; let high = 10;
  if (npv(low) * npv(high) > 0) return null;
  for (let step = 0; step < 200; step++) {
    const middle = (low + high) / 2;
    if (npv(low) * npv(middle) <= 0) high = middle; else low = middle;
    if (high - low < 1e-7) break;
  }
  return (low + high) / 2;
}

/** Money put in, net of money taken out, at every date it changed. */
export function investedTimeline(transactions: Transaction[]): Array<{ date: string; value: number }> {
  let running = 0;
  const out: Array<{ date: string; value: number }> = [];
  for (const [date, amount] of [...flowsByDate(transactions).entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    running += amount;
    out.push({ date, value: running });
  }
  return out;
}

/** What a ticker added over a window: its value at the end, less its value at the start, less what was paid in. */
export function tradedContribution(
  transactions: Transaction[],
  ticker: string,
  closes: Array<{ date: string; value: number }>,
  from: string,
): number | null {
  if (!closes.length) return null;
  const at = (date: string) => { let found: number | null = null; for (const point of closes) { if (point.date > date) break; found = point.value; } return found; };
  const start = at(from) ?? 0;
  const end = closes[closes.length - 1].value;
  const startShares = sharesOn(transactions, ticker, from);
  const endShares = sharesOn(transactions, ticker, closes[closes.length - 1].date);
  const flows = sortTransactions(transactions.filter(isValidTransaction))
    .filter((entry) => entry.ticker.toUpperCase() === ticker.toUpperCase() && entry.date > from)
    .reduce((sum, entry) => sum + (entry.kind === "buy" ? entry.shares * entry.price + (entry.fee ?? 0) : -(entry.shares * entry.price - (entry.fee ?? 0))), 0);
  return endShares * end - startShares * start - flows;
}

/** Every trade with what it did: the amount, the position after it, and a sale's realised gain. */
export function ledger(transactions: Transaction[]): Array<Transaction & { amount: number; after: number; realised: number | null }> {
  const held: Record<string, { shares: number; cost: number }> = {};
  return sortTransactions(transactions.filter(isValidTransaction)).map((entry) => {
    const ticker = entry.ticker.toUpperCase();
    const lot = held[ticker] ?? (held[ticker] = { shares: 0, cost: 0 });
    const fee = entry.fee ?? 0;
    let realised: number | null = null;
    if (entry.kind === "buy") { lot.cost += entry.shares * entry.price + fee; lot.shares += entry.shares; }
    else {
      const sold = Math.min(entry.shares, lot.shares);
      const average = lot.shares > 0 ? lot.cost / lot.shares : 0;
      realised = sold * entry.price - fee - average * sold;
      lot.cost = Math.max(0, lot.cost - average * sold); lot.shares -= sold;
    }
    return { ...entry, amount: entry.shares * entry.price + (entry.kind === "buy" ? fee : -fee), after: lot.shares, realised };
  });
}
