import { datasetCache } from "./runtime-env";
import { UNIVERSE, type UniverseMember } from "./universe";

/**
 * The companies the consensus and the technical snapshots are kept for: the
 * S&P 500, and the rest of the thousand largest US-listed companies — the
 * "US 1000" scope — as the all-US build last ranked them
 * (lib/universe-all.ts writes the list). The S&P 500 alone until it has.
 */
export const US1000_EXTRA_KEY = "us1000-extra:v1";

export async function coveredMembers(): Promise<UniverseMember[]> {
  const extra = await datasetCache()?.get<UniverseMember[]>(US1000_EXTRA_KEY, "json").catch(() => null);
  const index = new Set(UNIVERSE.map((member) => member.ticker));
  return [...UNIVERSE, ...(extra ?? []).filter((member) => !index.has(member.ticker))];
}
