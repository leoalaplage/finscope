import { fetchQuotes } from "../../adapters/quotes";
import { COVERED_TICKERS, companyByTicker } from "../../company-registry";
import { fallbackSummaryKeys, summaryKey } from "../../dataset-cache";
import { qsStructuredInputFromRow, qsValuationColumns } from "../../qs-export";
import { screenStructured, type ScoredCompany } from "../../qs/screener";
import { datasetCache } from "../../runtime-env";
import type { WatchlistSummary } from "../../watchlist-summary";
import { QUALITY_SCORE_VERSION, WATCHLIST_UNIVERSE_VERSION } from "./contracts";

export interface V1QualityScoreData {
  ticker: string;
  scoreVersion: string;
  universeVersion: string;
  fundamentalsAsOf: string;
  priceAsOf: string | null;
  total: number | null;
  quality: number | null;
  health: number | null;
  growth: number | null;
  value: number | null;
  coverage: number;
  grade: string;
  rank: number;
  alerts: string[];
  strengths: string[];
  weaknesses: string[];
  units: {
    total: "score-0-100";
    pillars: "score-0-100";
    coverage: "ratio-0-1";
    rank: "ordinal";
  };
}

export interface ScoredUniverse {
  rows: ScoredCompany[];
  summaries: Map<string, WatchlistSummary>;
  priceAsOf: Map<string, string | null>;
  warnings: string[];
}

async function cachedSummary(ticker: string): Promise<WatchlistSummary | null> {
  const cache = datasetCache();
  if (!cache) return null;
  try {
    const current = await cache.get<WatchlistSummary>(summaryKey(ticker), "json");
    if (current) return current;
    for (const key of fallbackSummaryKeys(ticker)) {
      const previous = await cache.get<WatchlistSummary>(key, "json");
      if (previous) return previous;
    }
  } catch {
    // One damaged digest is omitted; coverage is reported to the caller.
  }
  return null;
}

export async function scoreCachedUniverse(): Promise<ScoredUniverse> {
  const found = (await Promise.all(COVERED_TICKERS.map(cachedSummary))).filter((summary): summary is WatchlistSummary => summary != null);
  if (found.length !== COVERED_TICKERS.length) {
    throw new Error(`The score universe is incomplete: ${found.length} of ${COVERED_TICKERS.length} configured companies are available.`);
  }
  const quotes = await fetchQuotes(found.map((summary) => companyByTicker(summary.ticker)?.yahooTicker ?? summary.ticker));
  const bySymbol = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
  const timestamps = new Map<string, string | null>();
  const inputs = found.map((summary) => {
    const symbol = companyByTicker(summary.ticker)?.yahooTicker ?? summary.ticker;
    const quote = bySymbol.get(symbol.toUpperCase()) ?? null;
    timestamps.set(summary.ticker, quote?.asOf ?? null);
    const values = {
      ...summary.qs,
      ...qsValuationColumns(summary.qsPrice, quote?.price ?? null, quote?.currency ?? null),
    };
    return qsStructuredInputFromRow({ ticker: summary.ticker, values });
  });
  return {
    rows: screenStructured(inputs).all,
    summaries: new Map(found.map((summary) => [summary.ticker.toUpperCase(), summary])),
    priceAsOf: timestamps,
    warnings: [],
  };
}

export function qualityScoreData(row: ScoredCompany, summary: WatchlistSummary, priceAsOf: string | null): V1QualityScoreData {
  return {
    ticker: row.Ticker,
    scoreVersion: QUALITY_SCORE_VERSION,
    universeVersion: WATCHLIST_UNIVERSE_VERSION,
    fundamentalsAsOf: summary.periodEnd,
    priceAsOf,
    total: row.total,
    quality: row.piliers.Quality,
    health: row.piliers.Health,
    growth: row.piliers.Growth,
    value: row.piliers.Value,
    coverage: row.couverture,
    grade: row.note,
    rank: row.rang,
    alerts: row.alertes_detail,
    strengths: row.forces.map(([name]) => name),
    weaknesses: row.faiblesses.map(([name]) => name),
    units: { total: "score-0-100", pillars: "score-0-100", coverage: "ratio-0-1", rank: "ordinal" },
  };
}
