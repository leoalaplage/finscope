import { claimKey, datasetKey, fallbackDatasetKeys, requestCompany } from "../../dataset-cache";
import { datasetCache, keepAlive } from "../../runtime-env";
import { TICKER_PATTERN } from "../../market-profile";
import type { CompanyDataset } from "../../types";

export type CompanyReadResult =
  | { kind: "ready"; dataset: CompanyDataset; cache: "current" | "previous-version" }
  | { kind: "building"; ticker: string }
  | { kind: "unavailable"; reason: string };

async function readJson(cache: KVNamespace, key: string): Promise<CompanyDataset | null> {
  try {
    return await cache.get<CompanyDataset>(key, "json");
  } catch {
    return null;
  }
}

export async function readCompany(ticker: string, origin: string): Promise<CompanyReadResult> {
  const symbol = ticker.trim().toUpperCase();
  if (!TICKER_PATTERN.test(symbol)) return { kind: "unavailable", reason: "That is not a usable exchange symbol." };
  const cache = datasetCache();
  if (!cache) return { kind: "unavailable", reason: "The financial dataset cache is not bound in this environment." };

  const current = await readJson(cache, datasetKey(symbol));
  if (current) return { kind: "ready", dataset: current, cache: "current" };
  for (const key of fallbackDatasetKeys(symbol)) {
    const previous = await readJson(cache, key);
    if (previous) return { kind: "ready", dataset: previous, cache: "previous-version" };
  }

  const claim = await cache.get(claimKey(symbol), "text").catch(() => null);
  if (!claim) {
    await cache.put(claimKey(symbol), "1", { expirationTtl: 60 }).catch(() => undefined);
    keepAlive(requestCompany(origin, symbol));
  }
  return { kind: "building", ticker: symbol };
}

