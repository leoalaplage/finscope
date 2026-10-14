import { NextResponse } from "next/server";
import { fetchLatestEarningsRelease, readRelease, type ReleaseReading } from "@/lib/adapters/earnings";
import { TICKER_PATTERN } from "@/lib/market-profile";
import { cachedJson } from "@/lib/market-cache";
import { ioViewKey } from "@/lib/io/view-version";
import { releaseQuarter } from "@/lib/io/release-anchors";
import type { IoCompanyView } from "@/lib/io/view";
import { datasetCache } from "@/lib/runtime-env";

/**
 * Earnings announcements change on the filing clock, independently of the
 * normalized statements. Kept apart from the day-long company view so a fresh
 * 8-K is on the page within minutes, while Company Facts still holds the
 * previous quarter — for days, and for a bank's 10-Q, weeks.
 *
 * The release's figures are read once per filing and kept: an 8-K never
 * changes. What changes is whether there is a new one, which is asked every
 * two minutes at most.
 */
const CACHE_SECONDS = 120;
const READING_SECONDS = 30 * 86_400;
const CIK_PATTERN = /^\d{1,10}$/;

/** The company as the page draws it, from the store: what a release is checked against. */
async function storedView(symbol: string): Promise<IoCompanyView | null> {
  try {
    return (await datasetCache()?.get<IoCompanyView>(ioViewKey(symbol), "json")) ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const symbol = ticker.toUpperCase();
  const cik = new URL(request.url).searchParams.get("cik") ?? "";
  if (!TICKER_PATTERN.test(symbol) || !CIK_PATTERN.test(cik)) {
    return NextResponse.json({ error: "A valid exchange symbol and SEC CIK are required." }, { status: 400 });
  }

  try {
    const filing = await fetchLatestEarningsRelease(cik);
    let reading: ReleaseReading | null = null;
    const view = filing ? await storedView(symbol) : null;
    const filed = view ? [...view.quarterly, ...view.annual].map((period) => period.publishedAt.slice(0, 10)).sort().at(-1) ?? null : null;
    // Only a release newer than every filed figure is news; it reports the quarter after the latest filed one.
    const quarter = view && filing && filed && filing.filingDate > filed ? releaseQuarter(view.quarterly) : null;
    if (filing && quarter) {
      const { body } = await cachedJson<ReleaseReading | null>(
        `release:v1:${filing.accession}:${quarter.end}`,
        READING_SECONDS,
        () => readRelease(filing, { label: quarter.label, end: quarter.end, quarter: quarter.quarter, yearAgoLabel: quarter.yearAgo.label, anchors: quarter.anchors, check: quarter.check }),
      );
      reading = JSON.parse(body) as ReleaseReading | null;
    }
    return NextResponse.json({ ticker: symbol, cik: cik.padStart(10, "0"), filing: filing ? { ...filing, reading } : null }, {
      headers: { "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 5}` },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The SEC filing index is unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
