"use client";

import { useState } from "react";
import { DEFAULT_TICKERS, parseTickers, writeWatchlist } from "./watchlist";

/**
 * The one editor for the one list.
 *
 * It writes to the store every page reads, so editing the list here edits it on
 * the home page, in the screener and in the portfolio at the same time — not
 * because they are kept in step, but because there is only one list and this is
 * the only thing that writes it.
 *
 * Lifted out of the home page when the market page needed it too. A second copy
 * would have been two editors that agree until one of them is changed.
 */
export function WatchlistEditor({ tickers, onClose, onSaved }: {
  tickers: string[];
  onClose: () => void;
  onSaved?: (tickers: string[]) => void;
}) {
  const [draft, setDraft] = useState(() => tickers.join("\n"));
  const parsed = parseTickers(draft);

  const save = () => {
    if (!parsed.length) return;
    writeWatchlist(parsed);
    onSaved?.(parsed);
    onClose();
  };

  return (
    <div
      className="watchlist-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="watchlist-editor" role="dialog" aria-modal="true" aria-labelledby="watchlist-editor-title">
        <div className="watchlist-editor-head">
          <div>
            <p className="label">Personal list</p>
            <h2 id="watchlist-editor-title">Edit watchlist</h2>
          </div>
          <button type="button" className="watchlist-close" onClick={onClose} aria-label="Close watchlist editor">×</button>
        </div>
        <label className="watchlist-input">
          <span>Tickers · separated by spaces, commas or lines</span>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
        </label>
        <div className="watchlist-editor-foot">
          <span className="label">{parsed.length} {parsed.length === 1 ? "stock" : "stocks"}</span>
          <div>
            <button type="button" className="watchlist-reset" onClick={() => setDraft(DEFAULT_TICKERS.join("\n"))}>
              Reset {DEFAULT_TICKERS.length}
            </button>
            <button type="button" className="watchlist-save" onClick={save} disabled={!parsed.length}>Save</button>
          </div>
        </div>
      </section>
    </div>
  );
}
