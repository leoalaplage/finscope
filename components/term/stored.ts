"use client";

import { useSyncExternalStore } from "react";

/**
 * A value kept in the reader's browser, read the way React wants an outside
 * store read: the stored text is the state, the server sees none, and every
 * tab hears a write. Used for what a reader sets up on the terminal's screens.
 */

const EVENT = "finscope:term-stored";

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(EVENT, notify); };
}

export function useStoredText(key: string): string | null {
  return useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key); } catch { return null; } }, () => null);
}

export function writeStored(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* this visit only */ }
  window.dispatchEvent(new Event(EVENT));
}
