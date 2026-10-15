"use client";

import { useMemo, useSyncExternalStore } from "react";
import { readDrawings, type Drawing } from "@/lib/term/drawings";

/**
 * The reader's drawings, per symbol, in this browser — and in their account
 * when they are signed in (components/io/AccountSync.tsx follows the key).
 * The chart page draws and edits them; a company's chart shows the same ones,
 * so a level drawn on Monday is there on Tuesday wherever the symbol is
 * charted. Every change can be undone, for this visit.
 */

export const DRAWINGS_KEY = "finscope.term.drawings.v1";
const CHANGE_EVENT = "finscope:term-drawings";
const HISTORY = 100;
const undone: Array<string | null> = [];
const redone: Array<string | null> = [];

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key == null || event.key === DRAWINGS_KEY) notify(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, notify);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(CHANGE_EVENT, notify); };
}
const readText = () => { try { return localStorage.getItem(DRAWINGS_KEY); } catch { return null; } };
function writeText(text: string | null) {
  try { if (text == null) localStorage.removeItem(DRAWINGS_KEY); else localStorage.setItem(DRAWINGS_KEY, text); } catch { /* this visit only */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Every symbol's drawings. */
export function useDrawingStore(): Record<string, Drawing[]> {
  const text = useSyncExternalStore(subscribe, readText, () => null);
  return useMemo(() => readDrawings(text), [text]);
}

const NONE: Drawing[] = [];
/** One symbol's drawings. */
export function useSymbolDrawings(symbol: string): Drawing[] {
  return useDrawingStore()[symbol] ?? NONE;
}

/** Replaces one symbol's drawings, and remembers what they were so the change can be undone. */
export function setSymbolDrawings(symbol: string, next: Drawing[]) {
  const before = readText();
  const all = readDrawings(before);
  if (next.length) all[symbol] = next; else delete all[symbol];
  const text = JSON.stringify(all);
  if (text === before) return;
  undone.push(before);
  if (undone.length > HISTORY) undone.shift();
  redone.length = 0;
  writeText(text);
}

export function undoDrawings(): boolean {
  if (!undone.length) return false;
  redone.push(readText());
  writeText(undone.pop() ?? null);
  return true;
}

export function redoDrawings(): boolean {
  if (!redone.length) return false;
  undone.push(readText());
  writeText(redone.pop() ?? null);
  return true;
}
