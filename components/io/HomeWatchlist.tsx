"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { KEY_VERSION, SUMMARY_SHAPE } from "@/lib/data-version";
import { qsTable, qsValuationColumns } from "@/lib/qs-export";
import { screen, valuationStars, type ScoredCompany } from "@/lib/qs/screener";
import { summarySector, type WatchlistSummary } from "@/lib/watchlist-summary";
import type { IoQuote } from "./quote";
import { delta, price } from "./format";
import { useRecentCompanies } from "./recent";
import { useWatchlistCollection, writeWatchlistCollection } from "./watchlist";
import { WatchlistEditor } from "./WatchlistEditor";

interface Reading { summary?: WatchlistSummary; quote?: IoQuote; score?: ScoredCompany }

/** A short decision list first; the complete named list remains one edit away. */
export function HomeWatchlist() {
  const collection = useWatchlistCollection();
  const active = collection.lists.find((list) => list.id === collection.activeId) ?? collection.lists[0];
  const recent = useRecentCompanies();
  const [editing, setEditing] = useState(false);
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const shown = useMemo(() => [...new Set([...recent.slice(0, 5), ...(active?.tickers ?? []).slice(0, 8)])], [recent, active]);
  const key = shown.join(",");

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    (async () => {
      const response = await fetch(`/api/watchlist?tickers=${encodeURIComponent(key)}&v=${KEY_VERSION}.${SUMMARY_SHAPE}`, { signal: controller.signal });
      if (!response.ok) return;
      const payload = await response.json() as { summaries?: WatchlistSummary[] };
      const rows: Record<string, Reading> = {};
      await Promise.all((payload.summaries ?? []).map(async (summary) => {
        let quote: IoQuote | undefined;
        try {
          const priced = await fetch(`/api/io/${encodeURIComponent(summary.ticker)}/quote`, { signal: controller.signal });
          if (priced.ok) quote = await priced.json() as IoQuote;
        } catch { /* The filed reading still belongs on the card. */ }
        let score: ScoredCompany | undefined;
        try {
          const table = qsTable([{ ticker: summary.ticker, values: { ...summary.qs, ...qsValuationColumns(summary.qsPrice, quote?.price ?? null, quote?.currency) } }]);
          score = screen(table).all[0];
        } catch { /* An unrated company remains useful. */ }
        rows[summary.ticker.toUpperCase()] = { summary, quote, score };
      }));
      if (!controller.signal.aborted) setReadings(rows);
    })().catch(() => { /* The links remain the fallback. */ });
    return () => controller.abort();
  }, [key]);

  const chooseList = (id: string) => writeWatchlistCollection({ ...collection, activeId: id });
  const cards = (tickers: string[]) => (
    <div className="home-company-grid">
      {tickers.map((ticker) => {
        const reading = readings[ticker];
        const stars = valuationStars(reading?.score?.piliers.Value);
        const sector = reading?.summary ? summarySector(reading.summary) : null;
        return (
          <a className="home-company-card" key={ticker} href={`/s/${encodeURIComponent(ticker)}`}>
            <span className="home-company-top"><strong>{ticker}</strong><span>{reading?.score?.note ?? "—"}</span></span>
            <span className="home-company-price">{reading?.quote ? price(reading.quote.price, reading.quote.currency) : "Reading"}</span>
            <span className="home-company-detail" data-dir={reading?.quote?.changePercent == null ? undefined : reading.quote.changePercent >= 0 ? "up" : "down"}>
              {reading?.quote?.changePercent == null ? sector ?? "Filed company" : `${delta(reading.quote.changePercent)} today`}
            </span>
            <span className="home-company-value">{stars == null ? "Valuation pending" : `${"★".repeat(stars)}${"☆".repeat(5 - stars)} value`}</span>
          </a>
        );
      })}
    </div>
  );

  return (
    <section className="quick home-lists" aria-labelledby="watchlist-title">
      {recent.length ? <div className="home-list-block"><div className="quick-head"><h2 className="label">Recently viewed</h2></div>{cards(recent.slice(0, 5))}</div> : null}
      <div className="home-list-block">
        <div className="quick-head">
          <div className="home-list-title">
            <h2 className="label" id="watchlist-title">Watchlist</h2>
            <select aria-label="Active watchlist" value={collection.activeId} onChange={(event) => chooseList(event.target.value)}>
              {collection.lists.map((list) => <option value={list.id} key={list.id}>{list.name}</option>)}
            </select>
            {active?.tags.map((tag) => <span className="watchlist-tag" key={tag}>{tag}</span>)}
          </div>
          <button className="watchlist-edit" type="button" onClick={() => setEditing(true)} aria-label="Manage watchlists" title="Manage watchlists"><Pencil size={13} /></button>
        </div>
        {cards((active?.tickers ?? []).slice(0, 8))}
        {(active?.tickers.length ?? 0) > 8 ? <p className="stat-note home-list-more">Showing 8 of {active.tickers.length} companies · open the Screener for the complete list.</p> : null}
      </div>
      {editing ? <WatchlistEditor tickers={active?.tickers ?? []} onClose={() => setEditing(false)} /> : null}
    </section>
  );
}
