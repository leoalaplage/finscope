"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";

/**
 * The list a reader follows, kept in their own browser.
 *
 * One definition, read by the home page that edits it and by the screener that
 * scores it. The storage key is the state and the component subscribes to it,
 * so the two pages can never hold different ideas of what the list is.
 */

export const WATCHLIST_KEY = "finscope.io.home-watchlist.v1";
export const WATCHLISTS_KEY = "finscope.io.watchlists.v1";
export const WATCHLIST_EVENT = "finscope:home-watchlist";
export const WATCHLIST_LIMIT = 60;
export const WATCHLIST_COUNT_LIMIT = 12;

const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

export const DEFAULT_TICKERS = DEFAULT_WATCHLIST.map((company) => company.ticker);

export interface PersonalWatchlist {
  id: string;
  name: string;
  tags: string[];
  tickers: string[];
}

export interface WatchlistCollection {
  activeId: string;
  lists: PersonalWatchlist[];
}

const DEFAULT_COLLECTION: WatchlistCollection = {
  activeId: "main",
  lists: [{ id: "main", name: "Core", tags: ["Long term"], tickers: DEFAULT_TICKERS }],
};

export function parseTickers(value: string): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const candidate of value.toUpperCase().split(/[^A-Z0-9.-]+/)) {
    const ticker = candidate.trim();
    if (!TICKER.test(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    kept.push(ticker);
    if (kept.length === WATCHLIST_LIMIT) break;
  }
  return kept;
}

function subscribe(notify: () => void) {
  window.addEventListener(WATCHLIST_EVENT, notify);
  // Another tab editing the list is the same edit, and reaches here as a
  // storage event rather than as ours.
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(WATCHLIST_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
}

const read = () => {
  try { return localStorage.getItem(WATCHLISTS_KEY) ?? localStorage.getItem(WATCHLIST_KEY); } catch { return null; }
};

function cleanCollection(raw: string | null): WatchlistCollection {
  try {
    const value = JSON.parse(raw ?? "null") as unknown;
    // The former store was one array. It becomes the first named list without
    // losing a single ticker or asking the reader to migrate anything.
    if (Array.isArray(value)) {
      const tickers = parseTickers(value.filter((item): item is string => typeof item === "string").join(" "));
      return tickers.length ? { activeId: "main", lists: [{ id: "main", name: "Core", tags: [], tickers }] } : DEFAULT_COLLECTION;
    }
    if (typeof value !== "object" || value == null) return DEFAULT_COLLECTION;
    const candidate = value as Record<string, unknown>;
    if (!Array.isArray(candidate.lists)) return DEFAULT_COLLECTION;
    const ids = new Set<string>();
    const lists = candidate.lists.flatMap((item, index) => {
      if (typeof item !== "object" || item == null) return [];
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" && /^[a-z0-9-]{1,40}$/i.test(row.id) && !ids.has(row.id) ? row.id : `list-${index + 1}`;
      ids.add(id);
      const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 40) : `List ${index + 1}`;
      const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().slice(0, 24)).filter(Boolean).slice(0, 8) : [];
      const tickers = Array.isArray(row.tickers) ? parseTickers(row.tickers.filter((ticker): ticker is string => typeof ticker === "string").join(" ")) : [];
      return [{ id, name, tags: [...new Set(tags)], tickers }];
    }).slice(0, WATCHLIST_COUNT_LIMIT);
    if (!lists.length) return DEFAULT_COLLECTION;
    const activeId = typeof candidate.activeId === "string" && lists.some((list) => list.id === candidate.activeId) ? candidate.activeId : lists[0].id;
    return { activeId, lists };
  } catch { return DEFAULT_COLLECTION; }
}

export function useWatchlistCollection(): WatchlistCollection {
  return cleanCollection(useSyncExternalStore(subscribe, read, () => null));
}

export function useStoredWatchlist(): string[] {
  const collection = useWatchlistCollection();
  return collection.lists.find((list) => list.id === collection.activeId)?.tickers ?? collection.lists[0]?.tickers ?? DEFAULT_TICKERS;
}

export function writeWatchlist(tickers: string[]) {
  const collection = cleanCollection(read());
  const lists = collection.lists.map((list) => list.id === collection.activeId ? { ...list, tickers: parseTickers(tickers.join(" ")) } : list);
  writeWatchlistCollection({ ...collection, lists });
}

export function writeWatchlistCollection(collection: WatchlistCollection) {
  try {
    localStorage.setItem(WATCHLISTS_KEY, JSON.stringify(collection));
    window.dispatchEvent(new Event(WATCHLIST_EVENT));
  } catch { /* The in-memory edit still works. */ }
}
