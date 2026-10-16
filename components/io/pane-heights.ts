"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * How tall the reader made each lower pane — RSI, MACD, volume… — by dragging
 * its top edge. A preference of this screen, kept in this browser and the
 * same on every chart; a pane never resized keeps the default.
 */

const KEY = "finscope.chart.pane-heights.v1";
const EVENT = "finscope:pane-heights";
export const PANE_MIN = 48;
export const PANE_MAX = 420;

const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify);
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", notify); };
};

export function usePaneHeights(): Record<string, number> {
  const text = useSyncExternalStore(subscribe, read, () => null);
  return useMemo(() => {
    try {
      const parsed = JSON.parse(text ?? "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] >= PANE_MIN && entry[1] <= PANE_MAX));
    } catch {
      return {};
    }
  }, [text]);
}

export function setPaneHeight(pane: string, height: number | null) {
  let all: Record<string, number> = {};
  try { all = JSON.parse(read() ?? "{}") as Record<string, number>; } catch { /* start again */ }
  if (height == null) delete all[pane]; else all[pane] = Math.round(Math.min(PANE_MAX, Math.max(PANE_MIN, height)));
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* this visit only */ }
  window.dispatchEvent(new Event(EVENT));
}
