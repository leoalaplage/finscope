"use client";

import { useState } from "react";
import { FreeScreener } from "./FreeScreener";
import { Screener } from "@/components/io/Screener";

/** Keep QS and its existing imports intact alongside the free rule builder. */
export function ScreenerWorkspace() {
  const [mode, setMode] = useState<"free" | "qs">("free");
  return <>
    <div className="free-workspace-heading">
      <h1>Screener</h1>
      <div className="seg" role="group" aria-label="Screener mode"><button type="button" aria-pressed={mode === "free"} onClick={() => setMode("free")}>Filters</button><button type="button" aria-pressed={mode === "qs"} onClick={() => setMode("qs")}>Quality Score</button></div>
    </div>
    {mode === "free" ? <main id="main-content" tabIndex={-1}><FreeScreener /></main> : <Screener />}
  </>;
}
