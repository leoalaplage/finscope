"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { summariseDataset, type WatchlistSummary } from "@/lib/watchlist-summary";
import type { CompanyDataset, CompanyProfile, FinancialPeriod } from "@/lib/types";

const percent = (value: number | null) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
/** The QS row states its rates already multiplied out, so this one does not. */
const qsPercent = (value: number | string | null | undefined) => typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";

/**
 * The three figures a card shows, chosen for the kind of business it is.
 *
 * Free cash flow at a bank, broker or exchange moves with customer and
 * clearing balances, so dividing it by a net revenue line produces a number
 * that is arithmetically correct and describes nothing — Interactive Brokers
 * came out at a 394.9% free-cash-flow margin and a 1773.5% cash return on
 * capital, printed on the front page as though they were facts about the
 * company. What a financial firm is measured on instead is what it keeps of
 * what it charges and how fast both have grown, which the stored QS row
 * already carries.
 */
function cardFigures(digest: WatchlistSummary | null | undefined, financial: boolean) {
  if (financial) return [
    { label: "Operating margin", value: qsPercent(digest?.qs["Operating Margin"]) },
    { label: "Revenue CAGR · 5Y", value: qsPercent(digest?.qs["Revenue 5Y CAGR"]) },
    { label: "Net income CAGR · 5Y", value: qsPercent(digest?.qs["Net Income 5Y CAGR"]) },
  ];
  return [
    { label: "FCF margin · 5Y", value: percent(digest?.freeCashFlowAfterSbcMargin5Y ?? null) },
    { label: "Cash RoC · 5Y", value: percent(digest?.cashReturnOnCapital5Y ?? null) },
    { label: "FCF / share CAGR · 5Y", value: percent(digest?.freeCashFlowPerShareCagr5Y ?? null) },
  ];
}

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
 * Every dataset that has already been summarised, kept beside the component.
 *
 * A digest is a pure function of a dataset, and a dataset object is replaced
 * rather than mutated when a company is rebuilt — so this is a memo table, not
 * state, and it belongs at module scope. Holding it in a ref instead would mean
 * reading that ref while rendering, which is exactly the thing a ref may not be
 * used for. Weak, so a company dropped from the watchlist takes its summary
 * with it.
 */
