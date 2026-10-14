import { insiderClusters, readInsiderBuying } from "@/lib/insider-buying";

/**
 * Open-market purchases by the index's insiders over the last four months, and
 * the clusters of them (lib/insider-buying.ts). Read from the store the timer
 * fills; how many days it covers travels with the answer.
 */
export async function GET(request: Request) {
  const store = await readInsiderBuying();
  // One company's, for its INS panel: its purchases and its cluster, if it has one.
  const ticker = new URL(request.url).searchParams.get("ticker")?.toUpperCase() ?? null;
  const purchases = (store?.purchases ?? []).filter((purchase) => !ticker || purchase.ticker === ticker);
  const body = {
    updatedAt: store?.updatedAt ?? null,
    days: [...(store?.days ?? [])].sort(),
    pending: store?.queue.length ?? 0,
    purchases,
    clusters: insiderClusters(purchases),
  };
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=300, s-maxage=600" } });
}
