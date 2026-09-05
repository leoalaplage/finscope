"use client";

import { useSyncExternalStore } from "react";
import { LAST_COMPANY_KEY } from "@/lib/io/last-company";

/**
 * The company this device was last reading, as a store rather than a copy.
 *
 * Three screens are about one company at a time — the company page, the
 * comparison, the discounted cash flow — and moving between them should not
 * mean typing the ticker again. The bar therefore carries it: Compare and DCF
 * open on the filer you were just reading, and each of those pages writes it
 * back, so the memory follows you round rather than pointing at wherever you
 * started.
 *
 * Subscribed to rather than held in state, the way the theme and the watchlist
 * are: the value lives outside React, so React reads it instead of keeping a
 * second copy an effect has to correct. The server's snapshot is empty, which
 * is everything a prerendered document knows about a device — and the first
 * client render uses that same empty snapshot, so the markup it hydrates
 * matches and the link fills in on the render after.
 */
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(REMEMBERED_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(REMEMBERED_EVENT, notify);
  };
}

/** Fired by a page that has just changed which company is being read. */
export const REMEMBERED_EVENT = "finscope:last-company";

function read() {
  try { return localStorage.getItem(LAST_COMPANY_KEY)?.toUpperCase() ?? ""; } catch { return ""; }
}

export function useRememberedCompany(): string {
  return useSyncExternalStore(subscribe, read, () => "");
}

/** The same path, opened on the company in hand where there is one. */
export function onCompany(path: string, ticker: string): string {
  return ticker ? `${path}?s=${encodeURIComponent(ticker)}` : path;
}