const summarised = new WeakMap<CompanyDataset, WatchlistSummary | null>();

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
   * One at a time. Building a company from raw filings is the most expensive
   * thing this application does — a twelve-megabyte filing, and up to half a
   * second of CPU — and running four of those at once is what makes the
   * platform refuse the rest of the batch outright. This used to fan out four
   * deep and it showed: a company nothing had warmed yet, which is exactly what
   * a freshly added one is, was the likeliest of the lot to come back refused.
   * Sequential is slower and finishes, which is the same conclusion the ranking
   * table's "Load all" reached.
   *
   * A refusal is the platform being busy rather than the filing being broken,
   * so what is refused is tried again twice more, after pauses long enough for
   * a fresh isolate to be handed to us.
   */
  async function loadEverything() {
    const targets = watchlist.filter((company) => company.resolutionStatus !== "unresolved" && !datasets[company.ticker]).map((company) => company.ticker);
    if (!targets.length) return;
    setBulk({ running: true, done: 0, total: targets.length });
    const done = (ticker: string) => setPending((current) => { const next = { ...current }; delete next[ticker]; return next; });
    let refused: string[] = [];
    for (const ticker of targets) {
      setPending((current) => ({ ...current, [ticker]: "loading" }));
      try { await onLoad(ticker); done(ticker); }
      catch { refused.push(ticker); setPending((current) => ({ ...current, [ticker]: "failed" })); }
      setBulk((current) => ({ ...current, done: current.done + 1 }));
    }
    for (let round = 0; round < 2 && refused.length; round++) {
      await new Promise((resolve) => setTimeout(resolve, 4_000 * (round + 1)));
      const again = refused;
      refused = [];
      for (const ticker of again) {
        setPending((current) => ({ ...current, [ticker]: "loading" }));
        try { await onLoad(ticker); done(ticker); }
        catch { refused.push(ticker); setPending((current) => ({ ...current, [ticker]: "failed" })); }
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
  /**
   * The list the server is asked about, and what makes it ask again.
   *
   * The endpoint used to answer for the built-in registry whatever anyone
   * asked, and this effect ran once on mount. A company the reader added was
   * therefore in neither the question nor the answer: no digest was returned
   * for it, nothing warmed it, and its card sat on "Financials not loaded"
   * however many times "Load all" was pressed. Naming the companies makes the
   * answer cover them, and depending on the list makes adding one ask again.
   */
  const followed = watchlist.filter((company) => company.resolutionStatus !== "unresolved").map((company) => company.ticker).join(",");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rounds = 0;
    const poll = () => {
      fetch(`/api/watchlist?tickers=${encodeURIComponent(followed)}`, { cache: "no-store" })
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
  }, [followed]);

  /**
   * The card's figures, computed here for any company already loaded.
   *
   * A dataset in hand is the whole digest and more, so a card backed by one
   * never needs to wait for the server to have written a summary — which for a
   * company the reader added themselves might be several polls away, and used
   * to be never. The card read the stored digest alone, so a company "Load all"
   * had just fetched showed three dashes and looked like a failure.
   *
   * Keyed by the dataset object rather than the ticker, so a summary is
   * computed once per company and not again on every keystroke in the search
   * box; a replaced dataset is a new object and is summarised afresh.
   */
  const localDigests = useMemo(() => {
    const result: Record<string, WatchlistSummary | null> = {};
    for (const [ticker, data] of Object.entries(datasets)) {
      if (!summarised.has(data)) summarised.set(data, summariseDataset(data));
      result[ticker] = summarised.get(data) ?? null;
    }
    return result;
  }, [datasets]);

  const unloaded = watchlist.filter((company) => company.resolutionStatus !== "unresolved" && !datasets[company.ticker]).length;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return watchlist;
    return watchlist.filter((company) => company.ticker.toLowerCase().includes(needle) || company.name.toLowerCase().includes(needle));
  }, [watchlist, query]);

  /*
   * No price is fetched here any more.
   *
   * The card used to show a price and a market capitalisation, so opening the
   * watchlist opened up to twenty-four price requests before the reader had
   * decided which company they came for. The card now states what the business
   * did over five years, which the stored digest already carries, so the page
   * costs one request in total.
   */

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
            const digest = localDigests[company.ticker] ?? summaries?.[company.ticker];
            const known = period != null || digest != null;
            const busy = pending[company.ticker] === "loading" || loading === company.ticker;
            const failed = pending[company.ticker] === "failed";
            /*
             * An instrument with no filing feed is a settled fact, not a
             * pending one.
             *
             * HES Beheer was delisted in 2014 and the registry has always said
             * so, but its card asked the server for a digest that can never
             * exist, polled twenty times and then froze on "Building
             * financials…" for good — a permanently broken-looking card in the
             * first screen a visitor sees.
             */
            const unresolved = company.resolutionStatus === "unresolved";
            // The dataset's own profile wins where there is one: a company the
            // reader added carries whatever the SEC search decided, and the
            // digest was built from the dataset that was actually normalized.
            const financial = (digest?.businessType ?? dataset?.company.businessType ?? company.businessType) === "financial";
            const figures = cardFigures(digest, financial);
            return <li key={company.ticker}>
              <button type="button" className="company-card" onClick={() => onOpen(company.ticker)}>
                <span className="company-card-head">
                  <b>{company.ticker}</b>
                  <span className="company-card-name">{company.name}</span>
                </span>
                {/*
                  * Three figures, all measured over five years, and no price.
                  *
                  * A price is not a fact about a business, and a market
                  * capitalisation is a price wearing a bigger number: neither
                  * says whether the company is worth following, which is the
                  * only question a watchlist card exists to answer. What is
                  * here instead is how much of its revenue the company keeps
                  * as cash once the shares it pays people in are counted as
                  * the cost they are, what it earns on the capital it employs,
                  * and how fast that cash has compounded for one share. A
                  * single year of any of the three is noise; five is a
                  * business.
                  */}
                <span className="company-card-stats">
                  {known && figures.map((figure, position) => <span key={figure.label} className={position === 2 ? "company-card-wide" : undefined}>
                    <small>{figure.label}</small>{figure.value}
                  </span>)}
                </span>
                {/* A company the server is still building is not a company
                    that failed, and must not be labelled like one. */}
                {!known && <span className="company-card-state">{unresolved ? "No filing feed available" : summaries == null ? "Loading…" : busy ? "Loading financials…" : failed ? "Could not load — try again" : building.has(company.ticker) ? "Building financials…" : "Financials not loaded"}</span>}
              </button>
              {!known && !unresolved && summaries != null && !busy && !building.has(company.ticker) && <button type="button" className="company-card-load" onClick={() => load(company.ticker)}>{failed ? "Retry" : "Load"}</button>}
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
