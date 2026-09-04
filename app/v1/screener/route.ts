import { database } from "@/lib/runtime-env";
import { V1_CACHE, v1Error, v1Response } from "@/lib/api/v1/http";
import { V1_SCREENER_SORTS, queryPublishedScreener, type V1ScreenerSort } from "@/lib/api/v1/screener-d1";

function finiteNumber(value: string | null): number | null | undefined {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const minScore = finiteNumber(url.searchParams.get("minScore"));
  const limit = finiteNumber(url.searchParams.get("limit"));
  const sector = url.searchParams.get("sector")?.trim() || undefined;
  const sort = url.searchParams.get("sort") ?? "score";
  if (minScore === null || limit === null || (minScore != null && (minScore < 0 || minScore > 100))) {
    return v1Error(request, 400, "invalid_request", "minScore must be between 0 and 100 and limit must be numeric.", { retryable: false });
  }
  if (!V1_SCREENER_SORTS.includes(sort as V1ScreenerSort)) {
    return v1Error(request, 400, "invalid_request", `Unsupported sort. Use one of: ${V1_SCREENER_SORTS.join(", ")}.`, { retryable: false });
  }
  const db = database();
  if (!db) return v1Error(request, 503, "data_unavailable", "The D1 screener index is not configured yet.", { retryable: true });
  try {
    const data = await queryPublishedScreener(db, {
      minScore: minScore ?? undefined, sector, sort: sort as V1ScreenerSort,
      cursor: url.searchParams.get("cursor"), limit: limit ?? undefined,
    });
    if (!data) return v1Error(request, 503, "data_unavailable", "No score universe has been published yet.", { retryable: true });
    return v1Response(request, data, {
      dataVersion: data.universeVersion,
      scoreVersion: data.scoreVersion,
      asOf: data.publishedAt,
      retrievedAt: new Date().toISOString(),
      unit: "mixed",
      frequency: "point-in-time",
      status: "calculated",
    }, { cacheControl: V1_CACHE.screener });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_cursor") return v1Error(request, 400, "invalid_request", "Cursor is invalid for schema v1.", { retryable: false });
    return v1Error(request, 503, "data_unavailable", error instanceof Error ? error.message : "The screener index is unavailable.");
  }
}

