"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { derivedValue } from "@/lib/finance";
import type { CompanyDataset, CompanyProfile, FinancialPeriod, PricePoint } from "@/lib/types";

const money = (value: number | null, currency = "USD") => value == null || !Number.isFinite(value)
  ? "—"
  : `${value < 0 ? "-" : ""}${currency === "USD" ? "$" : `${currency} `}${new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 10_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(Math.abs(value))}`;
const percent = (value: number | null) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;

const latestPeriod = (dataset: CompanyDataset): FinancialPeriod | undefined => {
  const of = (periodicity: string) => dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1);
  return of("ttm") ?? of("annual");
};

/**
 * The front door: a search box and the companies you follow.
 *
 * Everything else in the application is a place you go once you have chosen a
 * company, so this page does exactly two things and stops. The full ranking
 * table with its filters and columns is one click away for anyone comparing the
 * whole list, but it is not what you should have to read to get started.
 */
export function HomePage({ watchlist, datasets, loading, onOpen, onLoad, onSearchAdd, onShowRanking }: {
  watchlist: CompanyProfile[];
  datasets: Record<string, CompanyDataset>;
  loading: string;
  onOpen: (ticker: string) => void;
  onLoad: (ticker: string) => Promise<CompanyDataset | undefined>;
  onSearchAdd: () => void;
  onShowRanking: () => void;
}) {
  const [query, setQuery] = useState("");
  const [prices, setPrices] = useState<Record<string, PricePoint | null>>({});
  // Loading one company from a card is this page's business, so it tracks that
  // here rather than reading a flag the parent sets for a different action.
  const [pending, setPending] = useState<Record<string, "loading" | "failed">>({});

  function load(ticker: string) {
    setPending((current) => ({ ...current, [ticker]: "loading" }));
    onLoad(ticker)
      .then(() => setPending((current) => { const next = { ...current }; delete next[ticker]; return next; }))
      .catch(() => setPending((current) => ({ ...current, [ticker]: "failed" })));
  }

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return watchlist;
    return watchlist.filter((company) => company.ticker.toLowerCase().includes(needle) || company.name.toLowerCase().includes(needle));
  }, [watchlist, query]);

  // Only the cards on screen are priced, and only once each. A watchlist of
  // twenty would otherwise open twenty requests before the reader has decided
  // which company they came for.
  const visible = matches.map((company) => company.ticker).join("|");
  useEffect(() => {
    let active = true;
    const today = new Date().toISOString().slice(0, 10);
    for (const ticker of visible.split("|").filter(Boolean).slice(0, 24)) {
      if (ticker in prices) continue;
      fetch(`/api/price/${encodeURIComponent(ticker)}?date=${today}`)
        .then(async (response) => {
          const payload = await response.json() as PricePoint & { error?: string };
          if (active) setPrices((current) => ({ ...current, [ticker]: response.ok ? payload : null }));
        })
        .catch(() => active && setPrices((current) => ({ ...current, [ticker]: null })));
    }
    return () => { active = false; };
  }, [visible, prices]);

  return <div className="home">
    <header className="home-head">
      <h1>Companies</h1>
      <p>Pick one from your watchlist, or search the SEC for another.</p>
    </header>

    <div className="home-search">
      <Search size={17} aria-hidden="true"/>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search your watchlist by ticker or name…"
        aria-label="Search your watchlist"
      />
      <button type="button" onClick={onSearchAdd}>Add a company</button>
    </div>

    {matches.length === 0
      ? <div className="home-empty">
          <p>Nothing in your watchlist matches <b>{query}</b>.</p>
          <button type="button" onClick={onSearchAdd}>Search SEC filings for “{query}”</button>
        </div>
      : <ul className="company-cards">
          {matches.map((company) => {
            const dataset = datasets[company.ticker];
            const period = dataset ? latestPeriod(dataset) : undefined;
            const point = prices[company.ticker];
            const price = point?.priceClose ?? point?.close ?? null;
            const shares = period ? derivedValue(period, "sharesOutstanding") ?? derivedValue(period, "dilutedShares") : null;
            const marketCap = price != null && shares != null ? price * shares : null;
            const busy = pending[company.ticker] === "loading" || loading === company.ticker;
            const failed = pending[company.ticker] === "failed";
            return <li key={company.ticker}>
              <button type="button" className="company-card" onClick={() => onOpen(company.ticker)}>
                <span className="company-card-head">
                  <b>{company.ticker}</b>
                  <span className="company-card-name">{company.name}</span>
                </span>
                {/* Four dashes say nothing. Until the filings are loaded the
                    card shows the price, which needs no dataset, and says
                    plainly what is missing. */}
                <span className="company-card-stats">
                  <span><small>Price</small>{money(price, company.currency)}</span>
                  {period && <span><small>Market cap</small>{money(marketCap, company.currency)}</span>}
                  {period && <span><small>FCF margin</small>{percent(derivedValue(period, "freeCashFlowMargin"))}</span>}
                  {period && <span><small>Cash RoC</small>{percent(derivedValue(period, "cashReturnOnCapital"))}</span>}
                </span>
                {!dataset && <span className="company-card-state">{busy ? "Loading financials…" : failed ? "Could not load — try again" : "Financials not loaded"}</span>}
              </button>
              {!dataset && !busy && <button type="button" className="company-card-load" onClick={() => load(company.ticker)}>{failed ? "Retry" : "Load"}</button>}
            </li>;
          })}
        </ul>}

    <footer className="home-foot">
      <button type="button" onClick={onShowRanking}>Compare the whole watchlist in a table →</button>
    </footer>
  </div>;
}
