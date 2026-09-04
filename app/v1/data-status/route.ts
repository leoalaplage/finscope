import { database, datasetCache } from "@/lib/runtime-env";
import { FINANCIAL_DATA_VERSION, QUALITY_SCORE_VERSION, WATCHLIST_UNIVERSE_VERSION } from "@/lib/api/v1/contracts";
import { V1_CACHE, v1Response } from "@/lib/api/v1/http";

export async function GET(request: Request) {
  const now = new Date().toISOString();
  const kvAvailable = datasetCache() != null;
  const d1Available = database() != null;
  const warnings = [
    ...(!kvAvailable ? ["KV financial document cache is not bound."] : []),
    ...(!d1Available ? ["D1 screener index is not bound; indexed screener results are unavailable."] : []),
  ];
  return v1Response(request, {
    service: warnings.length ? "degraded" : "operational",
    financials: { available: kvAvailable, dataVersion: FINANCIAL_DATA_VERSION },
    qualityScore: { available: kvAvailable, scoreVersion: QUALITY_SCORE_VERSION, universeVersion: WATCHLIST_UNIVERSE_VERSION },
    screener: { available: d1Available, universeVersion: d1Available ? WATCHLIST_UNIVERSE_VERSION : null },
  }, {
    dataVersion: FINANCIAL_DATA_VERSION,
    scoreVersion: QUALITY_SCORE_VERSION,
    asOf: now,
    retrievedAt: now,
    frequency: "point-in-time",
    status: warnings.length ? "unavailable" : "reported",
    warnings,
  }, { cacheControl: V1_CACHE.none });
}

