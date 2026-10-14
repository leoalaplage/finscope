/**
 * What an account keeps of the browser's own storage, key by key, each with
 * the time it was last changed: the newer copy wins, key by key, so a list
 * edited on the phone and a note written on the computer both survive.
 *
 * Pure, and shared by the server (app/api/account/data) and the browser
 * (components/io/AccountSync.tsx).
 */

/** The browser keys that follow an account: the reader's own work, not this device's display preferences. */
export const SYNCED_KEYS = [
  "finscope.io.watchlists.v1",
  "finscope.io.home-watchlist.v1",
  "finscope.io.portfolio.v1",
  "finscope.io.portfolio.trades.v1",
  "finscope.io.thesis.v1",
  "finscope.io.alerts-seen.v1",
  "finscope.free-screener.v1",
  "finscope.term.workspace.v1",
  "finscope.term.scan.v1",
  "finscope.term.backtest.v1",
  "finscope.term.drawings.v1",
  "finscope.chart.studies",
] as const;

export type SyncedKey = (typeof SYNCED_KEYS)[number];
export interface SyncedItem { value: string | null; at: string }
export type SyncedData = Partial<Record<SyncedKey, SyncedItem>>;

/** Per key and in all: a reader's lists and notes, not a place to keep files. */
export const ITEM_LIMIT = 400_000;
export const DATA_LIMIT = 1_500_000;

export const isSyncedKey = (key: string): key is SyncedKey => (SYNCED_KEYS as readonly string[]).includes(key);

/** The newer of each key; an item without a valid time loses to one with. */
export function mergeSynced(held: SyncedData, incoming: SyncedData): SyncedData {
  const merged: SyncedData = { ...held };
  for (const [key, item] of Object.entries(incoming)) {
    if (!isSyncedKey(key) || !item || typeof item.at !== "string" || Number.isNaN(Date.parse(item.at))) continue;
    if (item.value != null && (typeof item.value !== "string" || item.value.length > ITEM_LIMIT)) continue;
    const current = merged[key];
    if (!current || item.at > current.at) merged[key] = { value: item.value, at: item.at };
  }
  return merged;
}

export const dataSize = (data: SyncedData) => Object.values(data).reduce((sum, item) => sum + (item?.value?.length ?? 0), 0);

/** The tickers an account follows, from its watchlists, its portfolio and its notes. */
export function followedTickers(data: SyncedData): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) { for (const entry of value) visit(entry, depth + 1); return; }
    if (typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "ticker" && typeof entry === "string") found.add(entry.toUpperCase());
      else if (key === "tickers" && Array.isArray(entry)) {
        for (const ticker of entry) if (typeof ticker === "string") found.add(ticker.toUpperCase());
      } else visit(entry, depth + 1);
    }
  };
  for (const key of ["finscope.io.watchlists.v1", "finscope.io.portfolio.v1", "finscope.io.thesis.v1"] as const) {
    const raw = data[key]?.value;
    if (!raw) continue;
    try { visit(JSON.parse(raw), 0); } catch { /* Not JSON: nothing to follow. */ }
  }
  return [...found].filter((ticker) => /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)).sort();
}
