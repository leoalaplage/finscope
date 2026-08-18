"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartPalette, niceTicks, type ThemeName } from "@/lib/charting";
import { concentration, holdingsSeries, rebasePair, seriesStats, timeWeightedSeries, valuePortfolio, weightBy, weightedMetric, withinWindow, WINDOWS, type Position, type SeriesPoint, type ValuedPosition, type WindowId } from "@/lib/portfolio";
import { buildLots, firstTradeDate, flowsByDate, isValidTransaction, newTransactionId, positionsFromTransactions, shareTimeline, sortTransactions, totalRealised, transactionsFromPositions, type Transaction } from "@/lib/transactions";
import type { WatchlistSummary } from "@/lib/watchlist-summary";
import type { CompanyProfile, MarketBar, PricePoint } from "@/lib/types";

const STORAGE_KEY = "finscope.portfolio";
/**
 * Where the dated book lives.
 *
 * A new key rather than a new shape under the old one, so a reader who opens
 * this build and dislikes it still has their holdings intact under the old key.
 */
const LEDGER_KEY = "finscope.portfolio.ledger";
const today = () => new Date().toISOString().slice(0, 10);
const BENCHMARKS = [{ ticker: "^GSPC", label: "S&P 500" }, { ticker: "^NDX", label: "Nasdaq 100" }] as const;

const money = (value: number | null, currency = "USD") => value == null || !Number.isFinite(value)
  ? "—"
  : `${value < 0 ? "-" : ""}${currency === "USD" ? "$" : `${currency} `}${new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 100_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(Math.abs(value))}`;
