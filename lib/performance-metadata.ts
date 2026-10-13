import { fallbackSummaryKeys, summaryKey } from "./dataset-cache";
import { stated } from "./sector";
import type { CompanyProfile } from "./types";

interface MetadataSource {
  name?: string;
  shares?: number | null;
  qsPrice?: { shares?: number | null };
  qs?: Record<string, unknown>;
}

/** Read usable fields across supported cache generations, newest first.
 * Metadata can survive a financial-formula cache migration; missing metadata
 * must not turn an existing company into a tiny, unclassified marker.
 */
export async function performanceMetadata(
  company: CompanyProfile,
  price: number | null,
  read: (key: string) => Promise<MetadataSource | null>,
  universeRow: () => Promise<MetadataSource | null>,
) {
  let shares: number | null = null;
  let sector: string | null = null;
  let name: string | null = null;
  const merge = (source: MetadataSource | null) => {
    if (!source) return;
    name ??= source.name || null;
    const label = source.qs?.Sector;
    sector ??= typeof label === "string" ? stated(label) : null;
    for (const candidate of [source.qsPrice?.shares, source.shares]) {
      if (shares == null && candidate != null && Number.isFinite(candidate) && candidate > 0) shares = candidate;
    }
  };
  for (const key of [summaryKey(company.ticker), ...fallbackSummaryKeys(company.ticker)]) {
    try { merge(await read(key)); } catch { /* A broken generation must not hide older usable fields. */ }
    if (shares != null && sector != null) break;
  }
  if (shares == null || sector == null) {
    try { merge(await universeRow()); } catch { /* Prices remain usable without metadata. */ }
  }
  return {
    name: name ?? company.name,
    sector: sector ?? stated(company.sector) ?? "Unclassified",
    marketCap: price != null && Number.isFinite(price) && price > 0 && shares != null ? price * shares : null,
  };
}
