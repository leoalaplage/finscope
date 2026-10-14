import { NextResponse } from "next/server";
import { readServedUniverse } from "@/lib/universe-build";
import { readTechTable } from "@/lib/term/tech-universe";
import { datasetCache } from "@/lib/runtime-env";
import { SCREENER_CONSENSUS_KEY, type ConsensusTable } from "@/lib/screener-consensus";
import { screenerFeed } from "@/lib/screener-feed";
import { cachedJson } from "@/lib/market-cache";
import { peerTable } from "@/lib/peers";
import { TICKER_PATTERN } from "@/lib/market-profile";

/** A company's multiples against its sector's in the S&P 500 (lib/peers.ts), kept an hour. */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const symbol = decodeURIComponent((await context.params).ticker).toUpperCase();
  if (!TICKER_PATTERN.test(symbol)) return NextResponse.json({ error: "That is not a ticker." }, { status: 400 });
  const { body } = await cachedJson(`sector-peers:v2:${symbol}`, 1800, async () => {
    const [universe, technical, consensus] = await Promise.all([
      readServedUniverse(), readTechTable(),
      datasetCache()?.get<ConsensusTable>(SCREENER_CONSENSUS_KEY, "json").catch(() => null) ?? null,
    ]);
    return { table: peerTable(screenerFeed(universe, technical, consensus), symbol) };
  });
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=900, s-maxage=1800" } });
}
