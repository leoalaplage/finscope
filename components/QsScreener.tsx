"use client";

import { useEffect, useRef, useState } from "react";
import { QS_COLUMNS, qsTable, qsValuationColumns, type QsRow } from "@/lib/qs-export";
import type { WatchlistSummary } from "@/lib/watchlist-summary";
import type { PricePoint } from "@/lib/types";

/** Directory form: the asset handler 307s /qs/index.html to /qs/, and paying
 *  for that redirect on every mount is a round-trip for nothing. */
const SOURCE = "/qs/?embedded=1&theme=";
/** Tall enough that nothing is clipped before the page reports its own size. */
const INITIAL_HEIGHT = 900;
const MIN_HEIGHT = 420;

export function QsScreener({ theme }: { theme: "light" | "dark" }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  // The frame was loaded with the theme nailed to light and never told
  // otherwise, so the screener sat white inside a dark application and read as
  // somebody else's product. It has understood this message all along.
  const [initialTheme] = useState(theme);
  const [feeding, setFeeding] = useState<"" | "working" | "failed">("");

  /**
   * Scores the watchlist this application already holds.
   *
   * Every row is built from the stored digests and completed with the prices
   * fetched now, then handed to the screener as a table — the same text, under
   * the same column titles, entering by the same door as a paste. The engine
   * is not touched, called differently, or told where its rows came from.
   */
  async function useWatchlist() {
    setFeeding("working");
    try {
      const response = await fetch("/api/watchlist");
      const payload = await response.json() as { summaries?: WatchlistSummary[] };
      const summaries = (payload.summaries ?? []).filter((item) => item.qs);
      if (!summaries.length) throw new Error("no summaries");

      const today = new Date().toISOString().slice(0, 10);
      const prices = await Promise.all(summaries.map(async (item) => {
        try {
          const priced = await fetch(`/api/price/${encodeURIComponent(item.ticker)}?date=${today}`);
          if (!priced.ok) return null;
          const point = await priced.json() as PricePoint;
          return point.priceClose ?? point.close ?? null;
        } catch { return null; }
      }));

      const rows: QsRow[] = summaries.map((item, index) => ({
        ticker: item.ticker,
        values: { ...item.qs, ...qsValuationColumns(item.qsPrice, prices[index]) },
      }));
      frame.current?.contentWindow?.postMessage({ type: "finscope-table", table: qsTable(rows) }, window.location.origin);
      setFeeding("");
    } catch {
      setFeeding("failed");
    }
  }

  useEffect(() => {
    // The screener reports its own content height, so the embedded page grows
    // with the generated table instead of scrolling inside a fixed box.
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "qs-ready") setStatus("ready");
      if (event.data?.type === "qs-height" && typeof event.data.height === "number") setHeight(Math.max(MIN_HEIGHT, Math.ceil(event.data.height)));
    };
    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(() => setStatus((current) => current === "ready" ? current : "failed"), 8_000);
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(timeout); };
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    frame.current?.contentWindow?.postMessage({ type: "finscope-theme", theme }, window.location.origin);
  }, [theme, status]);

  return <div className="qs-page">
    <header className="page-heading">
      <div>
        <h1>QS Screener</h1>
        <p>Score your own watchlist, or paste an export from fiscal.ai, Excel, Google Sheets or a CSV file. Everything is computed and rendered in your browser — nothing is uploaded.</p>
      </div>
      <a className="qs-standalone" href="/qs/" target="_blank" rel="noreferrer">Open full screen ↗</a>
    </header>
    <div className="qs-source">
      <button type="button" className="qs-source-action" disabled={status !== "ready" || feeding === "working"} onClick={useWatchlist}>
        {feeding === "working" ? "Scoring your watchlist…" : "Use my watchlist"}
      </button>
      <small>
        {feeding === "failed"
          ? "Could not build the table from your watchlist. Paste an export below instead."
          : `Builds the table below from the ${QS_COLUMNS.length} columns this application computes itself. Forward estimates are not among them: the engine drops a missing column and renormalises its weights.`}
      </small>
    </div>
    {status === "failed" && <p className="notice">The embedded screener did not confirm that it loaded. <a href="/qs/" target="_blank" rel="noreferrer">Open it in its own tab</a>.</p>}
    {status === "loading" && <p className="simple-state">Loading the QS Screener…</p>}
    <iframe ref={frame} className="qs-frame" style={{ height }} onError={() => setStatus("failed")} src={`${SOURCE}${initialTheme}`} title="QS Screener: paste data, scoring settings and generated dashboard"/>
  </div>;
}