const percent = (value: number | null, digits = 1) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const ratio = (value: number | null, digits = 2) => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}×`;

/**
 * The ledger, migrating the old dateless holdings the first time it is opened.
 *
 * The migration runs once and writes its result straight back, so the old key
 * is read exactly once in the life of a browser and the invented dates never
 * get invented twice.
 */
function readTransactions(): Transaction[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? "null") as unknown;
    if (Array.isArray(stored)) return stored.filter((entry): entry is Transaction => isValidTransaction(entry as Partial<Transaction>));
  } catch { /* A corrupt ledger is replaced, not mourned. */ }
  const migrated = transactionsFromPositions(readPositions(), today());
  if (migrated.length) {
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(migrated)); } catch { /* Private mode. */ }
  }
  return migrated;
}

function readPositions(): Position[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((entry) => {
      const item = entry as Record<string, unknown>;
      return typeof item?.ticker === "string" && typeof item.shares === "number" && item.shares > 0
        ? [{ ticker: item.ticker, shares: item.shares, ...(typeof item.cost === "number" && item.cost > 0 ? { cost: item.cost } : {}) }] : [];
    });
  } catch { return []; }
}

/**
 * A quality figure asked of the whole book.
 *
 * Each is the holdings' own number weighted by what the holding is worth — the
 * question "what does the money I have actually own" rather than "what is the
 * average company on this list". Coverage travels with every one of them,
 * because a 90% return across a third of the book is not the same statement as
 * the same number across all of it.
 */
const QUALITY: Array<{ key: string; label: string; read: (position: ValuedPosition) => number | null | undefined; format: (value: number | null) => string; hint: string }> = [
  { key: "cashReturnOnCapital", label: "Cash RoC", read: (p) => p.summary?.cashReturnOnCapital, format: (v) => percent(v), hint: "Free cash flow over invested capital, weighted by position." },
  { key: "roic", label: "ROIC", read: (p) => num(p.summary?.qs["ROIC"]) == null ? null : num(p.summary?.qs["ROIC"])! / 100, format: (v) => percent(v), hint: "Return on invested capital." },
  { key: "roic5", label: "ROIC · 5Y avg", read: (p) => num(p.summary?.qs["ROIC 5Yr Avg"]) == null ? null : num(p.summary?.qs["ROIC 5Yr Avg"])! / 100, format: (v) => percent(v), hint: "The five-year mean, which one impairment cannot move." },
  { key: "operatingMargin", label: "Operating margin", read: (p) => num(p.summary?.qs["Operating Margin"]) == null ? null : num(p.summary?.qs["Operating Margin"])! / 100, format: (v) => percent(v), hint: "Operating income over revenue." },
  { key: "fcfMargin", label: "FCF margin", read: (p) => p.summary?.freeCashFlowMargin, format: (v) => percent(v), hint: "Free cash flow over revenue." },
  { key: "fcfMargin5", label: "FCF margin · 5Y avg", read: (p) => num(p.summary?.qs["FCF Margin 5Yr Avg"]) == null ? null : num(p.summary?.qs["FCF Margin 5Yr Avg"])! / 100, format: (v) => percent(v), hint: "The five-year mean." },
  { key: "grossMargin5", label: "Gross margin · 5Y avg", read: (p) => num(p.summary?.qs["Gross Margin 5Yr Avg"]) == null ? null : num(p.summary?.qs["Gross Margin 5Yr Avg"])! / 100, format: (v) => percent(v), hint: "How much of a sale survives its own cost." },
  { key: "cashConversion", label: "FCF / net income", read: (p) => num(p.summary?.qs["FCF / Net Income"]) == null ? null : num(p.summary?.qs["FCF / Net Income"])! / 100, format: (v) => percent(v), hint: "Whether the reported profit arrives as cash." },
  { key: "revenueGrowth", label: "Revenue growth", read: (p) => p.summary?.revenueGrowth, format: (v) => percent(v), hint: "Latest full year against the one before it." },
  { key: "revenue5", label: "Revenue · 5Y CAGR", read: (p) => num(p.summary?.qs["Revenue 5Y CAGR"]) == null ? null : num(p.summary?.qs["Revenue 5Y CAGR"])! / 100, format: (v) => percent(v), hint: "Compounded over five reported years." },
  { key: "fcf5", label: "FCF · 5Y CAGR", read: (p) => num(p.summary?.qs["FCF 5Y CAGR"]) == null ? null : num(p.summary?.qs["FCF 5Y CAGR"])! / 100, format: (v) => percent(v), hint: "Compounded over five reported years." },
  { key: "dilution", label: "Share count · 5Y CAGR", read: (p) => num(p.summary?.qs["Shares Outstanding 5Y CAGR"]) == null ? null : num(p.summary?.qs["Shares Outstanding 5Y CAGR"])! / 100, format: (v) => percent(v), hint: "Negative is a company buying itself back." },
  { key: "sbc", label: "SBC / revenue", read: (p) => num(p.summary?.qs["SBC to Revenue"]) == null ? null : num(p.summary?.qs["SBC to Revenue"])! / 100, format: (v) => percent(v), hint: "Share-based pay as a share of sales." },
  { key: "netDebtEbitda", label: "Net debt / EBITDA", read: (p) => num(p.summary?.qs["Net Debt / EBITDA"]), format: (v) => ratio(v), hint: "Negative is net cash." },
  { key: "currentRatio", label: "Current ratio", read: (p) => num(p.summary?.qs["Current Ratio"]), format: (v) => ratio(v), hint: "What is due within the year against what is set aside for it." },
  { key: "ocfCapex", label: "OCF / capex", read: (p) => num(p.summary?.qs["OCF/Capex"]), format: (v) => ratio(v), hint: "How many times over the business funds its own upkeep." },
];

const num = (value: number | string | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function PortfolioPage({ watchlist, theme, onOpen }: { watchlist: CompanyProfile[]; theme: ThemeName; onOpen: (ticker: string) => void }) {
  const [transactions, setTransactions] = useState<Transaction[]>(readTransactions);
  const [summaries, setSummaries] = useState<Record<string, WatchlistSummary>>({});
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [histories, setHistories] = useState<Record<string, SeriesPoint[]>>({});
  const [benchmark, setBenchmark] = useState<string>("");
  const [draft, setDraft] = useState({ ticker: "", date: today(), kind: "buy" as Transaction["kind"], shares: "", price: "", fee: "" });
  const [window, setWindow] = useState<WindowId>("Max");
  const palette = chartPalette(theme);

  useEffect(() => { try { localStorage.setItem(LEDGER_KEY, JSON.stringify(transactions)); } catch { /* Private mode. */ } }, [transactions]);

  // What is held now, and what each holding cost, replayed from the ledger.
  const positions = useMemo(() => positionsFromTransactions(transactions), [transactions]);
  const lots = useMemo(() => buildLots(transactions), [transactions]);
  const realised = useMemo(() => totalRealised(transactions), [transactions]);
  const opened = useMemo(() => firstTradeDate(transactions), [transactions]);
  const timeline = useMemo(() => shareTimeline(transactions), [transactions]);
  const flows = useMemo(() => flowsByDate(transactions), [transactions]);
  // Every ticker the book has ever touched needs a price history, not just the
  // ones still held: a line that stops when a position is sold is a line that
  // forgets the money it made.
  const everTraded = useMemo(() => [...new Set(transactions.map((entry) => entry.ticker.toUpperCase()))], [transactions]);
  /** Oldest first, which is the order a ledger is read in. */
  const ledger = useMemo(() => sortTransactions(transactions), [transactions]);
  const sold = useMemo(() => transactions.filter((entry) => entry.kind === "sell"), [transactions]);
  /** Held once, held no longer: still part of the record. */
  const closed = useMemo(() => Object.values(lots).filter((lot) => lot.shares <= 1e-9 && lot.count > 0).sort((a, b) => b.lastDate.localeCompare(a.lastDate)), [lots]);
  const migratedDates = useMemo(() => transactions.filter((entry) => entry.migrated).length, [transactions]);

  useEffect(() => {
    let active = true;
    fetch("/api/watchlist").then(async (response) => {
      const payload = await response.json() as { summaries?: WatchlistSummary[] };
      if (active) setSummaries(Object.fromEntries((payload.summaries ?? []).map((item) => [item.ticker, item])));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const tickers = everTraded.join("|");
  useEffect(() => {
    let active = true;
    const today = new Date().toISOString().slice(0, 10);
    for (const ticker of tickers.split("|").filter(Boolean)) {
      fetch(`/api/price/${encodeURIComponent(ticker)}?date=${today}`)
        .then(async (response) => {
          const point = await response.json() as PricePoint;
          if (active) setPrices((current) => ({ ...current, [ticker]: response.ok ? point.priceClose ?? point.close ?? null : null }));
        })
        .catch(() => active && setPrices((current) => ({ ...current, [ticker]: null })));
    }
    return () => { active = false; };
  }, [tickers]);

  // Weekly closes are enough to draw a portfolio's shape over years without
  // asking for a decade of daily sessions per holding.
  const wanted = [...tickers.split("|").filter(Boolean), ...(benchmark ? [benchmark] : [])].join("|");
  // A book opened last month cannot be drawn from weekly closes: it would be
  // four points. The granularity follows the span the ledger actually covers,
  // and the range starts at the first trade rather than ten years before it.
  // Measured against the last trade rather than against the clock, so the
  // choice is a pure function of the ledger and does not change under a
  // re-render. Two years of trading is where weekly closes stop losing shape.
  const frequency = useMemo(() => {
    const last = ledger.at(-1)?.date;
    if (!opened || !last) return "daily" as const;
    return (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${opened}T00:00:00Z`)) / 86_400_000 > 730 ? "weekly" as const : "daily" as const;
  }, [opened, ledger]);
  useEffect(() => {
    let active = true;
    const end = new Date().toISOString().slice(0, 10);
    const start = opened ?? `${Number(end.slice(0, 4)) - 10}${end.slice(4)}`;
    for (const ticker of wanted.split("|").filter(Boolean)) {
      fetch(`/api/market/${encodeURIComponent(ticker)}?start=${start}&end=${end}&frequency=${frequency}`)
        .then(async (response) => {
          const payload = await response.json() as { bars?: MarketBar[] };
          if (!response.ok) throw new Error("unavailable");
          const points = (payload.bars ?? []).flatMap((bar) => {
            const value = bar.adjustedClose ?? bar.close;
            return value == null ? [] : [{ date: bar.date, value }];
          });
          if (active) setHistories((current) => ({ ...current, [ticker]: points }));
        })
        .catch(() => active && setHistories((current) => ({ ...current, [ticker]: [] })));
    }
    return () => { active = false; };
  }, [wanted, opened, frequency]);

  const names = useMemo(() => Object.fromEntries(watchlist.map((company) => [company.ticker, { name: company.name, sector: company.sector }])), [watchlist]);
  const valued = useMemo(() => valuePortfolio(positions, summaries, prices, names), [positions, summaries, prices, names]);
  const spread = useMemo(() => concentration(valued.positions), [valued]);
  const bySector = useMemo(() => weightBy(valued.positions, (position) => position.sector), [valued]);
  // The value line uses the shares held on each date, so a position opened in
  // June is not drawn as though it had been there since January.
  const full = useMemo(() => holdingsSeries(timeline, histories, opened), [timeline, histories, opened]);
  const series = useMemo(() => withinWindow(full, WINDOWS.find((item) => item.id === window)?.years ?? Infinity), [full, window]);
  // Against an index the book has to be measured with its deposits taken out,
  // or every purchase reads as a gain the reader did not make.
  const returnSeries = useMemo(() => timeWeightedSeries(series, flows), [series, flows]);
  const returnStats = useMemo(() => seriesStats(returnSeries), [returnSeries]);
  const benchmarkStats = useMemo(() => {
    const history = benchmark ? histories[benchmark] ?? [] : [];
    if (!history.length || !series.length) return null;
    return seriesStats(history.filter((point) => point.date >= series[0].date && point.date <= series.at(-1)!.date));
  }, [histories, benchmark, series]);
  const compared = useMemo(() => benchmark && histories[benchmark]?.length ? rebasePair(returnSeries, histories[benchmark]) : [], [returnSeries, histories, benchmark]);

  // Every resolvable company can be traded, including one already held: a
  // second purchase of something you own is the most ordinary entry there is.
  const available = watchlist.filter((company) => company.resolutionStatus !== "unresolved");
  const decimal = (text: string) => Number(text.replace(",", "."));
  const heldNow = (ticker: string) => lots[ticker.toUpperCase()]?.shares ?? 0;

  const draftShares = decimal(draft.shares);
  const draftPrice = decimal(draft.price);
  const overSold = draft.kind === "sell" && draft.ticker && Number.isFinite(draftShares) && draftShares > heldNow(draft.ticker);
  const canAdd = Boolean(draft.ticker) && /^\d{4}-\d{2}-\d{2}$/.test(draft.date)
    && Number.isFinite(draftShares) && draftShares > 0 && Number.isFinite(draftPrice) && draftPrice >= 0 && !overSold;

  function add() {
    if (!canAdd) return;
    const fee = decimal(draft.fee);
    setTransactions((current) => [...current, {
      id: newTransactionId(), ticker: draft.ticker.toUpperCase(), date: draft.date, kind: draft.kind,
      shares: draftShares, price: draftPrice, ...(Number.isFinite(fee) && fee > 0 ? { fee } : {}),
    }]);
    setDraft((current) => ({ ...current, shares: "", price: "", fee: "" }));
  }

  const editTransaction = (id: string, change: Partial<Transaction>) =>
    setTransactions((current) => current.map((entry) => entry.id === id ? { ...entry, ...change } : entry));
  const removeTransaction = (id: string) => setTransactions((current) => current.filter((entry) => entry.id !== id));

  return <div className="portfolio-page">
    <header className="page-heading">
      <div>
        <h1>Portfolio</h1>
        <p>What your money owns, measured the way a business is measured. Every figure below is the holdings&rsquo; own, weighted by what each position is worth.</p>
      </div>
    </header>

    <section className="portfolio-summary">
      <article><span>Value</span><strong>{money(valued.value)}</strong><small>{valued.positions.length} holding{valued.positions.length === 1 ? "" : "s"}{valued.unpriced.length ? ` · ${valued.unpriced.length} unpriced` : ""}</small></article>
      <article><span>Cost</span><strong>{valued.costCoverage > 0 ? money(valued.cost) : "—"}</strong><small>{valued.costCoverage > 0 ? `${percent(valued.costCoverage, 0)} of the book has a cost entered` : "Enter what you paid to see profit"}</small></article>
      <article className={valued.profit == null ? "" : valued.profit >= 0 ? "up" : "down"}>
        <span>Unrealised P&amp;L</span>
        <strong>{valued.profit == null ? "—" : `${valued.profit >= 0 ? "+" : "−"}${money(Math.abs(valued.profit))}`}</strong>
        <small>{valued.profitPercent == null ? "Needs a purchase price" : `${valued.profitPercent >= 0 ? "+" : ""}${percent(valued.profitPercent)} on cost`}</small>
      </article>
      {/* Money already banked. Kept apart from the unrealised figure because
          they answer different questions: one is what the book is sitting on,
          the other is what it has actually taken. */}
      <article className={realised === 0 ? "" : realised > 0 ? "up" : "down"}>
        <span>Realised P&amp;L</span>
        <strong>{sold.length ? `${realised >= 0 ? "+" : "−"}${money(Math.abs(realised))}` : "—"}</strong>
        <small>{sold.length ? `Banked across ${sold.length} sale${sold.length === 1 ? "" : "s"}` : "Nothing sold yet"}</small>
      </article>
      <article><span>Largest position</span><strong>{percent(spread.largest)}</strong><small>{valued.positions.length ? [...valued.positions].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0]?.ticker : "—"}</small></article>
      <article><span>Effective holdings</span><strong>{spread.effectiveHoldings == null ? "—" : spread.effectiveHoldings.toFixed(1)}</strong><small>Equal-sized positions this book behaves like</small></article>
    </section>

    {series.length > 1 && <section className="portfolio-summary">
      {/* Every figure here is the deposit-free one. The raw value line doubles
          when the reader pays in, and quoting that as a return would be a
          straightforward lie about how the book performed. */}
      <article><span>Return · {window}</span><strong>{percent(returnStats.change)}</strong><small>From {returnStats.start?.date}{benchmarkStats?.change != null ? ` · index ${percent(benchmarkStats.change)}` : ""}</small></article>
      <article><span>CAGR · {window}</span><strong>{percent(returnStats.cagr)}</strong><small>{returnStats.years == null ? "" : `Over ${returnStats.years.toFixed(1)} years`}{benchmarkStats?.cagr != null ? ` · index ${percent(benchmarkStats.cagr)}` : ""}</small></article>
      <article><span>Worst drawdown</span><strong>{percent(returnStats.drawdown)}</strong><small>{returnStats.drawdownDate ? `Bottomed ${returnStats.drawdownDate}, measured from the running peak` : "No fall from a peak inside this window"}</small></article>
      <article><span>Best / worst {frequency === "daily" ? "day" : "week"}</span><strong>{returnStats.bestStep == null ? "—" : `${percent(returnStats.bestStep)} / ${percent(returnStats.worstStep)}`}</strong><small>The largest single steps in the window</small></article>
    </section>}

    {!transactions.length && <p className="simple-state">No trades yet. Record a purchase below to see what your money owns.</p>}

    {positions.length > 0 && <>
      <section className="plain-section">
        <div className="section-heading"><h2>How the money is spread</h2></div>
        <div className="portfolio-charts">
          <figure className="kpi-card">
            <figcaption><h3>By position</h3><small>Share of priced value</small></figcaption>
            <div className="kpi-canvas"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...valued.positions].filter((position) => position.weight != null).sort((a, b) => b.weight! - a.weight!)} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
                <CartesianGrid horizontal={false} stroke="var(--chart-grid)"/>
                <XAxis type="number" tickFormatter={(value) => percent(Number(value), 0)} tickLine={false} axisLine={false}/>
                <YAxis type="category" dataKey="ticker" width={62} tickLine={false} axisLine={false}/>
                <Tooltip cursor={{ fill: "var(--grid)" }} content={({ active, payload }) => {
                  const row = active && payload?.length ? payload[0].payload as ValuedPosition : null;
                  return row ? <div className="chart-tooltip"><b>{row.ticker}</b>
                    <span><span>Weight</span><strong>{percent(row.weight)}</strong></span>
                    <span><span>Value</span><strong>{money(row.value)}</strong></span>
                    <span><span>Shares</span><strong>{row.shares}</strong></span>
                  </div> : null;
                }}/>
                <Bar dataKey="weight" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                  {valued.positions.map((position, index) => <Cell key={position.ticker} fill={palette[index % palette.length].value}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer></div>
          </figure>

          <figure className="kpi-card">
            <figcaption><h3>By sector</h3><small>Share of priced value</small></figcaption>
            <div className="kpi-canvas"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySector} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
                <CartesianGrid horizontal={false} stroke="var(--chart-grid)"/>
                <XAxis type="number" tickFormatter={(value) => percent(Number(value), 0)} tickLine={false} axisLine={false}/>
                <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false}/>
                <Tooltip cursor={{ fill: "var(--grid)" }} content={({ active, payload }) => {
                  const row = active && payload?.length ? payload[0].payload as { label: string; weight: number } : null;
                  return row ? <div className="chart-tooltip"><b>{row.label}</b><span><span>Weight</span><strong>{percent(row.weight)}</strong></span></div> : null;
                }}/>
                <Bar dataKey="weight" fill={palette[2].value} radius={[0, 3, 3, 0]} isAnimationActive={false}/>
              </BarChart>
            </ResponsiveContainer></div>
          </figure>
        </div>
      </section>

      <section className="plain-section">
        <div className="section-heading">
          <h2>Value through time</h2>
          <div className="segmented" role="group" aria-label="Window">
            {WINDOWS.map((item) => <button key={item.id} type="button" className={window === item.id ? "active" : ""} onClick={() => setWindow(item.id)}>{item.id}</button>)}
          </div>
          <div className="segmented" role="group" aria-label="Compare against">
            <button type="button" className={benchmark === "" ? "active" : ""} onClick={() => setBenchmark("")}>Portfolio only</button>
            {BENCHMARKS.map((item) => <button key={item.ticker} type="button" className={benchmark === item.ticker ? "active" : ""} onClick={() => setBenchmark(item.ticker)}>vs {item.label}</button>)}
          </div>
        </div>
        <p className="section-note">
          {benchmark
            ? "Your return with deposits and withdrawals removed, against the index over the same stretch, both rebased to 100. A purchase adds to what the book is worth without being a gain, so the comparison takes it out."
            : "What the book was actually worth on each date, using the shares held on that date. It steps up when you bought and down when you sold, because those are movements of money rather than returns."}
          {migratedDates > 0 && " Holdings carried over from before this page had dates are all dated the day they were migrated, so anything before that day is missing from the line."}
        </p>
        {series.length < 2
          ? <p className="simple-state">Not enough shared price history to draw a line. Every holding needs a session on the same week.</p>
          : <div className="portfolio-timeline"><ResponsiveContainer width="100%" height="100%">
              <LineChart data={(benchmark ? compared : series) as Array<Record<string, unknown>>} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)"/>
                <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={48}/>
                <YAxis width={70} tickLine={false} axisLine={false}
                  domain={benchmark ? ["auto", "auto"] : [(() => { const ticks = niceTicks(0, Math.max(...series.map((point) => point.value))); return ticks[0] ?? 0; })(), "auto"]}
                  tickFormatter={(value) => benchmark ? String(Math.round(Number(value))) : money(Number(value))}/>
                <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="chart-tooltip"><b>{label}</b>
                  {payload.map((item) => <span key={String(item.dataKey)}><i style={{ background: String(item.color) }}/><span>{item.dataKey === "benchmark" ? BENCHMARKS.find((entry) => entry.ticker === benchmark)?.label ?? "Benchmark" : "Portfolio"}</span><strong>{benchmark ? Number(item.value).toFixed(1) : money(Number(item.value))}</strong></span>)}
                </div> : null}/>
                {benchmark
                  ? <><Line dataKey="portfolio" stroke={palette[0].value} strokeWidth={2} dot={false} type="linear" isAnimationActive={false}/>
                      <Line dataKey="benchmark" stroke={palette[1].value} strokeWidth={2} strokeDasharray="6 4" dot={false} type="linear" isAnimationActive={false}/></>
                  : <Line dataKey="value" stroke={palette[0].value} strokeWidth={2} dot={false} type="linear" isAnimationActive={false}/>}
              </LineChart>
            </ResponsiveContainer></div>}
      </section>

      <section className="plain-section">
        <div className="section-heading"><h2>What the book owns</h2></div>
        <p className="section-note">Each figure is the holdings&rsquo; own, weighted by position value. Where a holding does not report one, it is left out and the rest are renormalised — coverage says how much of the book the answer speaks for.</p>
        <div className="table-scroll"><table>
          <thead><tr><th>Measure</th><th>Portfolio</th><th>Coverage</th><th>Not reported by</th></tr></thead>
          <tbody>{QUALITY.map((metric) => {
            const result = weightedMetric(valued.positions, metric.read);
            return <tr key={metric.key}>
              <th title={metric.hint}>{metric.label}</th>
              <td>{metric.format(result.value)}</td>
              <td>{result.coverage > 0 ? percent(result.coverage, 0) : "—"}</td>
              <td>{result.missing.length ? result.missing.join(", ") : "—"}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </section>
    </>}

    {positions.length > 0 && <section className="plain-section">
      <div className="section-heading"><h2>Positions</h2></div>
      {/* Read-only on purpose. Shares and cost are conclusions drawn from the
          trades below, and a box that let you overwrite a conclusion would put
          the book and its own history permanently out of step. */}
      <p className="section-note">What each holding is, after replaying every trade. Shares and cost per share follow from the ledger below rather than being typed here.</p>
      <div className="table-scroll"><table>
        <thead><tr><th>Company</th><th>Shares</th><th>Cost / share</th><th>Price</th><th>Cost</th><th>Value</th><th>Unrealised</th><th>%</th><th>Realised</th><th>Weight</th><th>Held since</th></tr></thead>
        <tbody>
          {valued.positions.map((position) => {
            const lot = lots[position.ticker];
            return <tr key={position.ticker}>
              <th><button className="value-button" onClick={() => onOpen(position.ticker)}>{position.ticker}<small>{position.name}</small></button></th>
              <td className="numeric">{position.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
              <td className="numeric">{money(lot?.averageCost ?? null)}</td>
              <td className="numeric">{money(position.price)}</td>
              <td className="numeric">{money(position.costBasis)}</td>
              <td className="numeric">{money(position.value)}</td>
              <td className={`numeric ${position.profit == null ? "" : position.profit >= 0 ? "up" : "down"}`}>{position.profit == null ? "—" : `${position.profit >= 0 ? "+" : "−"}${money(Math.abs(position.profit))}`}</td>
              <td className={`numeric ${position.profitPercent == null ? "" : position.profitPercent >= 0 ? "up" : "down"}`}>{position.profitPercent == null ? "—" : `${position.profitPercent >= 0 ? "+" : ""}${percent(position.profitPercent)}`}</td>
              <td className={`numeric ${!lot?.realised ? "" : lot.realised > 0 ? "up" : "down"}`}>{!lot?.realised ? "—" : `${lot.realised >= 0 ? "+" : "−"}${money(Math.abs(lot.realised))}`}</td>
              <td className="numeric">{percent(position.weight)}</td>
              <td>{lot?.firstDate ?? "—"}</td>
            </tr>;
          })}
        </tbody>
      </table></div>
    </section>}

    {closed.length > 0 && <section className="plain-section">
      <div className="section-heading"><h2>Closed positions</h2></div>
      {/* A position sold is still part of what the book did, and dropping it
          from the page would quietly flatter the record by showing only the
          holdings that survived. */}
      <p className="section-note">Sold in full. They are gone from every weight above and still count towards what the book has made.</p>
      <div className="table-scroll"><table>
        <thead><tr><th>Company</th><th>Realised</th><th>Trades</th><th>First</th><th>Last</th></tr></thead>
        <tbody>{closed.map((lot) => <tr key={lot.ticker}>
          <th><button className="value-button" onClick={() => onOpen(lot.ticker)}>{lot.ticker}</button></th>
          <td className={`numeric ${lot.realised >= 0 ? "up" : "down"}`}>{`${lot.realised >= 0 ? "+" : "−"}${money(Math.abs(lot.realised))}`}</td>
          <td className="numeric">{lot.count}</td>
          <td>{lot.firstDate}</td>
          <td>{lot.lastDate}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    <section className="plain-section">
      <div className="section-heading"><h2>Trades</h2></div>
      <p className="section-note">Every buy and sell, on the day it happened. Everything above is computed from this list — change a date and the value line, the weights and the returns all move with it.</p>

      <div className="table-scroll ledger-scroll"><table className="ledger-table">
        <thead><tr><th>Date</th><th>Company</th><th>Side</th><th>Shares</th><th>Price</th><th>Fee</th><th>Amount</th><th/></tr></thead>
        <tbody>
          {ledger.map((entry) => {
            const amount = entry.shares * entry.price + (entry.fee ?? 0) * (entry.kind === "buy" ? 1 : -1);
            return <tr key={entry.id} className={entry.migrated ? "ledger-migrated" : ""}>
              <td data-label="Date"><input type="date" value={entry.date} aria-label={`Date of ${entry.kind} of ${entry.ticker}`}
                onChange={(event) => event.target.value && editTransaction(entry.id, { date: event.target.value })}/></td>
              <th data-label="Company">{entry.ticker}{entry.migrated && <small>carried over · date unknown</small>}</th>
              <td data-label="Side">
                <select value={entry.kind} aria-label={`Side of ${entry.ticker} trade`}
                  onChange={(event) => editTransaction(entry.id, { kind: event.target.value as Transaction["kind"] })}>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </td>
              <td data-label="Shares"><input className="portfolio-shares" type="number" min="0" step="any" value={entry.shares} aria-label={`Shares of ${entry.ticker}`}
                onChange={(event) => editTransaction(entry.id, { shares: Number(event.target.value) })}/></td>
              <td data-label="Price"><input className="portfolio-shares" type="number" min="0" step="any" value={entry.price} aria-label={`Price per share of ${entry.ticker}`}
                onChange={(event) => editTransaction(entry.id, { price: Number(event.target.value) })}/></td>
              <td data-label="Fee"><input className="portfolio-shares" type="number" min="0" step="any" placeholder="—" value={entry.fee ?? ""} aria-label={`Fee on ${entry.ticker} trade`}
                onChange={(event) => editTransaction(entry.id, { fee: event.target.value === "" ? undefined : Number(event.target.value) })}/></td>
              <td className="numeric" data-label="Amount">{entry.kind === "buy" ? "−" : "+"}{money(Math.abs(amount))}</td>
              <td data-label=""><button className="text-button" onClick={() => removeTransaction(entry.id)}>Remove</button></td>
            </tr>;
          })}

          <tr className="ledger-draft">
            <td data-label="Date"><input type="date" value={draft.date} aria-label="Trade date"
              onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}/></td>
            <th data-label="Company">
              <select value={draft.ticker} onChange={(event) => setDraft((current) => ({ ...current, ticker: event.target.value }))} aria-label="Company">
                <option value="">Company…</option>
                {available.map((company) => <option key={company.ticker} value={company.ticker}>{company.ticker} · {company.name}</option>)}
              </select>
            </th>
            <td data-label="Side">
              <select value={draft.kind} aria-label="Side"
                onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as Transaction["kind"] }))}>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </td>
            <td data-label="Shares"><input className="portfolio-shares" type="number" min="0" step="any" placeholder="Shares" value={draft.shares} aria-label="Shares"
              onChange={(event) => setDraft((current) => ({ ...current, shares: event.target.value }))}
              onKeyDown={(event) => { if (event.key === "Enter") add(); }}/></td>
            <td data-label="Price"><input className="portfolio-shares" type="number" min="0" step="any" placeholder="Price" value={draft.price} aria-label="Price per share"
              onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}
              onKeyDown={(event) => { if (event.key === "Enter") add(); }}/></td>
            <td data-label="Fee"><input className="portfolio-shares" type="number" min="0" step="any" placeholder="Optional" value={draft.fee} aria-label="Fee"
              onChange={(event) => setDraft((current) => ({ ...current, fee: event.target.value }))}
              onKeyDown={(event) => { if (event.key === "Enter") add(); }}/></td>
            <td className="numeric" data-label="Amount">{draft.shares && draft.price ? money(draftShares * draftPrice) : "—"}</td>
            <td data-label=""><button onClick={add} disabled={!canAdd}>Add</button></td>
          </tr>
        </tbody>
      </table></div>

      {overSold && <p className="notice">You hold {heldNow(draft.ticker).toLocaleString("en-US", { maximumFractionDigits: 4 })} {draft.ticker} on that date. Selling more than that would put the book short, which this page does not model.</p>}

      <p className="section-note">A price is what you actually dealt at, not today&rsquo;s. Fees are optional and are added to a purchase&rsquo;s cost and taken off a sale&rsquo;s proceeds. The ledger is kept in this browser only, and nothing about what you hold leaves the machine.</p>
    </section>
  </div>;
}
