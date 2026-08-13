"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, CartesianGrid, ComposedChart, Legend,
  Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AreaChart as AreaChartIcon, BarChart3, BookOpen, Calculator, Check, ChevronDown,
  CircleDollarSign, Clipboard, Cloud, Command, Download, ExternalLink, FileDown,
  Gauge, Heart, Home, Info, Layers3, LineChart as LineChartIcon, Loader2, Menu,
  Moon, MoreHorizontal, PanelLeftClose, Search, Settings, ShieldCheck, Sparkles,
  Sun, Table2, TrendingDown, TrendingUp, Users, X,
} from "lucide-react";
import { COMPANIES, findCompany } from "@/lib/company-registry";
import { FORMULAS, cagr, convertUnit, derivedValue, dilutionRate, freeCashFlow, valueOf } from "@/lib/finance";
import type { CompanyDataset, FinancialPeriod, MetricKey, NormalizedFact } from "@/lib/types";

type ViewKey = "overview" | "income" | "cashflow" | "margins" | "pershare" | "shares" | "valuation" | "sources" | "settings";
type Unit = "unit" | "thousand" | "million" | "billion";
type DisplayMode = "absolute" | "perShare" | "margins" | "growth";

const NAV: Array<{ key: ViewKey; label: string; icon: typeof Home; section?: string }> = [
  { key: "overview", label: "Company overview", icon: Home, section: "ANALYSIS" },
  { key: "income", label: "Income statement", icon: Table2 },
  { key: "cashflow", label: "Cash flow", icon: AreaChartIcon },
  { key: "margins", label: "Margins", icon: Gauge },
  { key: "pershare", label: "Per share", icon: Calculator },
  { key: "shares", label: "Shares & buybacks", icon: Users, section: "CAPITAL" },
  { key: "valuation", label: "Valuation", icon: CircleDollarSign },
  { key: "sources", label: "Sources & methodology", icon: BookOpen, section: "SYSTEM" },
  { key: "settings", label: "Settings", icon: Settings },
];

const METRICS: Record<string, { label: string; short: string; color: string; kind: "currency" | "shares" | "percent" | "perShare"; formula?: string }> = {
  revenue: { label: "Revenue", short: "Revenue", color: "#53d39c", kind: "currency" },
  grossProfit: { label: "Gross profit", short: "Gross profit", color: "#67b7ff", kind: "currency" },
  operatingIncome: { label: "Operating income", short: "Operating income", color: "#a78bfa", kind: "currency" },
  netIncome: { label: "Net income", short: "Net income", color: "#f4bc56", kind: "currency" },
  operatingCashFlow: { label: "Operating cash flow", short: "Operating CF", color: "#48cbd4", kind: "currency" },
  capitalExpenditures: { label: "Capital expenditures", short: "Capex", color: "#f9737f", kind: "currency" },
  freeCashFlow: { label: "Free cash flow", short: "Free cash flow", color: "#c8f169", kind: "currency", formula: FORMULAS.freeCashFlow },
  grossMargin: { label: "Gross margin", short: "Gross margin", color: "#67b7ff", kind: "percent", formula: FORMULAS.grossMargin },
  operatingMargin: { label: "Operating margin", short: "Operating margin", color: "#a78bfa", kind: "percent", formula: FORMULAS.operatingMargin },
  netMargin: { label: "Net margin", short: "Net margin", color: "#f4bc56", kind: "percent", formula: FORMULAS.netMargin },
  operatingCashFlowMargin: { label: "Operating cash flow margin", short: "OCF margin", color: "#48cbd4", kind: "percent", formula: FORMULAS.operatingCashFlowMargin },
  freeCashFlowMargin: { label: "Free cash flow margin", short: "FCF margin", color: "#c8f169", kind: "percent", formula: FORMULAS.freeCashFlowMargin },
  dilutedShares: { label: "Diluted weighted average shares", short: "Diluted shares", color: "#67b7ff", kind: "shares" },
  basicShares: { label: "Basic weighted average shares", short: "Basic shares", color: "#8c9db7", kind: "shares" },
  sharesOutstanding: { label: "Shares outstanding · period end", short: "Shares out.", color: "#f4bc56", kind: "shares" },
  shareRepurchases: { label: "Gross share repurchases", short: "Buybacks", color: "#53d39c", kind: "currency" },
  shareIssuance: { label: "Share issuance proceeds", short: "Issuance", color: "#f9737f", kind: "currency" },
  revenuePerShare: { label: "Revenue per share", short: "Revenue / share", color: "#53d39c", kind: "perShare", formula: FORMULAS.revenuePerShare },
  grossProfitPerShare: { label: "Gross profit per share", short: "Gross profit / share", color: "#67b7ff", kind: "perShare", formula: FORMULAS.grossProfitPerShare },
  operatingIncomePerShare: { label: "Operating income per share", short: "Operating income / share", color: "#a78bfa", kind: "perShare", formula: FORMULAS.operatingIncomePerShare },
  netIncomePerShare: { label: "Net income per share", short: "Net income / share", color: "#f4bc56", kind: "perShare", formula: FORMULAS.netIncomePerShare },
  operatingCashFlowPerShare: { label: "Operating cash flow per share", short: "OCF / share", color: "#48cbd4", kind: "perShare", formula: FORMULAS.operatingCashFlowPerShare },
  freeCashFlowPerShare: { label: "Free cash flow per share", short: "FCF / share", color: "#c8f169", kind: "perShare", formula: FORMULAS.freeCashFlowPerShare },
};

