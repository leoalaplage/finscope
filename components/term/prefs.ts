"use client";

import { useSyncExternalStore } from "react";
import { PALETTES } from "@/lib/term/palettes";

/**
 * The terminal's display preferences, kept on this device (a phone and a
 * desk screen want different densities): how dense the screens are, which
 * colours mean up and down, the clock, the ticker tape, and the screen the
 * terminal opens on. Applied by TermShell; changed on SET.
 */

export type Density = "compact" | "standard" | "large";
export type UpDown = "green-red" | "blue-orange" | "mono";
export type Clock = "ny" | "local" | "both";

export interface TermPrefs {
  density: Density;
  colors: UpDown;
  clock: Clock;
  tape: boolean;
  /** Where the terminal opens when arrived at from elsewhere: a screen, or a company's page. */
  start: string;
  /** The colour palette, on trial (lib/term/palettes.ts). */
  palette: string;
}

export const PREFS_KEY = "finscope.term.prefs.v1";
const EVENT = "finscope:term-prefs";
export const DEFAULT_PREFS: TermPrefs = { density: "standard", colors: "green-red", clock: "ny", tape: true, start: "/t", palette: "acid" };

export const START_SCREENS: Array<{ path: string; label: string }> = [
  { path: "/t", label: "HOME · launchpad" },
  { path: "/t/market", label: "MKT · market" },
  { path: "/t/eco", label: "ECO · US economy" },
  { path: "/t/screener", label: "SCRN · screener" },
  { path: "/t/portfolio", label: "PORT · portfolio" },
  { path: "/t/alerts", label: "ALRT · alerts" },
  { path: "/t/chart", label: "CHART · charts" },
];

let cached: { raw: string | null; prefs: TermPrefs } = { raw: null, prefs: DEFAULT_PREFS };

export function readPrefs(): TermPrefs {
  let raw: string | null = null;
  try { raw = localStorage.getItem(PREFS_KEY); } catch { raw = null; }
  if (raw === cached.raw) return cached.prefs;
  let value: Partial<TermPrefs> = {};
  try { value = raw ? JSON.parse(raw) as Partial<TermPrefs> : {}; } catch { value = {}; }
  const prefs: TermPrefs = {
    density: value.density === "compact" || value.density === "large" ? value.density : "standard",
    colors: value.colors === "blue-orange" || value.colors === "mono" ? value.colors : "green-red",
    clock: value.clock === "local" || value.clock === "both" ? value.clock : "ny",
    tape: value.tape !== false,
    start: typeof value.start === "string" && /^\/t(?:\/[\w./-]*)?$/.test(value.start) ? value.start : "/t",
    palette: PALETTES.some((palette) => palette.id === value.palette) ? value.palette! : "acid",
  };
  cached = { raw, prefs };
  return prefs;
}

export function writePrefs(change: Partial<TermPrefs>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...change }));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* Kept for this visit only. */ }
}

const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify); window.addEventListener("storage", notify);
  return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", notify); };
};

export const useTermPrefs = () => useSyncExternalStore(subscribe, readPrefs, () => DEFAULT_PREFS);
