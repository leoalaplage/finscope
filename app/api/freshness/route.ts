import { fetchLatestFiling } from "@/lib/adapters/sec";
import { COVERED_TICKERS, companyByTicker } from "@/lib/company-registry";
import { requestedTickers, summaryKey } from "@/lib/dataset-cache";
import { datasetCache } from "@/lib/runtime-env";
import type { WatchlistSummary } from "@/lib/watchlist-summary";

/**
 * How many companies one request may ask the SEC about.
 *
 * Each answer is a couple of hundred kilobytes to fetch and parse, so a reader
 * checking sixty companies must not turn that into one request. The page asks
 * in batches and shows them filling in, which is also the honest thing to
 * show: this is a check that takes a moment, not a cached figure.
 */
const BATCH = 6;

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export interface FreshnessRow {
  ticker: string;
  /** The latest period FinScope holds for this company. */
  held: string | null;
  /** When those filings were read. */
  readAt: string | null;
  /** The most recent periodic report the SEC has, and the period it covers. */
  filed: { form: string; filingDate: string; reportDate: string } | null;
  status: "current" | "behind" | "unknown";
  note?: string;
}

/**
 * Whether what FinScope holds for each company is the latest the SEC has.
 *
 * The check a reader could not make before. Veeva published a quarter and the
 * site showed the previous one for days, and nothing on any screen could have
 * told you that — every figure was internally consistent and every one of them
 * was out of date. Asking our own cache whether it is current is circular; this
 * asks the SEC.
 *
 * The comparison is period against period, not timestamp against timestamp: a
 * company that has filed nothing since May is perfectly current in August, and
 * a clock cannot tell the difference.
 */
export async function GET(request: Request) {
  const asked = requestedTickers(new URL(request.url).searchParams.get("tickers"), COVERED_TICKERS).slice(0, BATCH);
  const cache = datasetCache();

  const rows = await Promise.all(asked.map(async (ticker): Promise<FreshnessRow> => {
    let summary: WatchlistSummary | null = null;
    try {
      summary = (await cache?.get(summaryKey(ticker), "json")) as WatchlistSummary | null;
    } catch {
      // Treated as "nothing held", which is what the reader needs to know.
    }
    const cik = summary?.cik || companyByTicker(ticker)?.cik || "";
    const held = summary?.periodEnd ?? null;
    const readAt = summary?.retrievedAt ?? null;

    if (!cik) {
      return { ticker, held, readAt, filed: null, status: "unknown", note: held ? "No regulatory identifier, so the filings cannot be checked" : "Not loaded yet" };
    }
    try {
      const filed = await fetchLatestFiling(cik);
      if (!filed) return { ticker, held, readAt, filed: null, status: "unknown", note: "The SEC lists no periodic report for this filer" };
      if (!held) return { ticker, held, readAt, filed, status: "unknown", note: "Not loaded yet" };
      // A dataset may legitimately reach past the last *report* date when it
      // carries a period the filer has since restated, so this is not equality.
      return { ticker, held, readAt, filed, status: held >= filed.reportDate ? "current" : "behind" };
    } catch (error) {
      return { ticker, held, readAt, filed: null, status: "unknown", note: error instanceof Error ? error.message : "The SEC could not be reached" };
    }
  }));

  return new Response(JSON.stringify({ rows }), { headers });
}