const VIEW_METRICS: Record<Exclude<ViewKey, "overview" | "valuation" | "sources" | "settings">, string[]> = {
  income: ["revenue", "grossProfit", "operatingIncome", "netIncome"],
  cashflow: ["operatingCashFlow", "capitalExpenditures", "freeCashFlow", "shareRepurchases"],
  margins: ["grossMargin", "operatingMargin", "netMargin", "operatingCashFlowMargin", "freeCashFlowMargin"],
  pershare: ["revenuePerShare", "grossProfitPerShare", "operatingIncomePerShare", "netIncomePerShare", "operatingCashFlowPerShare", "freeCashFlowPerShare"],
  shares: ["dilutedShares", "basicShares", "sharesOutstanding", "shareRepurchases", "shareIssuance"],
};

function compactCurrency(value: number | null, currency = "USD") {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatValue(value: number | null, kind: string, unit: Unit, currency = "USD") {
  if (value == null || Number.isNaN(value)) return "—";
  if (kind === "percent") return `${(value * 100).toFixed(1)}%`;
  if (kind === "perShare") return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  const converted = convertUnit(value, unit);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(converted ?? 0);
}

function growth(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous === 0) return null;
  return current / previous - 1;
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function FinanceApp({ initialData }: { initialData: CompanyDataset }) {
  const [dataset, setDataset] = useState(initialData);
  const [view, setView] = useState<ViewKey>("overview");
  const [periodicity, setPeriodicity] = useState<"annual" | "quarterly" | "ttm">("annual");
  const [unit, setUnit] = useState<Unit>("billion");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("absolute");
  const [range, setRange] = useState(10);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [favorite, setFavorite] = useState(false);
  const [selectedFact, setSelectedFact] = useState<NormalizedFact | null>(null);
  const [copied, setCopied] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    if (window.innerWidth <= 800) setSidebarOpen(false);
  }, []);

  const periods = useMemo(() => dataset.periods.filter((period) => period.periodicity === periodicity || periodicity === "annual").slice(-range), [dataset, periodicity, range]);
  const latest = periods.at(-1) ?? dataset.periods.at(-1)!;
  const previous = periods.at(-2);
  const suggestions = query ? findCompany(query).slice(0, 5) : COMPANIES.slice(0, 5);

  async function selectTicker(ticker: string) {
    setSearchOpen(false);
    setQuery("");
    if (ticker === dataset.company.ticker) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/company/${ticker}`);
      const payload = await response.json() as CompanyDataset & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Data unavailable");
      setDataset(payload);
      history.replaceState(null, "", `/?ticker=${ticker}&view=${view}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data unavailable");
    } finally {
      setLoading(false);
    }
  }

  function exportCsv(metrics: string[], all = false) {
    const selectedPeriods = all ? dataset.periods : periods;
    const rows = [["company", "ticker", "metric", "period_end", "periodicity", "value", "currency", "unit", "provider", "status", "concept_or_formula", "source_url"]];
    for (const period of selectedPeriods) {
      for (const metric of metrics) {
        const definition = METRICS[metric];
        const rawFact = period.facts[metric as MetricKey];
        const value = derivedValue(period, metric);
        rows.push([
          dataset.company.name, dataset.company.ticker, definition.label, period.periodEnd, period.periodicity,
          value == null ? "" : String(value), period.currency, definition.kind, rawFact?.provenance.provider ?? "Calculated",
          rawFact?.provenance.status ?? "calculated", rawFact?.provenance.concept ?? definition.formula ?? "",
          rawFact?.provenance.sourceUrl ?? "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
        ]);
      }
    }
    downloadText(`${dataset.company.ticker}-${all ? "complete" : view}.csv`, rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv;charset=utf-8");
  }

  const summary = {
    revenue: valueOf(latest, "revenue"),
    netIncome: valueOf(latest, "netIncome"),
    fcf: freeCashFlow(valueOf(latest, "operatingCashFlow"), valueOf(latest, "capitalExpenditures")),
    buybacks: valueOf(latest, "shareRepurchases"),
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="brand-row">
          <button className="brand" onClick={() => setView("overview")} aria-label="FinScope home">
            <span className="brand-mark"><BarChart3 size={18} /></span><span>finscope</span>
          </button>
          <button className="icon-button collapse-button" onClick={() => setSidebarOpen(false)} aria-label="Collapse sidebar"><PanelLeftClose size={17} /></button>
        </div>
        <nav aria-label="Main navigation">
          {NAV.map((item) => <div key={item.key}>
            {item.section && <div className="nav-section">{item.section}</div>}
            <button className={`nav-item ${view === item.key ? "active" : ""}`} onClick={() => { setView(item.key); history.replaceState(null, "", `/?ticker=${dataset.company.ticker}&view=${item.key}`); }}>
              <item.icon size={17} /><span>{item.label}</span>{item.key === "sources" && <span className="nav-dot" />}
            </button>
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="source-health"><span className="pulse-dot" /><div><b>Data systems online</b><small>SEC · 6h cache</small></div></div>
          <div className="legal">Research workspace<br />Not investment advice</div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          {!sidebarOpen && <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar"><Menu size={18} /></button>}
          <div className="search-wrap">
            <Search size={17} />
            <input value={query} onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onKeyDown={(event) => event.key === "Enter" && suggestions[0] && selectTicker(suggestions[0].ticker)} placeholder="Search company or ticker…" aria-label="Search company or ticker" />
            <kbd><Command size={11} /> K</kbd>
            {searchOpen && <div className="search-results">
              <div className="search-caption">{query ? "MATCHING COMPANIES" : "POPULAR COMPANIES"}</div>
              {suggestions.map((company) => <button key={company.ticker} onClick={() => selectTicker(company.ticker)}>
                <span className="ticker-avatar">{company.ticker.slice(0, 1)}</span>
                <span><b>{company.name}</b><small>{company.ticker} · {company.exchange}</small></span>
                <span className="result-sector">{company.sector}</span>
              </button>)}
            </div>}
          </div>
          <div className="top-actions">
            <span className="verified"><ShieldCheck size={15} /> SEC verified</span>
            <button className="icon-button" onClick={() => setDark((value) => !value)} aria-label="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <button className="avatar" aria-label="User menu">LR</button>
          </div>
        </header>

        <main>
          <section className="company-header">
            <div className="company-id">
              <span className="company-logo">{dataset.company.ticker.slice(0, 1)}</span>
              <div><div className="eyebrow">{dataset.company.exchange} · {dataset.company.currency}</div><h1>{dataset.company.name} <span>{dataset.company.ticker}</span></h1><p>{dataset.company.sector} · Fiscal year ends {latest.periodEnd.slice(5)}</p></div>
            </div>
            <div className="company-actions">
              <button className={`icon-button ${favorite ? "favorite" : ""}`} onClick={() => setFavorite((value) => !value)} aria-label="Toggle favorite"><Heart size={17} fill={favorite ? "currentColor" : "none"} /></button>
              <button className="button secondary" onClick={() => exportCsv(Object.keys(METRICS), true)}><FileDown size={15} /> Export all</button>
              <button className="icon-button"><MoreHorizontal size={18} /></button>
            </div>
          </section>

          {error && <div className="error-banner"><Info size={16} /><span>{error}. Apple’s verified offline dataset remains displayed.</span><button onClick={() => setError("")}><X size={15} /></button></div>}
          {loading && <div className="loading-overlay"><Loader2 className="spin" size={24} /><span>Normalizing SEC filings…</span></div>}

          <div className="control-bar">
            <div className="segmented" aria-label="Periodicity">
              {(["annual", "quarterly", "ttm"] as const).map((item) => <button key={item} className={periodicity === item ? "active" : ""} onClick={() => setPeriodicity(item)}>{item.toUpperCase()}</button>)}
            </div>
            <div className="control-divider" />
            <label>History <select value={range} onChange={(event) => setRange(Number(event.target.value))}><option value={5}>5 years</option><option value={10}>10 years</option><option value={20}>Full history</option></select></label>
            <label>Units <select value={unit} onChange={(event) => setUnit(event.target.value as Unit)}><option value="unit">Units</option><option value="thousand">Thousands</option><option value="million">Millions</option><option value="billion">Billions</option></select></label>
            <label>View <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as DisplayMode)}><option value="absolute">Absolute</option><option value="perShare">Per share</option><option value="margins">Margins</option><option value="growth">Growth</option></select></label>
            <span className="as-of"><span className="pulse-dot" /> Through {latest.periodEnd}</span>
          </div>

          <div className="content">
            {view === "overview" && <Overview dataset={dataset} periods={periods} latest={latest} previous={previous} unit={unit} summary={summary} onView={setView} onFact={setSelectedFact} chartRef={chartRef} />}
            {(["income", "cashflow", "margins", "pershare", "shares"] as ViewKey[]).includes(view) && <StatementView view={view as keyof typeof VIEW_METRICS} periods={periods} unit={unit} displayMode={displayMode} currency={dataset.company.currency} onFact={setSelectedFact} onExport={(metrics) => exportCsv(metrics)} />}
            {view === "valuation" && <ValuationView latest={latest} currency={dataset.company.currency} />}
            {view === "sources" && <SourcesView dataset={dataset} />}
            {view === "settings" && <SettingsView dark={dark} setDark={setDark} />}
          </div>
        </main>
      </div>

      {selectedFact && <FactDrawer fact={selectedFact} onClose={() => setSelectedFact(null)} />}
      {copied && <div className="toast"><Check size={15} /> Table copied</div>}
    </div>
  );
}

function MetricCard({ label, value, current, previous, currency, accent }: { label: string; value: number | null; current: number | null; previous: number | null; currency: string; accent: string }) {
  const delta = growth(current, previous);
  return <article className="metric-card" style={{ "--accent": accent } as React.CSSProperties}>
    <div className="metric-top"><span>{label}</span><Info size={14} /></div>
    <strong>{compactCurrency(value, currency)}</strong>
    <div className={`metric-delta ${delta != null && delta < 0 ? "negative" : "positive"}`}>{delta == null ? "—" : delta >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {delta == null ? "No comparable" : `${Math.abs(delta * 100).toFixed(1)}% YoY`}<span>FY {new Date().getFullYear() - 1}</span></div>
  </article>;
}

function Overview({ dataset, periods, latest, previous, unit, summary, onView, onFact, chartRef }: {
  dataset: CompanyDataset; periods: FinancialPeriod[]; latest: FinancialPeriod; previous?: FinancialPeriod; unit: Unit;
  summary: Record<string, number | null>; onView: (view: ViewKey) => void; onFact: (fact: NormalizedFact) => void; chartRef: React.RefObject<HTMLDivElement | null>;
}) {
  const chartData = periods.map((period) => ({ year: String(period.fiscalYear), revenue: (valueOf(period, "revenue") ?? 0) / 1e9, netIncome: (valueOf(period, "netIncome") ?? 0) / 1e9, fcf: (freeCashFlow(valueOf(period, "operatingCashFlow"), valueOf(period, "capitalExpenditures")) ?? 0) / 1e9, netMargin: (derivedValue(period, "netMargin") ?? 0) * 100 }));
  const revenueCagr = periods.length > 1 ? cagr(valueOf(periods[0], "revenue"), valueOf(latest, "revenue"), latest.fiscalYear - periods[0].fiscalYear) : null;
  const shareDelta = previous ? dilutionRate(valueOf(latest, "dilutedShares"), valueOf(previous, "dilutedShares")) : null;
  return <>
    <section className="metrics-grid">
      <MetricCard label="Revenue" value={summary.revenue} current={summary.revenue} previous={previous ? valueOf(previous, "revenue") : null} currency={dataset.company.currency} accent="#53d39c" />
      <MetricCard label="Net income" value={summary.netIncome} current={summary.netIncome} previous={previous ? valueOf(previous, "netIncome") : null} currency={dataset.company.currency} accent="#f4bc56" />
      <MetricCard label="Free cash flow" value={summary.fcf} current={summary.fcf} previous={previous ? freeCashFlow(valueOf(previous, "operatingCashFlow"), valueOf(previous, "capitalExpenditures")) : null} currency={dataset.company.currency} accent="#67b7ff" />
      <MetricCard label="Gross buybacks" value={summary.buybacks} current={summary.buybacks} previous={previous ? valueOf(previous, "shareRepurchases") : null} currency={dataset.company.currency} accent="#a78bfa" />
    </section>

    <section className="dashboard-grid">
      <article className="panel chart-panel">
        <div className="panel-head"><div><span className="panel-kicker">PERFORMANCE</span><h2>Revenue & profitability</h2></div><div className="chart-legend"><span><i style={{ background: "#53d39c" }} />Revenue</span><span><i style={{ background: "#f4bc56" }} />Net income</span><span><i style={{ background: "#a78bfa" }} />Net margin</span></div></div>
        <div className="chart" ref={chartRef}>
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
            <YAxis yAxisId="left" tickFormatter={(value) => `$${value}B`} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
            <Tooltip content={<ChartTooltip />} />
            <Bar yAxisId="left" dataKey="revenue" fill="#53d39c" radius={[4, 4, 0, 0]} opacity={0.82} />
            <Bar yAxisId="left" dataKey="netIncome" fill="#f4bc56" radius={[4, 4, 0, 0]} opacity={0.9} />
            <Line yAxisId="right" type="monotone" dataKey="netMargin" stroke="#a78bfa" strokeWidth={2} dot={false} />
          </ComposedChart></ResponsiveContainer>
        </div>
        <div className="panel-foot"><span><Info size={13} /> USD billions · SEC reported facts · margin on secondary axis</span><button onClick={() => onView("income")}>Open statement <ExternalLink size={13} /></button></div>
      </article>

      <article className="panel insight-panel">
        <div className="panel-head"><div><span className="panel-kicker">SIGNALS</span><h2>Research notes</h2></div><Sparkles size={18} /></div>
        <div className="insight-list">
          <div><span className="signal-icon positive"><TrendingUp size={16} /></span><p><b>Durable top-line compounding</b><small>{revenueCagr == null ? "Insufficient history" : `${(revenueCagr * 100).toFixed(1)}% revenue CAGR across the visible period.`}</small></p></div>
          <div><span className="signal-icon neutral"><Gauge size={16} /></span><p><b>Net margin at {((derivedValue(latest, "netMargin") ?? 0) * 100).toFixed(1)}%</b><small>Formula: Net income / Revenue.</small></p></div>
          <div><span className={`signal-icon ${shareDelta != null && shareDelta < 0 ? "positive" : "warning"}`}><Users size={16} /></span><p><b>{shareDelta != null && shareDelta < 0 ? "Share count contracted" : "Share count increased"}</b><small>{shareDelta == null ? "No comparable share fact." : `${Math.abs(shareDelta * 100).toFixed(1)}% effective change YoY; separate from buyback cash flow.`}</small></p></div>
        </div>
        <button className="text-button" onClick={() => onView("shares")}>Review capital allocation <ExternalLink size={13} /></button>
      </article>
    </section>

    <section className="panel snapshot-panel">
      <div className="panel-head"><div><span className="panel-kicker">FINANCIAL SNAPSHOT</span><h2>Latest five fiscal years</h2></div><button className="button ghost" onClick={() => onView("income")}>View full history</button></div>
      <FinancialTable periods={periods.slice(-5)} metrics={["revenue", "grossProfit", "operatingIncome", "netIncome", "operatingCashFlow", "freeCashFlow"]} unit={unit} currency={dataset.company.currency} onFact={onFact} />
    </section>
  </>;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  return <div className="chart-tooltip"><b>FY {label}</b>{payload.map((item) => <span key={item.name}><i style={{ background: item.color }} />{METRICS[item.name]?.label ?? item.name}<strong>{item.name.includes("Margin") ? `${item.value.toFixed(1)}%` : `$${item.value.toFixed(1)}B`}</strong></span>)}</div>;
}

function StatementView({ view, periods, unit, displayMode, currency, onFact, onExport }: { view: keyof typeof VIEW_METRICS; periods: FinancialPeriod[]; unit: Unit; displayMode: DisplayMode; currency: string; onFact: (fact: NormalizedFact) => void; onExport: (metrics: string[]) => void }) {
  let metrics = VIEW_METRICS[view];
  if (displayMode === "perShare" && view !== "shares") metrics = VIEW_METRICS.pershare;
  if (displayMode === "margins") metrics = VIEW_METRICS.margins;
  const title = NAV.find((item) => item.key === view)?.label ?? "Financial statement";
  const chartData = periods.map((period) => ({ year: String(period.fiscalYear), ...Object.fromEntries(metrics.slice(0, 3).map((metric) => [metric, METRICS[metric].kind === "percent" ? (derivedValue(period, metric) ?? 0) * 100 : (derivedValue(period, metric) ?? 0) / (METRICS[metric].kind === "perShare" ? 1 : 1e9)])) }));
  return <>
    <section className="view-title"><div><span className="panel-kicker">{view === "shares" ? "CAPITAL ALLOCATION" : "FINANCIAL ANALYSIS"}</span><h2>{title}</h2><p>Reported facts and explicit calculations across {periods.length} comparable fiscal periods.</p></div><div><button className="button secondary" onClick={() => onExport(metrics)}><Download size={15} /> Export visible CSV</button></div></section>
    {view === "shares" && <DilutionStrip periods={periods} />}
    <section className="panel statement-chart">
      <div className="panel-head"><div><span className="panel-kicker">TREND</span><h2>{metrics.slice(0, 3).map((metric) => METRICS[metric].short).join(" · ")}</h2></div><span className="verified"><LineChartIcon size={14} /> Linear scale</span></div>
      <div className="chart small"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 10, right: 10, left: -4, bottom: 0 }}>
        <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#53d39c" stopOpacity={0.35} /><stop offset="1" stopColor="#53d39c" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} /><XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip content={<ChartTooltip />} />
        {metrics.slice(0, 3).map((metric, index) => index === 0 ? <Area key={metric} type="monotone" dataKey={metric} stroke={METRICS[metric].color} fill="url(#trendFill)" strokeWidth={2} /> : <Line key={metric} type="monotone" dataKey={metric} stroke={METRICS[metric].color} strokeWidth={2} dot={false} />)}
      </AreaChart></ResponsiveContainer></div>
    </section>
    <section className="panel table-panel">
      <div className="panel-head"><div><span className="panel-kicker">AUDITABLE TABLE</span><h2>{title} history</h2></div><div className="status-legend"><span><i className="reported" />Reported</span><span><i className="calculated" />Calculated</span><span><i className="missing" />Unavailable</span></div></div>
      <FinancialTable periods={periods} metrics={metrics} unit={unit} currency={currency} onFact={onFact} growthMode={displayMode === "growth"} />
    </section>
  </>;
}

