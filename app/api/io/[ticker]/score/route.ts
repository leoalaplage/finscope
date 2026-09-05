import { NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/adapters/quotes";
import { fallbackSummaryKeys, summaryKey } from "@/lib/dataset-cache";
import { qsTable, qsValuationColumns, type QsRow } from "@/lib/qs-export";
import { screen } from "@/lib/qs/screener";
import { asStrength, asWeakness } from "@/lib/qs/standing";
import { TICKER_PATTERN } from "@/lib/market-profile";
import { datasetCache } from "@/lib/runtime-env";
import type { WatchlistSummary } from "@/lib/watchlist-summary";

/**
 * One company's Quality Score, measured against a fixed scale.
 *
 * The score used to be a rank: every metric became a percentile among a fixed
 * crowd of twenty-seven, so the same filer was a different number in a
 * different crowd, and the crowd had to be named on screen for the grade to
 * mean anything. It also made a company's valuation look attractive merely
 * because its neighbours were dearer.
 *
 * Now each metric is read against published anchors — nought, fifty and a
 * hundred, set from analysis convention rather than from any table — so this
 * endpoint scores the one company it was asked about and nothing else. That is
 * a grade you can compare across pages, and one digest and one price to build
 * it from instead of twenty-eight of each.
 */
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

  const summary = await digest(cache, symbol);
  if (!summary?.qs) {
    return NextResponse.json({ building: true, ticker: symbol }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const [quote] = await fetchQuotes([summary.ticker]);
    const row: QsRow = {
      ticker: summary.ticker,
      values: { ...summary.qs, ...qsValuationColumns(summary.qsPrice, quote?.price ?? null, quote?.currency ?? null) },
    };
    const scored = screen(qsTable([row])).all[0] ?? null;
    if (!scored) return NextResponse.json({ error: `${symbol} could not be scored.` }, { status: 422, headers: { "Cache-Control": "no-store" } });

    return NextResponse.json({
      ticker: scored.Ticker,
      grade: scored.note,
      total: scored.total,
      coverage: scored.couverture,
      alerts: scored.alertes_detail,
      pillars: scored.piliers,
      // Read as a statement about this company rather than as the virtue the
      // criterion is named after: a company scored badly on long-term debt has
      // a great deal of it, and saying its weakness is "low LT debt" says the
      // opposite of the finding.
      strengths: scored.forces.map(([name]) => asStrength(name)),
      weaknesses: scored.faiblesses.map(([name]) => asWeakness(name)),
      valuation: scored.valuation,
    }, { headers: { "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600` } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The score could not be built." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
