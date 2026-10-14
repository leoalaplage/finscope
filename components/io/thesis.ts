import { useSyncExternalStore } from "react";

/**
 * A reader's notes on the companies they follow, kept in their own browser
 * like the watchlist and the portfolio: what they thought, when, at what
 * price and against what value, and the prices they would act at — which the
 * alerts watch (components/io/Alerts.tsx).
 */
export type Stance = "buy" | "hold" | "sell" | "watch";

export interface ThesisNote {
  id: string;
  ticker: string;
  /** When it was written, to the second. */
  written: string;
  stance: Stance;
  text: string;
  /** The price and the DCF base-case value when it was written. */
  price: number | null;
  fairValue: number | null;
  currency: string | null;
  /** The prices the reader would act at: alerts when the price goes below or above. */
  buyBelow: number | null;
  sellAbove: number | null;
}

export const THESIS_KEY = "finscope.io.thesis.v1";
const EVENT = "finscope:thesis";
const LIMIT = 500;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function clean(value: unknown): ThesisNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ThesisNote[] => {
    if (!entry || typeof entry !== "object") return [];
    const note = entry as Partial<ThesisNote>;
    if (typeof note.id !== "string" || typeof note.ticker !== "string" || typeof note.written !== "string" || typeof note.text !== "string") return [];
    return [{
      id: note.id, ticker: note.ticker.toUpperCase(), written: note.written, text: note.text.slice(0, 4000),
      stance: note.stance === "buy" || note.stance === "hold" || note.stance === "sell" ? note.stance : "watch",
      price: finite(note.price) ? note.price : null, fairValue: finite(note.fairValue) ? note.fairValue : null,
      currency: typeof note.currency === "string" ? note.currency : null,
      buyBelow: finite(note.buyBelow) ? note.buyBelow : null, sellAbove: finite(note.sellAbove) ? note.sellAbove : null,
    }];
  });
}

let cached: { raw: string | null; notes: ThesisNote[] } = { raw: null, notes: [] };
function read(): ThesisNote[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(THESIS_KEY); } catch { /* A browser that keeps nothing keeps no notes. */ }
  if (raw === cached.raw) return cached.notes;
  let parsed: unknown = [];
  try { parsed = raw ? JSON.parse(raw) : []; } catch { parsed = []; }
  cached = { raw, notes: clean(parsed) };
  return cached.notes;
}
const EMPTY: ThesisNote[] = [];
function subscribe(notify: () => void) {
  window.addEventListener(EVENT, notify);
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", notify); };
}

export function useThesisNotes(): ThesisNote[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

function write(notes: ThesisNote[]) {
  try {
    localStorage.setItem(THESIS_KEY, JSON.stringify(notes.slice(0, LIMIT)));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* Nothing kept: the page says so where it saves. */ }
}

export function saveThesisNote(note: Omit<ThesisNote, "id" | "written">): void {
  const entry: ThesisNote = { ...note, ticker: note.ticker.toUpperCase(), id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, written: new Date().toISOString() };
  write([entry, ...read()]);
}

export function deleteThesisNote(id: string): void {
  write(read().filter((note) => note.id !== id));
}

/** The prices the reader set for a company, from its newest note that sets them. */
export function levelsFor(notes: ThesisNote[], ticker: string): { buyBelow: number | null; sellAbove: number | null; note: ThesisNote | null } {
  const mine = notes.filter((note) => note.ticker === ticker.toUpperCase());
  const with_ = mine.find((note) => note.buyBelow != null || note.sellAbove != null) ?? null;
  return { buyBelow: with_?.buyBelow ?? null, sellAbove: with_?.sellAbove ?? null, note: with_ };
}