function DilutionStrip({ periods }: { periods: FinancialPeriod[] }) {
  const latest = periods.at(-1);
  const values = [1, 3, 5, 10, 20].map((years) => {
    const start = periods.find((period) => period.fiscalYear === (latest?.fiscalYear ?? 0) - years);
    return { years, value: latest && start ? dilutionRate(valueOf(latest, "dilutedShares"), valueOf(start, "dilutedShares")) : null };
  });
  return <section className="dilution-strip">{values.map((item) => <div key={item.years}><span>{item.years}Y DILUTION</span><strong className={item.value != null && item.value < 0 ? "positive-text" : "negative-text"}>{item.value == null ? "—" : `${(item.value * 100).toFixed(1)}%`}</strong><small>{item.value == null ? "Insufficient data" : item.value < 0 ? "net share reduction" : "net dilution"}</small></div>)}</section>;
}

function FinancialTable({ periods, metrics, unit, currency, onFact, growthMode = false }: { periods: FinancialPeriod[]; metrics: string[]; unit: Unit; currency: string; onFact: (fact: NormalizedFact) => void; growthMode?: boolean }) {
  return <div className="table-scroll"><table className="financial-table"><thead><tr><th>Metric <small>{unit === "unit" ? currency : `${currency} · ${unit}`}</small></th>{periods.map((period) => <th key={period.periodEnd}>{period.fiscalYear}<small>{period.periodEnd.slice(5)}</small></th>)}</tr></thead>
    <tbody>{metrics.map((metric) => <tr key={metric}><th><span className="metric-name"><i style={{ background: METRICS[metric].color }} />{METRICS[metric].label}</span>{METRICS[metric].formula && <small>{METRICS[metric].formula}</small>}</th>{periods.map((period, index) => {
      const raw = period.facts[metric as MetricKey];
      let value = derivedValue(period, metric);
      if (growthMode) value = index ? growth(value, derivedValue(periods[index - 1], metric)) : null;
      const kind = growthMode ? "percent" : METRICS[metric].kind;
      return <td key={period.periodEnd} className={value == null ? "missing-cell" : ""}><button disabled={!raw} onClick={() => raw && onFact(raw)}>{formatValue(value, kind, unit, currency)}{raw ? <i className="reported-mark" /> : value != null ? <i className="calculated-mark" /> : null}</button></td>;
    })}</tr>)}</tbody>
  </table></div>;
}

