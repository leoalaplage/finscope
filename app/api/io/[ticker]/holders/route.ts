import { NextResponse } from "next/server";
import { HOLDERS_SHAPE, holdersKey, type HoldersRecord } from "@/lib/holders";
import { resolveMarketProfile } from "@/lib/market-profile";
import { datasetCache } from "@/lib/runtime-env";

/**
 * The institutional managers holding one company, from the SEC's 13F archive.
 *
 * Nothing is computed here. Every manager with over $100m under discretion
 * reports its US equity positions quarterly, the SEC republishes the whole
 * quarter as one archive of about four million holdings, and
 * `scripts/fetch-13f-holders.mjs` reduces it to one key a company. A request
 * reads that key and stops — the aggregation is four hundred megabytes and
 * twelve seconds of work, which is a quarterly job on a machine with a disk,
 * not something a page waits for.
 *
 * A company with no key is a company no manager reported, or one whose quarter
 * has not been built. Both are answered as nothing rather than as zero.
 */
const CACHE_SECONDS = 86_400;

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const company = resolveMarketProfile(ticker);
  if (!company) return NextResponse.json({ error: "That is not a usable exchange symbol." }, { status: 400 });

  const cache = datasetCache();
  if (!cache) return NextResponse.json({ error: "The holdings archive is not bound in this environment." }, { status: 503 });

  try {
    const record = await cache.get<HoldersRecord>(holdersKey(company.ticker), "json");
    if (!record) {
      return NextResponse.json(
        { error: `No 13F manager reported a position in ${company.ticker} for the quarter on file.` },
        { status: 404 },
      );
    }
    return new Response(JSON.stringify({ ticker: company.ticker, shape: HOLDERS_SHAPE, ...record }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The holdings archive could not be read." },
      { status: 502 },
    );
  }
}
