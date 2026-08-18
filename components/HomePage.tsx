"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { derivedValue } from "@/lib/finance";
import type { WatchlistSummary } from "@/lib/watchlist-summary";
import type { CompanyDataset, CompanyProfile, FinancialPeriod, PricePoint } from "@/lib/types";

const money = (value: number | null, currency = "USD") => value == null || !Number.isFinite(value)
  ? "—"
  : `${value < 0 ? "-" : ""}${currency === "USD" ? "$" : `${currency} `}${new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 10_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(Math.abs(value))}`;
const percent = (value: number | null) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;

/**
 * How often to ask for the digests again, and how long to keep asking.
 *
 * Each request warms a few companies server-side, so the interval sets how fast
 * a cold watchlist fills: three at a time every two seconds covers twenty-one
 * companies in around fifteen seconds. The cap is generous enough to absorb a
 * company that has to be retried and small enough that a genuinely broken
 * company stops costing requests.
 */
const POLL_MS = 2_000;
const MAX_POLLS = 20;

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
export function HomePage({ watchlist, datasets, loading, onOpen, onLoad, onSearchAdd, onShowRanking, onRemove }: {
  watchlist: CompanyProfile[];
  datasets: Record<string, CompanyDataset>;
  loading: string;
  onOpen: (ticker: string) => void;
  onLoad: (ticker: string) => Promise<CompanyDataset | undefined>;
  onSearchAdd: () => void;
  onShowRanking: () => void;
  onRemove: (ticker: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [prices, setPrices] = useState<Record<string, PricePoint | null>>({});
  // The headline figures for every company at once, from the digests the daily
  // warm wrote. Six megabytes of dataset per card is why this page used to
  // arrive empty with a Load button on each one.
  const [summaries, setSummaries] = useState<Record<string, WatchlistSummary> | null>(null);
  // Loading one company from a card is this page's business, so it tracks that
  // here rather than reading a flag the parent sets for a different action.
  const [pending, setPending] = useState<Record<string, "loading" | "failed">>({});
  const [bulk, setBulk] = useState({ running: false, done: 0, total: 0 });

  /**
   * Loads every company the watchlist does not already hold.
   *
   * Four at a time: building one from raw filings is the most expensive thing
   * the application does, and asking for twenty-two at once exhausts the
   * isolate's budget and gets the rest refused. Whatever is refused anyway is
   * tried again once, after a pause long enough for a fresh isolate.
   */
  async function loadEverything() {
    const targets = watchlist.filter((company) => company.resolutionStatus !== "unresolved" && !datasets[company.ticker]).map((company) => company.ticker);
    if (!targets.length) return;
    setBulk({ running: true, done: 0, total: targets.length });
    let cursor = 0;
    const refused: string[] = [];
    const worker = async () => {
      while (cursor < targets.length) {
        const ticker = targets[cursor++];
        setPending((current) => ({ ...current, [ticker]: "loading" }));
        try {
          await onLoad(ticker);
          setPending((current) => { const next = { ...current }; delete next[ticker]; return next; });
        } catch {
          refused.push(ticker);
          setPending((current) => ({ ...current, [ticker]: "failed" }));
        }
        setBulk((current) => ({ ...current, done: current.done + 1 }));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (refused.length) {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      for (const ticker of refused) {
        setPending((current) => ({ ...current, [ticker]: "loading" }));
        try { await onLoad(ticker); setPending((current) => { const next = { ...current }; delete next[ticker]; return next; }); }
        catch { setPending((current) => ({ ...current, [ticker]: "failed" })); }
      }
    }
    setBulk({ running: false, done: 0, total: 0 });
  }

  function load(ticker: string) {
    setPending((current) => ({ ...current, [ticker]: "loading" }));
    onLoad(ticker)
      .then(() => setPending((current) => { const next = { ...current }; delete next[ticker]; return next; }))
      .catch(() => setPending((current) => ({ ...current, [ticker]: "failed" })));
  }

  /**
   * The digests, asked for again while any company is still being built.
   *
   * Reading the watchlist is also what drives the server's warm-up, so a cold
   * cache fills a few companies per request. Asking once would therefore show
   * whatever happened to be ready at that instant and stop — which is how a
   * fresh deploy or a local server came to show twenty-one cards saying
   * "Financials not loaded" and stay that way. Polling turns the same cold
   * start into a page that fills itself in over a few seconds.
   *
   * It stops on its own: when nothing is pending, or after enough rounds that
   * whatever is left is genuinely failing rather than merely slow, at which
   * point the per-card Load button is the honest answer.
   */
  const [building, setBuilding] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rounds = 0;
    const poll = () => {
      fetch("/api/watchlist", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { summaries?: WatchlistSummary[]; pending?: string[] };
          if (!active) return;
          setSummaries(Object.fromEntries((payload.summaries ?? []).map((item) => [item.ticker, item])));
          const pending = payload.pending ?? [];
          setBuilding(new Set(rounds < MAX_POLLS ? pending : []));
          if (pending.length && ++rounds < MAX_POLLS) timer = setTimeout(poll, POLL_MS);
        })
        .catch(() => active && setSummaries((current) => current ?? {}));
    };
    poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, []);

  const unloaded = watchlist.filter((company) => company.resolutionStatus !== "unresolved" && !datasets[company.ticker]).length;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return watchlist;
    return watchlist.filter((company) => company.ticker.toLowerCase().includes(needle) || company.name.toLowerCase().includes(needle));
  }, [watchlist, query]);

  // Only the cards on screen are priced, and only once each. A watchlist of
  // twenty would otherwise open twenty requests before the reader has decided
  // which company they came for.
  //
  // "Once each" is what the ref is for. Asking whether a price has arrived —
  // `ticker in prices` — cannot be the guard when `prices` is also what the
  // effect writes: every answer changed the dependency, re-ran the effect, and
  // re-requested every ticker that had not answered yet. Twenty-one companies
  // therefore opened a few hundred price requests per visit instead of
  // twenty-one, spending the Worker budget the filings needed on work that was
  // thrown away. What was requested is not what has arrived, so it is tracked
  // separately, and in a ref so recording it never triggers another render.
  const requested = useRef<Set<string>>(new Set());
  const visible = matches.map((company) => company.ticker).join("|");
  useEffect(() => {
    let active = true;
    const today = new Date().toISOString().slice(0, 10);
    for (const ticker of visible.split("|").filter(Boolean).slice(0, 24)) {
      if (requested.current.has(ticker)) continue;
      requested.current.add(ticker);
      fetch(`/api/price/${encodeURIComponent(ticker)}?date=${today}`)
        .then(async (response) => {
          const payload = await response.json() as PricePoint & { error?: string };
          if (active) setPrices((current) => ({ ...current, [ticker]: response.ok ? payload : null }));
        })
        .catch(() => active && setPrices((current) => ({ ...current, [ticker]: null })));
    }
    return () => { active = false; };
  }, [visible]);

  return <div className="home">
    <header className="home-head">
      <div>
        <h1>Watchlist</h1>
        <p>{watchlist.length} companies. Open one, or load them all to compare them side by side.</p>
      </div>
      <div className="home-head-actions">
        <button type="button" onClick={() => void loadEverything()} disabled={bulk.running || unloaded === 0}>
          {bulk.running ? `Loading ${bulk.done}/${bulk.total}…` : unloaded ? `Load all (${unloaded})` : "All loaded"}
        </button>
        <button type="button" className="button-primary" onClick={onSearchAdd}>Add a company</button>
      </div>
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
    </div>

    {matches.length === 0
      ? <div className="home-empty">
          <p>Nothing in your watchlist matches <b>{query}</b>.</p>
          <button type="button" onClick={onSearchAdd}>Search SEC filings for “{query}”</button>
        </div>
      : <ul className="company-cards">
          {matches.map((company) => {
            // A loaded dataset is authoritative; the digest fills the card
            // until one is, and for every company the reader never opens.
            const dataset = datasets[company.ticker];
            const period = dataset ? latestPeriod(dataset) : undefined;
            const digest = summaries?.[company.ticker];
            const figure = (metric: string, from: number | null | undefined) =>
              period ? derivedValue(period, metric) : from ?? null;
            const point = prices[company.ticker];
            const price = point?.priceClose ?? point?.close ?? null;
            const shares = period
              ? derivedValue(period, "sharesOutstanding") ?? derivedValue(period, "dilutedShares")
              : digest?.shares ?? null;
            const marketCap = price != null && shares != null ? price * shares : null;
            const known = period != null || digest != null;
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
                  {known && <span><small>Market cap</small>{money(marketCap, company.currency)}</span>}
                  {known && <span><small>FCF margin</small>{percent(figure("freeCashFlowMargin", digest?.freeCashFlowMargin))}</span>}
                  {known && <span><small>Cash RoC</small>{percent(figure("cashReturnOnCapital", digest?.cashReturnOnCapital))}</span>}
                </span>
                {/* A company the server is still building is not a company
                    that failed, and must not be labelled like one. */}
                {!known && <span className="company-card-state">{summaries == null ? "Loading…" : busy ? "Loading financials…" : failed ? "Could not load — try again" : building.has(company.ticker) ? "Building financials…" : "Financials not loaded"}</span>}
              </button>
              {!known && summaries != null && !busy && !building.has(company.ticker) && <button type="button" className="company-card-load" onClick={() => load(company.ticker)}>{failed ? "Retry" : "Load"}</button>}
              <button type="button" className="company-card-remove" title={`Remove ${company.ticker} from the watchlist`} aria-label={`Remove ${company.ticker} from the watchlist`}
                onClick={() => onRemove(company.ticker)}>×</button>
            </li>;
          })}
        </ul>}

    <footer className="home-foot">
      <button type="button" onClick={onShowRanking}>Compare the whole watchlist in a table →</button>
    </footer>
  </div>;
}
