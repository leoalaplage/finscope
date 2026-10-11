"use client";

import { useEffect, useState } from "react";

/**
 * The tape: the three indices and the reader's own list, with today's move.
 *
 * Two endpoints the site already serves — /api/indices for the averages and
 * /api/movers for any list of tickers — read once a minute, which is how often
 * the movers endpoint is allowed to change at the edge anyway. The tape and the
 * launchpad's watchlist both read it, so the answer is kept at module level and
 * the second reader within the minute gets the first one's request.
 */

export interface TapeQuote {
  symbol: string;
  label: string;
  price: number | null;
  changePercent: number | null;
  /** Indices are linked to the market page, futures and coins to their chart, companies to their screen. */
  kind: "index" | "future" | "equity";
  sector?: string | null;
}

export interface Tape { quotes: TapeQuote[]; asOf: number | null; failed: boolean }

const REFRESH_MS = 60_000;

const inflight = new Map<string, { at: number; promise: Promise<Tape> }>();

interface IndexAnswer { indices?: Array<{ id: string; name: string; last?: number | null; changePercent?: number | null; error?: string }> }
interface FuturesAnswer { rows?: Array<{ id: string; label: string; last: number | null; changePercent: number | null }> }
interface MoversAnswer { watchlist?: Array<{ symbol: string; label: string; sector?: string | null; price: number | null; changePercent: number | null }> }

async function fetchTape(tickers: string[]): Promise<Tape> {
  const [indices, movers, futures] = await Promise.all([
    fetch("/api/indices").then((response) => (response.ok ? response.json() as Promise<IndexAnswer> : null)).catch(() => null),
    tickers.length
      ? fetch(`/api/movers?tickers=${encodeURIComponent(tickers.join(","))}`).then((response) => (response.ok ? response.json() as Promise<MoversAnswer> : null)).catch(() => null)
      : Promise.resolve(null),
    fetch("/api/futures").then((response) => (response.ok ? response.json() as Promise<FuturesAnswer> : null)).catch(() => null),
  ]);
  const averages: TapeQuote[] = (indices?.indices ?? [])
    .filter((index) => !index.error && index.last != null)
    .map((index) => ({ symbol: index.id, label: index.name, price: index.last ?? null, changePercent: index.changePercent ?? null, kind: "index" }));
  // The movers endpoint answers in its own order; the reader's list has one.
  const bySymbol = new Map((movers?.watchlist ?? []).map((quote) => [quote.symbol.toUpperCase(), quote]));
  const equities: TapeQuote[] = tickers.flatMap((ticker) => {
    const quote = bySymbol.get(ticker);
    return quote ? [{ symbol: ticker, label: ticker, price: quote.price, changePercent: quote.changePercent, kind: "equity" as const, sector: quote.sector ?? null }] : [];
  });
  // Futures and coins after the averages: what moves overnight and at weekends.
  const traded: TapeQuote[] = (futures?.rows ?? []).filter((row) => row.last != null)
    .map((row) => ({ symbol: row.id, label: row.label, price: row.last, changePercent: row.changePercent == null ? null : row.changePercent / 100, kind: "future" }));
  return { quotes: [...averages, ...traded, ...equities], asOf: Date.now(), failed: indices == null && movers == null };
}

function tapeFor(tickers: string[]): Promise<Tape> {
  const key = tickers.join(",");
  const held = inflight.get(key);
  if (held && Date.now() - held.at < REFRESH_MS) return held.promise;
  const promise = fetchTape(tickers);
  inflight.set(key, { at: Date.now(), promise });
  return promise;
}

export function useTape(tickers: string[]): Tape | null {
  const key = tickers.join(",");
  const [tape, setTape] = useState<{ key: string; tape: Tape } | null>(null);

  useEffect(() => {
    let live = true;
    const list = key ? key.split(",") : [];
    const read = () => tapeFor(list).then((answer) => { if (live) setTape({ key, tape: answer }); });
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => { live = false; clearInterval(timer); };
  }, [key]);

  return tape?.key === key ? tape.tape : null;
}
