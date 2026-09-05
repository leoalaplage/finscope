"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { summarySector, type WatchlistSummary } from "@/lib/watchlist-summary";
import { DEFAULT_TICKERS, parseTickers, useStoredWatchlist, writeWatchlist } from "./watchlist";

/** A reader's list lives on their device; the default remains instant HTML. */
export function HomeWatchlist() {
  const stored = useStoredWatchlist();
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [sessionTickers, setSessionTickers] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_TICKERS.join("\n"));
  const profiles = useMemo(() => new Map(DEFAULT_WATCHLIST.map((company) => [company.ticker, company])), []);
  const parsed = useMemo(() => parseTickers(draft), [draft]);
  const tickers = sessionTickers ?? stored;

  /*
   * A company the reader added themselves is named by its own filings.
   *
   * The card used to print the word "Watchlist" under any ticker this file has
   * never heard of — the name of the list the reader was already looking at,
   * under every company they had chosen for themselves. The digests this site
   * stores carry each filer's sector, so the ones the registry cannot name are
   * asked for; the twenty-seven it can name cost no request at all, which is
   * what keeps the front page a static document for almost every reader.
   */
  const unknown = useMemo(() => tickers.filter((ticker) => !profiles.has(ticker)).join(","), [tickers, profiles]);

  useEffect(() => {
    if (!unknown) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/watchlist?tickers=${encodeURIComponent(unknown)}`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as { summaries?: WatchlistSummary[] };
        const named: Record<string, string> = {};
        for (const summary of payload.summaries ?? []) {
          const sector = summarySector(summary);
          if (sector) named[summary.ticker.toUpperCase()] = sector;
        }
        if (Object.keys(named).length) setResolved((current) => ({ ...current, ...named }));
      } catch {
        // A card with no sector still opens the company, which is its job.
      }
    })();
    return () => controller.abort();
  }, [unknown]);

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
        {tickers.map((ticker) => {
          const sector = profiles.get(ticker)?.sector ?? resolved[ticker] ?? null;
          return (
            <a key={ticker} href={`/s/${encodeURIComponent(ticker)}`}>
              {ticker}
              {sector ? <span>{sector}</span> : null}
            </a>
          );
        })}
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
