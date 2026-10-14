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

/** What each kept store is, in the account page's words. */
export const SYNCED_LABELS: Record<SyncedKey, { label: string; group: "Lists" | "Research" | "Terminal" }> = {
  "finscope.io.watchlists.v1": { label: "Watchlists", group: "Lists" },
  "finscope.io.home-watchlist.v1": { label: "Watchlist (earlier format)", group: "Lists" },
  "finscope.io.portfolio.v1": { label: "Portfolio positions", group: "Lists" },
  "finscope.io.portfolio.trades.v1": { label: "Portfolio trades", group: "Lists" },
  "finscope.io.thesis.v1": { label: "Notes", group: "Research" },
  "finscope.io.alerts-seen.v1": { label: "Alerts read", group: "Research" },
  "finscope.free-screener.v1": { label: "Saved screens", group: "Research" },
  "finscope.term.workspace.v1": { label: "Terminal layout", group: "Terminal" },
  "finscope.term.scan.v1": { label: "Scans", group: "Terminal" },
  "finscope.term.backtest.v1": { label: "Backtests", group: "Terminal" },
  "finscope.term.drawings.v1": { label: "Chart drawings", group: "Terminal" },
  "finscope.chart.studies": { label: "Chart studies", group: "Terminal" },
};

const plural = (count: number, word: string) => `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

/** Pure: what a kept value holds, counted where it can be ("3 lists · 42 tickers"), or null. */
export function describeSynced(key: SyncedKey, raw: string | null): string | null {
  if (raw == null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return key === "finscope.io.alerts-seen.v1" ? `Up to ${raw.slice(0, 10)}` : null; }
  if (key === "finscope.io.alerts-seen.v1" && typeof value === "string") return `Up to ${value.slice(0, 10)}`;
  if (key === "finscope.io.watchlists.v1" && value && typeof value === "object" && Array.isArray((value as { lists?: unknown }).lists)) {
    const lists = (value as { lists: Array<{ tickers?: unknown }> }).lists;
    const tickers = new Set(lists.flatMap((list) => (Array.isArray(list.tickers) ? list.tickers : [])));
    return `${plural(lists.length, "list")} · ${plural(tickers.size, "ticker")}`;
  }
  const word: Partial<Record<SyncedKey, string>> = {
    "finscope.io.home-watchlist.v1": "ticker", "finscope.io.portfolio.v1": "position", "finscope.io.portfolio.trades.v1": "trade",
    "finscope.io.thesis.v1": "note", "finscope.term.scan.v1": "scan", "finscope.term.backtest.v1": "backtest", "finscope.chart.studies": "study",
  };
  if (Array.isArray(value)) return plural(value.length, word[key] ?? "item");
  if (value && typeof value === "object") {
    const saved = (value as { saved?: unknown }).saved;
    if (Array.isArray(saved)) return plural(saved.length, key === "finscope.free-screener.v1" ? "saved screen" : word[key] ?? "item");
    if (key === "finscope.term.drawings.v1") return plural(Object.keys(value).length, "chart");
  }
  return null;
}
