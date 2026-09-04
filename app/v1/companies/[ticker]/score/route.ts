import { QUALITY_SCORE_VERSION, WATCHLIST_UNIVERSE_VERSION } from "@/lib/api/v1/contracts";
import { V1_CACHE, v1Error, v1Response } from "@/lib/api/v1/http";
import { qualityScoreData, scoreCachedUniverse } from "@/lib/api/v1/quality-score";
import { TICKER_PATTERN } from "@/lib/market-profile";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const symbol = (await context.params).ticker.toUpperCase();
  if (!TICKER_PATTERN.test(symbol)) return v1Error(request, 400, "invalid_request", "That is not a usable exchange symbol.", { retryable: false });
  try {
    const universe = await scoreCachedUniverse();
    const row = universe.rows.find((candidate) => candidate.Ticker.toUpperCase() === symbol);
    const summary = universe.summaries.get(symbol);
    if (!row || !summary) return v1Error(request, 404, "not_found", "This company is not present in the published score universe.", { retryable: false });
    const data = qualityScoreData(row, summary, universe.priceAsOf.get(summary.ticker) ?? null);
    return v1Response(request, data, {
      dataVersion: WATCHLIST_UNIVERSE_VERSION,
      scoreVersion: QUALITY_SCORE_VERSION,
      asOf: data.priceAsOf ?? data.fundamentalsAsOf,
      retrievedAt: new Date().toISOString(),
      currency: summary.currency,
      unit: "score-0-100",
      frequency: "point-in-time",
      status: "calculated",
      warnings: universe.warnings,
    }, { cacheControl: V1_CACHE.screener });
  } catch (error) {
    return v1Error(request, 503, "data_unavailable", error instanceof Error ? error.message : "The score universe is unavailable.", {
      meta: { scoreVersion: QUALITY_SCORE_VERSION, dataVersion: WATCHLIST_UNIVERSE_VERSION },
    });
  }
}

