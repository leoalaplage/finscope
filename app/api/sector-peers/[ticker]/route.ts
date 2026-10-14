import { NextResponse } from "next/server";
import { scopeTable } from "@/lib/universe-all";
import { readTechTable } from "@/lib/term/tech-universe";
import { datasetCache } from "@/lib/runtime-env";
import { SCREENER_CONSENSUS_KEY, type ConsensusTable } from "@/lib/screener-consensus";
import { screenerFeed } from "@/lib/screener-feed";
import { cachedJson } from "@/lib/market-cache";
import { peerTable } from "@/lib/peers";
import { TICKER_PATTERN } from "@/lib/market-profile";

/**
 * A company's multiples against its sector's (lib/peers.ts), kept half an
 * hour: among the thousand largest US companies, or — for a company smaller
 * than those — among every listed one, beside the companies of its own size.
 */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const symbol = decodeURIComponent((await context.params).ticker).toUpperCase();
  if (!TICKER_PATTERN.test(symbol)) return NextResponse.json({ error: "That is not a ticker." }, { status: 400 });
  const { body } = await cachedJson(`sector-peers:v3:${symbol}`, 1800, async () => {
    const [top, all, technical, consensus] = await Promise.all([
      scopeTable("us1000"), scopeTable("all"), readTechTable(),
      datasetCache()?.get<ConsensusTable>(SCREENER_CONSENSUS_KEY, "json").catch(() => null) ?? null,
    ]);
    const largest = peerTable(screenerFeed(top.table, technical, consensus, new Date(), top.members, "US 1000"), symbol);
    if (largest) return { table: largest };
    return { table: peerTable(screenerFeed(all.table, technical, consensus, new Date(), all.members, "All US"), symbol, "nearest") };
  });
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=900, s-maxage=1800" } });
}
