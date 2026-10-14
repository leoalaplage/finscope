import { cachedJson } from "./market-cache";
import { readTechTable } from "./term/tech-universe";
import { datasetCache } from "./runtime-env";
import { SCREENER_CONSENSUS_KEY, type ConsensusTable } from "./screener-consensus";
import { compactFeed, expandFeed, screenerFeed, type CompactFeed, type ScreenerFeed } from "./screener-feed";
import { scopeTable } from "./universe-all";
import { SCOPES, type Scope } from "./scopes";

/**
 * The screener's feed for a scope beyond the S&P 500, in columns, built once
 * every ten minutes and shared: the screener answers with it as it is, the
 * PEER panel reads its sector from it rather than joining five thousand rows
 * again for every company opened.
 */
export async function scopedFeedBody(scope: Exclude<Scope, "sp500">): Promise<string> {
  const { body } = await cachedJson(`screener-scope:v1:${scope}`, 600, async () => {
    const [{ table, members }, technical, consensus] = await Promise.all([
      scopeTable(scope), readTechTable(),
      datasetCache()?.get<ConsensusTable>(SCREENER_CONSENSUS_KEY, "json").catch(() => null) ?? null,
    ]);
    return compactFeed(screenerFeed(table, technical, consensus, new Date(), members, SCOPES.find((entry) => entry.id === scope)!.label));
  });
  return body;
}

export async function scopedFeed(scope: Exclude<Scope, "sp500">): Promise<ScreenerFeed> {
  return expandFeed(JSON.parse(await scopedFeedBody(scope)) as CompactFeed);
}
