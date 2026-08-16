import { NextResponse } from "next/server";
import { COMPANIES } from "@/lib/company-registry";
import { summaryKey } from "@/lib/dataset-cache";
import { datasetCache } from "@/lib/runtime-env";
import type { WatchlistSummary } from "@/lib/watchlist-summary";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

/**
 * Every watchlist company's headline figures, in one small response.
 *
 * The home page used to arrive empty, with a Load button on each of
 * twenty-two cards, because filling them meant fetching twenty-two six-megabyte
 * datasets. This reads the digests the daily warm already wrote — a few hundred
 * bytes each, no parsing of any filing — so the page arrives with numbers on it.
 *
 * A company with no digest yet is simply absent from the answer rather than
 * faked or zeroed, and its card says so and offers to build it.
 */
export async function GET() {
  const cache = datasetCache();
  if (!cache) return NextResponse.json({ summaries: [], reason: "No cache is bound in this environment." }, { headers });

  const summaries = await Promise.all(COMPANIES
    .filter((company) => company.resolutionStatus !== "unresolved")
    .map(async (company) => {
      try {
        const stored = await cache.get(summaryKey(company.ticker), "json");
        return stored as WatchlistSummary | null;
      } catch {
        // One unreadable key must not empty the whole watchlist.
        return null;
      }
    }));

  return new Response(JSON.stringify({ summaries: summaries.filter((item): item is WatchlistSummary => item != null) }), { headers });
}
