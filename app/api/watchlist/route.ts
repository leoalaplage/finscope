import { NextResponse } from "next/server";
import { COVERED_TICKERS } from "@/lib/company-registry";
import { requestedTickers, summaryKey } from "@/lib/dataset-cache";
import { datasetCache } from "@/lib/runtime-env";
import type { WatchlistSummary } from "@/lib/watchlist-summary";

/**
 * How long an answer may be reused, by how complete it is.
 *
 * A full watchlist is worth caching for an hour. An answer still missing
 * companies is worth caching for no time at all: the warm running behind this
 * request is about to make it wrong, and a reader who polls for the rest would
 * otherwise be served the same gap back for an hour and conclude the site is
 * broken.
 */
const complete = "public, s-maxage=3600, stale-while-revalidate=86400";
const partial = "no-store";

const headers = { "Content-Type": "application/json", "Cache-Control": partial };

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
export async function GET(request: Request) {
  const cache = datasetCache();
  if (!cache) return NextResponse.json({ summaries: [], pending: [], reason: "No cache is bound in this environment." }, { headers });

  // The reader's own watchlist, which is not this file's list: companies they
  // added themselves are exactly the ones no digest was ever written for.
  const covered = requestedTickers(new URL(request.url).searchParams.get("tickers"), COVERED_TICKERS);
  const summaries = await Promise.all(covered
    .map(async (ticker) => {
      try {
        const stored = await cache.get(summaryKey(ticker), "json");
        return stored as WatchlistSummary | null;
      } catch {
        // One unreadable key must not empty the whole watchlist.
        return null;
      }
    }));

  const found = summaries.filter((item): item is WatchlistSummary => item != null);
  // Which companies the warm behind this request is still working through, so
  // the page can say "building" and come back for them rather than settling on
  // an empty card and a Load button the reader has to find and press.
  const pending = covered.filter((ticker) => !found.some((item) => item.ticker.toUpperCase() === ticker));

  return new Response(JSON.stringify({ summaries: found, pending }), {
    headers: { ...headers, "Cache-Control": pending.length ? partial : complete },
  });
}
