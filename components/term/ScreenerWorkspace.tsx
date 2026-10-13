"use client";

import { useSyncExternalStore } from "react";
import { FreeScreener } from "./FreeScreener";
import { Scanner } from "./Scanner";
import { Screener } from "@/components/io/Screener";

/**
 * EQS: every way of searching the index on one screen.
 *
 * Filters (the rule builder over fundamentals, consensus and technicals), the
 * Quality Score, and the technical scanner were three screens a reader had to
 * know about separately; the scanner had its own code. They are three modes of
 * one screen now, the mode in the address so each can be linked and comes back
 * where it was — `/t/scan` opens this screen on the scanner.
 */
export type ScreenerMode = "filters" | "quality" | "scan";
const MODES: Array<{ id: ScreenerMode; label: string }> = [
  { id: "filters", label: "Filters" },
  { id: "quality", label: "Quality Score" },
  { id: "scan", label: "Technical scan" },
];
const EVENT = "finscope:screener-mode";
const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify); window.addEventListener(EVENT, notify);
  return () => { window.removeEventListener("popstate", notify); window.removeEventListener(EVENT, notify); };
};
const readMode = (): ScreenerMode | null => {
  const asked = new URLSearchParams(window.location.search).get("mode");
  // "free" and "qs" were the two modes' earlier names.
  return asked === "scan" ? "scan" : asked === "quality" || asked === "qs" ? "quality" : asked === "filters" || asked === "free" ? "filters" : null;
};

export function ScreenerWorkspace({ initial = "filters" }: { initial?: ScreenerMode }) {
  const mode = useSyncExternalStore(subscribe, () => readMode() ?? initial, () => initial);
  const choose = (next: ScreenerMode) => {
    const url = new URL(window.location.href);
    url.pathname = "/t/screener";
    url.searchParams.set("mode", next);
    window.history.pushState(null, "", url);
    window.dispatchEvent(new Event(EVENT));
  };
  return <>
    <div className="free-workspace-heading">
      <h1>Screener</h1>
      <div className="seg" role="group" aria-label="Screener mode">
        {MODES.map((each) => <button key={each.id} type="button" aria-pressed={mode === each.id} onClick={() => choose(each.id)}>{each.label}</button>)}
      </div>
    </div>
    {mode === "filters" ? <main id="main-content" tabIndex={-1}><FreeScreener /></main>
      : mode === "scan" ? <main id="main-content" tabIndex={-1}><Scanner /></main>
        : <Screener />}
  </>;
}
