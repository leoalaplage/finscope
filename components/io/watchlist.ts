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
export const WATCHLIST_EVENT = "finscope:home-watchlist";
export const WATCHLIST_LIMIT = 60;

const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

export const DEFAULT_TICKERS = DEFAULT_WATCHLIST.map((company) => company.ticker);

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
  try { return localStorage.getItem(WATCHLIST_KEY); } catch { return null; }
};

export function useStoredWatchlist(): string[] {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  try {
    const value = JSON.parse(stored ?? "null") as unknown;
    if (Array.isArray(value)) {
      const valid = parseTickers(value.filter((item): item is string => typeof item === "string").join(" "));
      if (valid.length) return valid;
    }
  } catch { /* The defaults remain the safe snapshot. */ }
  return DEFAULT_TICKERS;
}

export function writeWatchlist(tickers: string[]) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(tickers));
    window.dispatchEvent(new Event(WATCHLIST_EVENT));
  } catch { /* The in-memory edit still works. */ }
}
