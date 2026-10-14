import { NextResponse } from "next/server";
import { dataKey } from "@/lib/accounts";
import { DATA_LIMIT, dataSize, mergeSynced, type SyncedData } from "@/lib/account-sync";
import { NO_STORE, refuse, requireAccount, sameOrigin } from "@/lib/account-http";
import { datasetCache } from "@/lib/runtime-env";

/**
 * The account's copy of the reader's work (lib/account-sync.ts): read whole,
 * and written by merging, key by key, the newer copy winning.
 */
async function held(id: string): Promise<SyncedData> {
  return (await datasetCache()?.get<{ items: SyncedData }>(dataKey(id), "json").catch(() => null))?.items ?? {};
}

export async function GET(request: Request) {
  const account = await requireAccount(request);
  if (account instanceof Response) return account;
  return NextResponse.json({ items: await held(account.id) }, { headers: NO_STORE });
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const account = await requireAccount(request);
  if (account instanceof Response) return account;
  const body = await request.json().catch(() => null) as { items?: unknown } | null;
  if (!body || typeof body.items !== "object" || body.items == null) return refuse("Incomplete request.");
  const merged = mergeSynced(await held(account.id), body.items as SyncedData);
  if (dataSize(merged) > DATA_LIMIT) return refuse("More than this account can keep: remove some drawings or notes.", 413);
  await datasetCache()?.put(dataKey(account.id), JSON.stringify({ items: merged, updatedAt: new Date().toISOString() }));
  return NextResponse.json({ items: merged }, { headers: NO_STORE });
}
