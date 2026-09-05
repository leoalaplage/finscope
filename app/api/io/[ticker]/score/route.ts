import { NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/adapters/quotes";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { fallbackSummaryKeys, summaryKey } from "@/lib/dataset-cache";
import { qsTable, qsValuationColumns, type QsRow } from "@/lib/qs-export";
import { screen } from "@/lib/qs/screener";
import { TICKER_PATTERN } from "@/lib/market-profile";
import { datasetCache } from "@/lib/runtime-env";
import type { WatchlistSummary } from "@/lib/watchlist-summary";

/**
 * One company's Quality Score, and the universe it was scored against.
 *
 * A score here is a rank, not a measurement: every metric is a percentile among
 * the companies it was scored with, so the same filer is a different number in
 * a different crowd. That makes the universe part of the answer rather than a
 * detail, and it is fixed and named — the twenty-seven largest S&P 500
 * securities — so a grade on one company page means the same thing as a grade
 * on another. A reader's own watchlist scores itself on the screener page,
 * where the list is visible and the comparison is the point.
 *
 * The engine is untouched: the rows are the digests this application already
 * stores, completed with the prices fetched now and handed over as a table —
 * the same text, under the same column titles a pasted export enters by.
 */
const UNIVERSE = DEFAULT_WATCHLIST.map((company) => company.ticker);
const UNIVERSE_LABEL = "the 27 largest S&P 500 securities";
const CACHE_SECONDS = 900;

async function digest(cache: KVNamespace, ticker: string): Promise<WatchlistSummary | null> {
  try {
    const current = await cache.get<WatchlistSummary>(summaryKey(ticker), "json");
    if (current) return current;
    for (const key of fallbackSummaryKeys(ticker)) {
      const previous = await cache.get<WatchlistSummary>(key, "json");
      if (previous) return previous;
    }
  } catch { /* One damaged digest costs one company, not the answer. */ }
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const symbol = ticker.toUpperCase();
  if (!TICKER_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "That is not a usable exchange symbol." }, { status: 400 });
  }
  const cache = datasetCache();
  if (!cache) return NextResponse.json({ error: "No cache is bound in this environment." }, { status: 503, headers: { "Cache-Control": "no-store" } });

  // The company asked about is scored inside the universe, not beside it: a
  // percentile has to be taken among the same crowd for everyone.
  const asked = [...new Set([...UNIVERSE, symbol])];
  const summaries = (await Promise.all(asked.map((item) => digest(cache, item))))
    .filter((item): item is WatchlistSummary => item?.qs != null);
  if (!summaries.some((item) => item.ticker.toUpperCase() === symbol)) {
    return NextResponse.json({ building: true, ticker: symbol }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const quotes = await fetchQuotes(summaries.map((item) => item.ticker));
    const priced = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
    const rows: QsRow[] = summaries.map((item) => {
      const quote = priced.get(item.ticker.toUpperCase()) ?? null;
      return {
        ticker: item.ticker,
        values: { ...item.qs, ...qsValuationColumns(item.qsPrice, quote?.price ?? null, quote?.currency ?? null) },
      };
    });
    const result = screen(qsTable(rows));
    const row = result.all.find((item) => item.Ticker.toUpperCase() === symbol) ?? null;
    if (!row) return NextResponse.json({ error: `${symbol} could not be scored.` }, { status: 422, headers: { "Cache-Control": "no-store" } });

    return NextResponse.json({
      ticker: row.Ticker,
      universe: { label: UNIVERSE_LABEL, size: result.all.length },
      grade: row.note,
      total: row.total,
      rank: row.rang,
      coverage: row.couverture,
      alerts: row.alertes_detail,
      pillars: row.piliers,
      strengths: row.forces.map(([name]) => name),
      weaknesses: row.faiblesses.map(([name]) => name),
      valuation: row.valuation,
    }, { headers: { "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600` } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The score could not be built." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
