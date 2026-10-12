import { expectedGrowth, nextTwelveMonthsEps, type Estimates } from "./estimates";

/** A compact, dated consensus row. Populated by the existing scheduled rotation. */
export const SCREENER_CONSENSUS_KEY = "screener-consensus:v1";
export interface ConsensusRow {
  ticker: string;
  asOf: string;
  eps: number | null;
  epsBasis: string;
  growth: number | null;
  revision: number | null;
  target: number | null;
  buyShare: number | null;
  analysts: number | null;
}
export interface ConsensusTable { builtAt: string; rows: ConsensusRow[] }

export function consensusRow(estimates: Estimates): ConsensusRow {
  const four = estimates.quarterly.slice(0, 4);
  const ntm = four.length === 4 && four.every((row) => row.consensus != null && Number.isFinite(row.consensus));
  const momentum = estimates.momentum?.year;
  const ratings = estimates.ratings;
  const total = ratings ? ratings.buy + ratings.hold + ratings.sell : 0;
  return {
    ticker: estimates.ticker, asOf: estimates.asOf,
    eps: nextTwelveMonthsEps(estimates),
    epsBasis: ntm ? `Next four quarters · ${four.map((row) => row.fiscalEnd).join(", ")}` : `Fiscal year · ${estimates.yearly[0]?.fiscalEnd ?? "unavailable"}`,
    growth: expectedGrowth(estimates),
    revision: momentum?.now != null && momentum.monthAgo != null && momentum.monthAgo > 0
      ? momentum.now / momentum.monthAgo - 1 : null,
    target: estimates.target?.mean ?? null,
    buyShare: total > 0 ? ratings!.buy / total : null,
    analysts: estimates.yearly[0]?.analysts ?? estimates.quarterly[0]?.analysts ?? null,
  };
}

/** A failed/empty provider response does not erase a dated, previously read row. */
export function mergeConsensus(previous: ConsensusTable | null, updates: ConsensusRow[], tickers: readonly string[], builtAt: string): ConsensusTable {
  const rows = new Map(previous?.rows.map((row) => [row.ticker, row]) ?? []);
  for (const update of updates) {
    if ([update.eps, update.growth, update.revision, update.target, update.buyShare, update.analysts].some((value) => value != null && Number.isFinite(value))) rows.set(update.ticker, update);
  }
  return { builtAt, rows: tickers.flatMap((ticker) => rows.has(ticker) ? [rows.get(ticker)!] : []) };
}