function ValuationView({ latest, currency }: { latest: FinancialPeriod; currency: string }) {
  const cards = ["Market capitalization", "Price / Sales", "Price / Earnings", "Price / FCF", "FCF yield", "Buyback yield"];
  return <>
    <section className="view-title"><div><span className="panel-kicker">MARKET-DEPENDENT METRICS</span><h2>Valuation</h2><p>Fiscal-period fundamentals are paired only with a price from the same date.</p></div></section>
    <div className="notice"><Cloud size={18} /><div><b>Yahoo Finance price unavailable</b><p>No verified historical price was returned for {latest.periodEnd}. Valuation is intentionally not estimated with today’s price.</p></div><span>Source isolated</span></div>
    <section className="valuation-grid">{cards.map((card) => <article className="valuation-card" key={card}><span>{card}</span><strong>—</strong><small>Unavailable · no price fact</small></article>)}</section>
    <section className="panel methodology-card"><div><span className="panel-kicker">PRICE MATCHING RULE</span><h2>No temporal leakage</h2><p>Historical multiples require the closing price on, or nearest trading day before, the fiscal period end. The ticker, date, currency, price type and source travel with every calculated metric. A current quote is never combined with an old filing.</p></div><div className="formula-box"><code>Market cap = matched close × diluted shares</code><code>P/FCF = market cap / free cash flow</code><code>FCF yield = free cash flow / market cap</code></div></section>
  </>;
}

