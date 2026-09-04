"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Pencil } from "lucide-react";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";

const STORAGE_KEY = "finscope.io.home-watchlist.v1";
const STORAGE_EVENT = "finscope:home-watchlist";
const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;
const DEFAULT_TICKERS = DEFAULT_WATCHLIST.map((company) => company.ticker);

function parseTickers(value: string) {
  const seen = new Set<string>();
  return value
    .toUpperCase()
    .split(/[^A-Z0-9.-]+/)
    .map((ticker) => ticker.trim())
    .filter((ticker) => TICKER.test(ticker) && !seen.has(ticker) && Boolean(seen.add(ticker)))
    .slice(0, 60);
}

/** A reader's list lives on their device; the default remains instant HTML. */
export function HomeWatchlist() {
  const stored = useSyncExternalStore(
    (notify) => { window.addEventListener(STORAGE_EVENT, notify); return () => window.removeEventListener(STORAGE_EVENT, notify); },
    () => localStorage.getItem(STORAGE_KEY),
    () => null,
  );
  const [sessionTickers, setSessionTickers] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_TICKERS.join("\n"));
  const profiles = useMemo(() => new Map(DEFAULT_WATCHLIST.map((company) => [company.ticker, company])), []);
  const parsed = useMemo(() => parseTickers(draft), [draft]);
  const tickers = useMemo(() => {
    if (sessionTickers) return sessionTickers;
    try {
      const value = JSON.parse(stored ?? "null") as unknown;
      if (Array.isArray(value)) {
        const valid = parseTickers(value.filter((item): item is string => typeof item === "string").join(" "));
        if (valid.length) return valid;
      }
    } catch { /* The default remains the safe snapshot. */ }
    return DEFAULT_TICKERS;
  }, [sessionTickers, stored]);

  const openEditor = () => { setDraft(tickers.join("\n")); setEditing(true); };
  const save = () => {
    if (!parsed.length) return;
    setSessionTickers(parsed);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      window.dispatchEvent(new Event(STORAGE_EVENT));
    } catch { /* The in-memory edit still works. */ }
    setEditing(false);
  };
  const reset = () => setDraft(DEFAULT_TICKERS.join("\n"));

  return (
    <section className="quick" aria-labelledby="watchlist-title">
      <div className="quick-head">
        <h2 className="label" id="watchlist-title">Built and waiting</h2>
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
