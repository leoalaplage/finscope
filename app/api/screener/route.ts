import { readServedUniverse } from "@/lib/universe-build";
import { readTechTable } from "@/lib/term/tech-universe";
import { datasetCache } from "@/lib/runtime-env";
import { SCREENER_CONSENSUS_KEY, type ConsensusTable } from "@/lib/screener-consensus";
import { compactFeed, screenerFeed } from "@/lib/screener-feed";
import { scopeTable } from "@/lib/universe-all";
import { isScope, SCOPES } from "@/lib/listed-universe";
import { cachedJson } from "@/lib/market-cache";

/** Reads only prepared snapshots; a reader never fans out to 500 providers. */
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get("scope");
  const scope = isScope(asked) ? asked : "sp500";
  if (scope !== "sp500") {
    // Beyond the S&P 500: the joined table, kept ten minutes, its rows in columns.
    const { body } = await cachedJson(`screener-scope:v1:${scope}`, 600, async () => {
      const [{ table, members }, technical, consensus] = await Promise.all([
        scopeTable(scope), readTechTable(),
        datasetCache()?.get<ConsensusTable>(SCREENER_CONSENSUS_KEY, "json").catch(() => null) ?? null,
      ]);
      return compactFeed(screenerFeed(table, technical, consensus, new Date(), members, SCOPES.find((entry) => entry.id === scope)!.label));
    });
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60, s-maxage=300" } });
  }
  const [universe, technical, consensus] = await Promise.all([
    readServedUniverse(), readTechTable(),
    datasetCache()?.get<ConsensusTable>(SCREENER_CONSENSUS_KEY, "json").catch(() => null) ?? null,
  ]);
  const feed = screenerFeed(universe, technical, consensus);
  return Response.json(feed, { status: feed.coverage.fundamental ? 200 : 202, headers: {
    "Cache-Control": feed.coverage.fundamental ? "public, max-age=60, s-maxage=300" : "no-store",
  } });
}
