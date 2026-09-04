"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { DEFAULT_TICKERS, parseTickers, useStoredWatchlist, writeWatchlist } from "./watchlist";

/** A reader's list lives on their device; the default remains instant HTML. */
export function HomeWatchlist() {
  const stored = useStoredWatchlist();
  const [sessionTickers, setSessionTickers] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_TICKERS.join("\n"));
  const profiles = useMemo(() => new Map(DEFAULT_WATCHLIST.map((company) => [company.ticker, company])), []);
  const parsed = useMemo(() => parseTickers(draft), [draft]);
  const tickers = sessionTickers ?? stored;

  const openEditor = () => { setDraft(tickers.join("\n")); setEditing(true); };
  const save = () => {
    if (!parsed.length) return;
    setSessionTickers(parsed);
    writeWatchlist(parsed);
    setEditing(false);
  };
  const reset = () => setDraft(DEFAULT_TICKERS.join("\n"));

  return (
    <section className="quick" aria-labelledby="watchlist-title">
      <div className="quick-head">
        <h2 className="label" id="watchlist-title">Watchlist</h2>
        <button className="watchlist-edit" type="button" onClick={openEditor} aria-label="Edit watchlist" title="Edit watchlist"><Pencil size={11} /></button>
      </div>
      <div className="grid-ruled quick-grid">
        {tickers.map((ticker) => (
          <a key={ticker} href={`/s/${encodeURIComponent(ticker)}`}>
            {ticker}
            <span>{profiles.get(ticker)?.sector ?? "Watchlist"}</span>
          </a>
        ))}
      </div>

      {editing ? (
        <div className="watchlist-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(false); }}>
          <section className="watchlist-editor" role="dialog" aria-modal="true" aria-labelledby="watchlist-editor-title">
            <div className="watchlist-editor-head">
              <div>
                <p className="label">Personal list</p>
                <h2 id="watchlist-editor-title">Edit watchlist</h2>
              </div>
              <button type="button" className="watchlist-close" onClick={() => setEditing(false)} aria-label="Close watchlist editor">×</button>
            </div>
            <label className="watchlist-input">
              <span>Tickers · separated by spaces, commas or lines</span>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
            </label>
            <div className="watchlist-editor-foot">
              <span className="label">{parsed.length} {parsed.length === 1 ? "stock" : "stocks"}</span>
              <div>
                <button type="button" className="watchlist-reset" onClick={reset}>Reset 27</button>
                <button type="button" className="watchlist-save" onClick={save} disabled={!parsed.length}>Save</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
