"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartPalette, niceTicks, type ThemeName } from "@/lib/charting";
import { concentration, portfolioSeries, rebasePair, valuePortfolio, weightBy, weightedMetric, type Position, type SeriesPoint, type ValuedPosition } from "@/lib/portfolio";
import type { WatchlistSummary } from "@/lib/watchlist-summary";
import type { CompanyProfile, MarketBar, PricePoint } from "@/lib/types";

const STORAGE_KEY = "finscope.portfolio";
const BENCHMARKS = [{ ticker: "^GSPC", label: "S&P 500" }, { ticker: "^NDX", label: "Nasdaq 100" }] as const;

const money = (value: number | null, currency = "USD") => value == null || !Number.isFinite(value)
  ? "—"
  : `${value < 0 ? "-" : ""}${currency === "USD" ? "$" : `${currency} `}${new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 100_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(Math.abs(value))}`;
const percent = (value: number | null, digits = 1) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const ratio = (value: number | null, digits = 2) => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}×`;

function readPositions(): Position[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((entry) => {
      const item = entry as Record<string, unknown>;
      return typeof item?.ticker === "string" && typeof item.shares === "number" && item.shares > 0
        ? [{ ticker: item.ticker, shares: item.shares }] : [];
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
  const [positions, setPositions] = useState<Position[]>(readPositions);
  const [summaries, setSummaries] = useState<Record<string, WatchlistSummary>>({});
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [histories, setHistories] = useState<Record<string, SeriesPoint[]>>({});
  const [benchmark, setBenchmark] = useState<string>("");
  const [draft, setDraft] = useState({ ticker: "", shares: "" });
  const palette = chartPalette(theme);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(positions)); }, [positions]);

  useEffect(() => {
    let active = true;
    fetch("/api/watchlist").then(async (response) => {
      const payload = await response.json() as { summaries?: WatchlistSummary[] };
      if (active) setSummaries(Object.fromEntries((payload.summaries ?? []).map((item) => [item.ticker, item])));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const tickers = positions.map((position) => position.ticker).join("|");
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
  useEffect(() => {
    let active = true;
    const end = new Date().toISOString().slice(0, 10);
    const start = `${Number(end.slice(0, 4)) - 10}${end.slice(4)}`;
    for (const ticker of wanted.split("|").filter(Boolean)) {
      fetch(`/api/market/${encodeURIComponent(ticker)}?start=${start}&end=${end}&frequency=weekly`)
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
  }, [wanted]);

  const names = useMemo(() => Object.fromEntries(watchlist.map((company) => [company.ticker, { name: company.name, sector: company.sector }])), [watchlist]);
  const valued = useMemo(() => valuePortfolio(positions, summaries, prices, names), [positions, summaries, prices, names]);
  const spread = useMemo(() => concentration(valued.positions), [valued]);
  const bySector = useMemo(() => weightBy(valued.positions, (position) => position.sector), [valued]);
  const series = useMemo(() => portfolioSeries(positions, histories), [positions, histories]);
  const compared = useMemo(() => benchmark && histories[benchmark]?.length ? rebasePair(series, histories[benchmark]) : [], [series, histories, benchmark]);

  const available = watchlist.filter((company) => company.resolutionStatus !== "unresolved" && !positions.some((position) => position.ticker === company.ticker));

  function add() {
    const shares = Number(draft.shares.replace(",", "."));
    if (!draft.ticker || !Number.isFinite(shares) || shares <= 0) return;
    setPositions((current) => [...current.filter((position) => position.ticker !== draft.ticker), { ticker: draft.ticker, shares }]);
    setDraft({ ticker: "", shares: "" });
  }

  const growth = series.length > 1 ? series.at(-1)!.value / series[0].value - 1 : null;

  return <div className="portfolio-page">
    <header className="page-heading">
      <div>
        <h1>Portfolio</h1>
        <p>What your money owns, measured the way a business is measured. Every figure below is the holdings&rsquo; own, weighted by what each position is worth.</p>
      </div>
    </header>

    <section className="portfolio-summary">
      <article><span>Value</span><strong>{money(valued.value)}</strong><small>{valued.positions.length} holding{valued.positions.length === 1 ? "" : "s"}{valued.unpriced.length ? ` · ${valued.unpriced.length} unpriced` : ""}</small></article>
      <article><span>Largest position</span><strong>{percent(spread.largest)}</strong><small>{valued.positions.length ? [...valued.positions].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0]?.ticker : "—"}</small></article>
      <article><span>Effective holdings</span><strong>{spread.effectiveHoldings == null ? "—" : spread.effectiveHoldings.toFixed(1)}</strong><small>Equal-sized positions this book behaves like</small></article>
      <article><span>Since {series[0]?.date ?? "—"}</span><strong>{percent(growth)}</strong><small>On today&rsquo;s holdings, priced back through time</small></article>
    </section>

    {!positions.length && <p className="simple-state">No positions yet. Add one below to see what it owns.</p>}

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
          <div className="segmented" role="group" aria-label="Compare against">
            <button type="button" className={benchmark === "" ? "active" : ""} onClick={() => setBenchmark("")}>Portfolio only</button>
            {BENCHMARKS.map((item) => <button key={item.ticker} type="button" className={benchmark === item.ticker ? "active" : ""} onClick={() => setBenchmark(item.ticker)}>vs {item.label}</button>)}
          </div>
        </div>
        <p className="section-note">
          Today&rsquo;s share counts priced back through time — what this book would have been worth had you always held it, not what it did.
          {benchmark ? " Both sides are rebased to 100 at their first shared week, so the comparison is of shapes rather than sizes." : ""}
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

    <section className="plain-section">
      <div className="section-heading"><h2>Positions</h2></div>
      <div className="table-scroll"><table>
        <thead><tr><th>Company</th><th>Shares</th><th>Price</th><th>Value</th><th>Weight</th><th/></tr></thead>
        <tbody>
          {valued.positions.map((position) => <tr key={position.ticker}>
            <th><button className="value-button" onClick={() => onOpen(position.ticker)}>{position.ticker}<small>{position.name}</small></button></th>
            <td><input className="portfolio-shares" type="number" min="0" step="any" value={position.shares}
              aria-label={`Shares of ${position.ticker}`}
              onChange={(event) => { const shares = Number(event.target.value); setPositions((current) => current.map((item) => item.ticker === position.ticker ? { ...item, shares } : item)); }}/></td>
            <td>{money(position.price)}</td>
            <td>{money(position.value)}</td>
            <td>{percent(position.weight)}</td>
            <td><button className="text-button" onClick={() => setPositions((current) => current.filter((item) => item.ticker !== position.ticker))}>Remove</button></td>
          </tr>)}
          <tr>
            <th>
              <select value={draft.ticker} onChange={(event) => setDraft((current) => ({ ...current, ticker: event.target.value }))} aria-label="Company to add">
                <option value="">Add a holding…</option>
                {available.map((company) => <option key={company.ticker} value={company.ticker}>{company.ticker} · {company.name}</option>)}
              </select>
            </th>
            <td><input className="portfolio-shares" type="number" min="0" step="any" placeholder="Shares" value={draft.shares} aria-label="Shares"
              onChange={(event) => setDraft((current) => ({ ...current, shares: event.target.value }))}
              onKeyDown={(event) => { if (event.key === "Enter") add(); }}/></td>
            <td colSpan={3}/>
            <td><button onClick={add} disabled={!draft.ticker || !draft.shares}>Add</button></td>
          </tr>
        </tbody>
      </table></div>
      <p className="section-note">Positions are kept in this browser only. Nothing about what you hold leaves the machine.</p>
    </section>
  </div>;
}
