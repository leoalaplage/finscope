import { NextResponse } from "next/server";
import { TICKER_PATTERN } from "@/lib/market-profile";
import { SEGMENTS_BUILD } from "@/lib/segments/build";
import { allEdges, suppliersFrom } from "@/lib/segments/relations";
import { getSegments } from "@/lib/segments/store";
import { UNIVERSE, universeMember } from "@/lib/universe";

/**
 * SPLC: a company's customers as its own reports name them, and the companies
 * of the index whose reports name it (lib/segments/customers.ts,
 * lib/segments/relations.ts).
 *
 * The customers come with the company's segments, so a company whose segments
 * were built before customers were read (build 4) answers `pending` and is
 * rebuilt behind. The suppliers are only those whose own build has been read
 * since: `companies` says how many of the index that is.
 */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await context.params).ticker).toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) return NextResponse.json({ error: "That is not a ticker." }, { status: 400 });
  try {
    const [segments, index] = await Promise.all([getSegments(ticker).catch(() => null), allEdges().catch(() => ({ edges: new Map(), companies: 0 }))]);
    const pending = !segments || (segments.build ?? 1) < SEGMENTS_BUILD || !segments.customers;
    return NextResponse.json({
      ticker,
      customers: segments?.customers ?? [],
      pending,
      builtAt: segments?.builtAt ?? null,
      reports: segments?.filings.length ?? 0,
      suppliers: suppliersFrom(index.edges, ticker).map((supplier) => ({ ...supplier, name: universeMember(supplier.ticker)?.name ?? null })),
      companies: index.companies,
      universe: UNIVERSE.length,
    }, { headers: { "Cache-Control": pending ? "public, max-age=120" : "public, max-age=1800, s-maxage=3600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Relations are unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