function SourcesView({ dataset }: { dataset: CompanyDataset }) {
  return <>
    <section className="view-title"><div><span className="panel-kicker">DATA LINEAGE</span><h2>Sources & methodology</h2><p>Definitions, selection rules and known caveats for every value in this workspace.</p></div></section>
    <section className="source-grid">
      <article className="panel source-card"><div className="source-icon sec">SEC</div><div><span className="panel-kicker">PRIMARY FUNDAMENTALS</span><h2>SEC EDGAR Company Facts</h2><p>Official XBRL facts from 10-K and 10-Q filings. Latest filing wins for a duplicate fiscal context, preserving restatements and accession references.</p><a href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces" target="_blank" rel="noreferrer">Open official documentation <ExternalLink size={13} /></a></div></article>
      <article className="panel source-card"><div className="source-icon yahoo">Y!</div><div><span className="panel-kicker">MARKET PRICES</span><h2>Yahoo Finance adapter</h2><p>Historical closes, currency and split events. The adapter is replaceable because the interface is unofficial and can be rate-limited.</p><a href="https://help.yahoo.com/kb/finance/download-historical-data-yahoo-finance-sln2311.html" target="_blank" rel="noreferrer">View Yahoo guidance <ExternalLink size={13} /></a></div></article>
    </section>
    <section className="panel formula-panel"><div className="panel-head"><div><span className="panel-kicker">CALCULATION DICTIONARY</span><h2>Explicit formulas</h2></div><span className="verified"><Check size={14} /> Centralized & tested</span></div><div className="formula-list">{Object.entries(FORMULAS).map(([key, formula]) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><code>{formula}</code></div>)}</div></section>
    <section className="panel limitations"><div className="panel-head"><div><span className="panel-kicker">KNOWN LIMITATIONS</span><h2>What the numbers do not hide</h2></div></div>{dataset.warnings.map((warning) => <p key={warning}><Info size={15} />{warning}</p>)}</section>
  </>;
}

