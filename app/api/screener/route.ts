import { readServedUniverse } from "@/lib/universe-build";
import { readTechTable } from "@/lib/term/tech-universe";
import { datasetCache } from "@/lib/runtime-env";
import { SCREENER_CONSENSUS_KEY, type ConsensusTable } from "@/lib/screener-consensus";
import { screenerFeed } from "@/lib/screener-feed";

/** Reads only prepared snapshots; a reader never fans out to 500 providers. */
export async function GET() {
  const [universe, technical, consensus] = await Promise.all([
    readServedUniverse(), readTechTable(),
    datasetCache()?.get<ConsensusTable>(SCREENER_CONSENSUS_KEY, "json").catch(() => null) ?? null,
  ]);
  const feed = screenerFeed(universe, technical, consensus);
  return Response.json(feed, { status: feed.coverage.fundamental ? 200 : 202, headers: {
    "Cache-Control": feed.coverage.fundamental ? "public, max-age=60, s-maxage=300" : "no-store",
  } });
}
