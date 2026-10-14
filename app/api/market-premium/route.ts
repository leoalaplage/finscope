import { readServedUniverse } from "@/lib/universe-build";
import { readTechTable } from "@/lib/term/tech-universe";
import { datasetCache } from "@/lib/runtime-env";
import { SCREENER_CONSENSUS_KEY, type ConsensusTable } from "@/lib/screener-consensus";
import { screenerFeed } from "@/lib/screener-feed";
import { cachedJson } from "@/lib/market-cache";
import { marketPremium } from "@/lib/implied-erp";

/**
 * Today's equity risk premium, read from the S&P 500 (lib/implied-erp.ts), for
 * the Treasury rate the page already holds. Built from the screener's prepared
 * snapshots, kept six hours: the index's yield and its consensus move slowly.
 */
export async function GET(request: Request) {
  const asked = Number(new URL(request.url).searchParams.get("rf"));
  const riskFree = Number.isFinite(asked) && asked > 0 && asked < 0.25 ? Math.round(asked * 2000) / 2000 : null;
  const { body } = await cachedJson(`market-premium:v1:${riskFree ?? "none"}`, 6 * 3600, async () => {
    const [universe, technical, consensus] = await Promise.all([
      readServedUniverse(), readTechTable(),
      datasetCache()?.get<ConsensusTable>(SCREENER_CONSENSUS_KEY, "json").catch(() => null) ?? null,
    ]);
    return { ...marketPremium(screenerFeed(universe, technical, consensus), riskFree), asOf: new Date().toISOString() };
  }, (value) => (value.fallback ? "partial" : "full"));
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800, s-maxage=3600" } });
}
