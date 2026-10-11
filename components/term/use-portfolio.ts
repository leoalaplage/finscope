"use client";

import { useEffect, useState } from "react";
import { KEY_VERSION, SUMMARY_SHAPE } from "@/lib/data-version";
import type { Position } from "@/lib/portfolio";
import type { WatchlistSummary } from "@/lib/watchlist-summary";
import { EARNINGS_DAY_SHAPE, type ReportTime } from "@/lib/adapters/nasdaq-earnings";
import type { IoQuote } from "@/components/io/quote";

/**
 * Everything PORT reads, for the book on screen.
 *
 * Four requests in all, whatever the size of the book, except the prices:
 * the digests of every holding in one, each holding's quote, a year and a
 * half of daily closes and ten years of weekly ones for every holding and the
 * index — the same cache keys the company pages keep warm — and the earnings
 * calendar for the next three weeks. Each half arrives on its own, so the
 * holdings table draws before the histories behind the risk figures land.
 */

export interface Bar { date: string; close: number; adjusted: number }
export interface Histories { holdings: Record<string, Bar[]>; index: Bar[] }
export interface UpcomingEarnings { ticker: string; date: string; time: ReportTime; consensusEps: number | null; name: string }

export interface PortfolioFeed {
  summaries: Record<string, WatchlistSummary>;
  quotes: Record<string, IoQuote>;
  pending: string[];
  daily: Histories | null;
  weekly: Histories | null;
  earnings: UpcomingEarnings[] | null;
}

export const BENCHMARK = { symbol: "^GSPC", label: "S&P 500" };
const DAILY_DAYS = 560;
const WEEKLY_YEARS = 10;

const EMPTY: PortfolioFeed = { summaries: {}, quotes: {}, pending: [], daily: null, weekly: null, earnings: null };

export function usePortfolioFeed(positions: Position[]): PortfolioFeed {
  const book = positions.map((position) => position.ticker).join(",");
  const [state, setState] = useState<{ book: string; feed: PortfolioFeed }>({ book: "", feed: EMPTY });

  useEffect(() => {
    if (!book) return;
    const controller = new AbortController();
    const tickers = book.split(",");
    const merge = (part: Partial<PortfolioFeed>) => {
      if (controller.signal.aborted) return;
      setState((current) => ({ book, feed: { ...(current.book === book ? current.feed : EMPTY), ...part } }));
    };
    const json = async <T,>(url: string): Promise<T | null> => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        return response.ok ? await response.json() as T : null;
      } catch { return null; }
    };

    // Digests and quotes: what the table needs.
    (async () => {
      const payload = await json<{ summaries?: WatchlistSummary[]; pending?: string[] }>(`/api/watchlist?tickers=${encodeURIComponent(book)}&v=${KEY_VERSION}.${SUMMARY_SHAPE}`);
      const summaries: Record<string, WatchlistSummary> = {};
      for (const summary of payload?.summaries ?? []) summaries[summary.ticker.toUpperCase()] = summary;
      const quotes: Record<string, IoQuote> = {};
      await Promise.all(tickers.map(async (ticker) => {
        const quote = await json<IoQuote>(`/api/io/${encodeURIComponent(ticker)}/quote`);
        if (quote) quotes[ticker] = quote;
      }));
      merge({ summaries, quotes, pending: payload ? payload.pending ?? [] : tickers });
    })();

    // Closes: the index and every holding, daily and weekly.
    (async () => {
      const today = new Date();
      const day = (days: number) => new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
      const end = today.toISOString().slice(0, 10);
      const read = async (symbol: string, query: string): Promise<Bar[]> => {
        const body = await json<{ bars: Array<{ date: string; close: number | null; adjustedClose?: number | null }> }>(`/api/market/${encodeURIComponent(symbol)}?${query}`);
        return (body?.bars ?? []).flatMap((bar) => (bar.close != null && Number.isFinite(bar.close) && bar.close > 0
          ? [{ date: bar.date, close: bar.close, adjusted: bar.adjustedClose != null && Number.isFinite(bar.adjustedClose) ? bar.adjustedClose : bar.close }]
          : []));
      };
      const load = async (query: string): Promise<Histories> => {
        const [index, ...series] = await Promise.all([read(BENCHMARK.symbol, query), ...tickers.map((ticker) => read(ticker, query))]);
        return { index, holdings: Object.fromEntries(tickers.map((ticker, at) => [ticker, series[at]])) };
      };
      const daily = await load(`frequency=daily&start=${day(DAILY_DAYS)}&end=${end}`);
      merge({ daily });
      const weekly = await load(`frequency=weekly&start=${day(WEEKLY_YEARS * 365.25)}&end=${end}`);
      merge({ weekly });
    })();

    // The next three weeks of earnings, for the holdings among them.
    (async () => {
      const from = new Date().toISOString().slice(0, 10);
      const body = await json<{ days?: Array<{ date: string; rows: Array<{ ticker: string; name: string; time: ReportTime; consensusEps: number | null }> }> }>(`/api/earnings-days?from=${from}&days=15&v=${EARNINGS_DAY_SHAPE}`);
      const held = new Set(tickers);
      merge({
        earnings: (body?.days ?? []).flatMap((entry) => entry.rows
          .filter((row) => held.has(row.ticker))
          .map((row) => ({ ticker: row.ticker, name: row.name, date: entry.date, time: row.time, consensusEps: row.consensusEps }))),
      });
    })();

    return () => controller.abort();
  }, [book]);

  return state.book === book ? state.feed : EMPTY;
}