function SettingsView({ dark, setDark }: { dark: boolean; setDark: (value: boolean) => void }) {
  return <><section className="view-title"><div><span className="panel-kicker">WORKSPACE</span><h2>Settings</h2><p>Display preferences are stored only on this device.</p></div></section><section className="panel settings-panel"><div><span><b>Appearance</b><small>Choose the default research workspace theme.</small></span><div className="theme-toggle"><button className={dark ? "active" : ""} onClick={() => setDark(true)}><Moon size={15} /> Dark</button><button className={!dark ? "active" : ""} onClick={() => setDark(false)}><Sun size={15} /> Light</button></div></div><div><span><b>Fiscal period labels</b><small>Show fiscal year and exact period-end date.</small></span><span className="toggle on"><i /></span></div><div><span><b>Calculated value badges</b><small>Distinguish formulas from reported facts.</small></span><span className="toggle on"><i /></span></div><div><span><b>Analytics</b><small>No tracking is enabled in this build.</small></span><span className="toggle"><i /></span></div></section></>;
}

function FactDrawer({ fact, onClose }: { fact: NormalizedFact; onClose: () => void }) {
  return <div className="drawer-backdrop" onClick={onClose}><aside className="fact-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="panel-kicker">VALUE PROVENANCE</span><h2>{METRICS[fact.metric]?.label ?? fact.metric}</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="fact-value"><strong>{fact.unit === "currency" ? compactCurrency(fact.value, fact.currency) : new Intl.NumberFormat("en-US", { notation: "compact" }).format(fact.value ?? 0)}</strong><span className="status-pill"><Check size={13} /> {fact.provenance.status}</span></div><dl><div><dt>Period end</dt><dd>{fact.periodEnd}</dd></div><div><dt>Fiscal year</dt><dd>{fact.fiscalYear}</dd></div><div><dt>Periodicity</dt><dd>{fact.periodicity}</dd></div><div><dt>Currency / unit</dt><dd>{fact.currency} · {fact.unit}</dd></div><div><dt>Provider</dt><dd>{fact.provenance.provider}</dd></div><div><dt>XBRL concept</dt><dd><code>{fact.provenance.concept}</code></dd></div><div><dt>Filed</dt><dd>{fact.provenance.filingDate ?? "—"}</dd></div><div><dt>Retrieved</dt><dd>{fact.provenance.retrievedAt.slice(0, 10)}</dd></div><div><dt>Accession</dt><dd><code>{fact.provenance.accession ?? "—"}</code></dd></div></dl><p className="fact-note">{fact.provenance.note}</p><a className="button primary" href={fact.provenance.sourceUrl} target="_blank" rel="noreferrer">Open SEC filing <ExternalLink size={14} /></a></aside></div>;
}
