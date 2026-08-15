"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { derivedValue } from "@/lib/finance";
import type { CompanyDataset, CompanyProfile, FinancialPeriod, PricePoint } from "@/lib/types";

const money = (value: number | null, currency = "USD") => value == null || !Number.isFinite(value)
  ? "—"
  : `${value < 0 ? "-" : ""}${currency === "USD" ? "$" : `${currency} `}${new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 10_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(Math.abs(value))}`;

const latestPeriod = (dataset: CompanyDataset): FinancialPeriod | undefined => {
  const of = (periodicity: string) => dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1);
  return of("ttm") ?? of("annual");
};

const RECENT_KEY = "finscope.recentCompanies";
const EMPTY: string[] = [];
/** Cached so the snapshot is referentially stable between reads. */
let recentCache: string[] = EMPTY;
let recentRaw = "";

const readRecent = (): string[] => {
  if (typeof window === "undefined") return EMPTY;
  const raw = localStorage.getItem(RECENT_KEY) ?? "[]";
  if (raw !== recentRaw) {
    recentRaw = raw;
    try { const value = JSON.parse(raw); recentCache = Array.isArray(value) ? value.slice(0, 6) : EMPTY; }
    catch { recentCache = EMPTY; }
  }
  return recentCache;
};

const recentListeners = new Set<() => void>();
const subscribeRecent = (listener: () => void) => { recentListeners.add(listener); return () => { recentListeners.delete(listener); }; };

/** Remembers what was opened, most recent first, without duplicates. */
export function rememberCompany(ticker: string) {
  if (typeof window === "undefined") return;
  const next = [ticker, ...readRecent().filter((item) => item !== ticker)].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  for (const listener of recentListeners) listener();
}

interface Row { ticker: string; name: string; exchange: string; currency: string; marketCap: number | null; onWatchlist: boolean }

/**
 * The front door: one search box.
 *
 * A financial tool is opened to look something up, so looking something up is
 * the whole page. The watchlist is a shortcut underneath, not a dashboard, and
 * there is no product copy — anyone reading this already knows what it is for.
 *
 * The search covers the watchlist and, for anything it does not recognise, the
 * SEC's own company index, so a ticker that has never been imported is still
 * one query away.
 */
export function HomePage({ watchlist, datasets, prices, loading, onOpen, onImport }: {
  watchlist: CompanyProfile[];
  datasets: Record<string, CompanyDataset>;
  prices: Record<string, PricePoint | null>;
  loading: string;
  onOpen: (ticker: string) => void;
  onImport: (profile: CompanyProfile) => void;
}) {
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<CompanyProfile[]>([]);
  // Read through an external store rather than component state. The page is
  // prerendered, so the server has no localStorage and any value taken during
  // render disagrees with the client's — which is exactly the hydration
  // mismatch this replaced. React is told the server snapshot is empty and
  // fills it in after mount.
  const recent = useSyncExternalStore(subscribeRecent, readRecent, useCallback(() => EMPTY, []));
  const input = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inFlight = useRef(0);

  /**
   * Typing is an event, so the SEC lookup happens here rather than in an
   * effect: nothing is being synchronised with an external system, the reader
   * asked a question. The index is only consulted for what the watchlist could
   * not answer, and only once enough has been typed for the answer to mean
   * something. A stale response is discarded by sequence number.
   */
  function search(next: string) {
    setQuery(next);
    clearTimeout(debounce.current);
    const trimmed = next.trim().toLowerCase();
    if (trimmed.length < 2) { setRemote([]); return; }
    const sequence = ++inFlight.current;
    debounce.current = setTimeout(() => {
      fetch(`/api/resolve?q=${encodeURIComponent(trimmed)}`)
        .then(async (response) => {
          const payload = await response.json();
          if (sequence === inFlight.current) setRemote(Array.isArray(payload) ? payload.slice(0, 8) : []);
        })
        .catch(() => { if (sequence === inFlight.current) setRemote([]); });
    }, 250);
  }


  const marketCapOf = (ticker: string, currency: string): number | null => {
    const dataset = datasets[ticker];
    const period = dataset ? latestPeriod(dataset) : undefined;
    const point = prices[ticker];
    const price = point?.priceClose ?? point?.close ?? null;
    const shares = period ? derivedValue(period, "sharesOutstanding") ?? derivedValue(period, "dilutedShares") : null;
    return price != null && shares != null ? price * shares : (void currency, null);
  };

  const needle = query.trim().toLowerCase();
  const local = useMemo<Row[]>(() => {
    const source = needle
      ? watchlist.filter((company) => company.ticker.toLowerCase().includes(needle) || company.name.toLowerCase().includes(needle))
      : [];
    return source.map((company) => ({
      ticker: company.ticker, name: company.name, exchange: company.exchange,
      currency: company.currency, marketCap: marketCapOf(company.ticker, company.currency), onWatchlist: true,
    }));
    // marketCapOf reads datasets and prices, which are in the dependency list.
  }, [watchlist, needle, datasets, prices]); // eslint-disable-line react-hooks/exhaustive-deps


  const known = new Set(local.map((row) => row.ticker));
  const remoteRows: Row[] = remote
    .filter((company) => !known.has(company.ticker))
    .map((company) => ({
      ticker: company.ticker, name: company.name, exchange: company.exchange ?? "—",
      currency: company.currency ?? "USD", marketCap: null, onWatchlist: false,
    }));
  const results = [...local, ...remoteRows];

  const shortcuts = (recent.length ? recent : watchlist.slice(0, 8).map((company) => company.ticker))
    .map((ticker) => watchlist.find((company) => company.ticker === ticker) ?? null)
    .filter((company): company is CompanyProfile => company != null)
    .slice(0, 8);

  return <div className="home">
    <div className="home-hero">
      <h1>AapWire</h1>
      <div className="home-search">
        <Search size={18} aria-hidden="true"/>
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(event) => search(event.target.value)}
          placeholder="Search a company or ticker"
          aria-label="Search a company or ticker"
          autoComplete="off"
        />
      </div>

      {needle.length > 0 && <div className="home-results" role="listbox" aria-label="Search results">
        {results.map((row) => <button
          key={`${row.ticker}-${row.onWatchlist ? "w" : "s"}`}
          type="button"
          role="option"
          aria-selected="false"
          className="home-result"
          onClick={() => row.onWatchlist
            ? onOpen(row.ticker)
            : onImport({ ticker: row.ticker, name: row.name, exchange: row.exchange, currency: row.currency } as CompanyProfile)}>
          <span className="home-result-ticker">{row.ticker}</span>
          <span className="home-result-name">{row.name}</span>
          <span className="home-result-meta">{row.exchange} · {row.currency}</span>
          <span className="home-result-cap">{row.marketCap == null ? (row.onWatchlist ? "" : "Import") : money(row.marketCap, row.currency)}</span>
        </button>)}
        {!results.length && <p className="home-result-empty">{`Nothing found for “${query}” in your watchlist or in SEC filings.`}</p>}
      </div>}
    </div>

    {needle.length === 0 && shortcuts.length > 0 && <section className="home-shortcuts">
      <h2>{recent.length ? "Recently viewed" : "Your watchlist"}</h2>
      <ul>
        {shortcuts.map((company) => <li key={company.ticker}>
          <button type="button" onClick={() => onOpen(company.ticker)}>
            <b>{company.ticker}</b>
            <small>{company.name}</small>
            {loading === company.ticker && <em>Loading…</em>}
          </button>
        </li>)}
      </ul>
    </section>}
  </div>;
}
