import { searchSecCompanies } from "@/lib/adapters/sec";
import { companyByTicker } from "@/lib/company-registry";
import { searchItem } from "@/lib/api/v1/company";
import { V1_CACHE, v1Error, v1Response } from "@/lib/api/v1/http";

const PAGE_SIZE = 20;

function readCursor(value: string | null): number | null {
  if (value == null || value === "") return 0;
  const match = /^v1:(\d+)$/.exec(value);
  if (!match) return null;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const offset = readCursor(url.searchParams.get("cursor"));
  if (!query || query.length > 100) {
    return v1Error(request, 400, "invalid_request", "Query q must contain between 1 and 100 characters.", { retryable: false });
  }
  if (offset == null) return v1Error(request, 400, "invalid_request", "Cursor is invalid for schema v1.", { retryable: false });

  try {
    const found = await searchSecCompanies(query, { offset, limit: PAGE_SIZE + 1 });
    const page = found.slice(0, PAGE_SIZE).map((profile) => searchItem(companyByTicker(profile.ticker) ?? profile));
    const now = new Date().toISOString();
    return v1Response(request, {
      query,
      results: page,
      nextCursor: found.length > PAGE_SIZE ? `v1:${offset + PAGE_SIZE}` : null,
    }, {
      dataVersion: "sec-company-registry-v1",
      asOf: now.slice(0, 10),
      retrievedAt: now,
      status: "reported",
    }, { cacheControl: V1_CACHE.search });
  } catch (error) {
    return v1Error(request, 502, "upstream_unavailable", error instanceof Error ? error.message : "Company search is unavailable.");
  }
}

