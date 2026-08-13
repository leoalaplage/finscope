"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, BookOpen, Calculator, Check, CircleDollarSign, Command, Copy, ExternalLink,
  FileDown, Gauge, Heart, Home, Info, Loader2, Menu, Moon, MoreHorizontal,
  PanelLeftClose, Search, Settings, ShieldCheck, Sun, Table2, TrendingDown,
  TrendingUp, Users, X, Activity, Target, CalendarDays,
  GitCompareArrows, LineChart, Database, Plus,
} from "lucide-react";
import { AdvancedChart, type ChartMode, type Unit } from "./AdvancedChart";
import { CompanyManager } from "./CompanyManager";
import { CoverageMatrix } from "./CoverageMatrix";
import { DcfValuation } from "./DcfValuation";
import { MultiStockComparison } from "./MultiStockComparison";
import { ValuationAnalysis } from "./ValuationAnalysis";
import { DataQuality } from "./DataQuality";
import { COMPANIES, findCompany } from "@/lib/company-registry";
import {
  FORMULAS, cagrBetweenDates, cagrForPeriods, convertUnit, derivedValue,
  valueOf,
} from "@/lib/finance";
import { GROWTH_METRICS, METRICS, VIEW_METRICS } from "@/lib/metrics";
import type { CompanyDataset, FinancialPeriod, MetricKey, NormalizedFact, Periodicity } from "@/lib/types";

type ViewKey = "overview" | "income" | "cashflow" | "margins" | "pershare" | "shares" | "growth" | "valuation" | "dcf" | "comparison" | "coverage" | "quality" | "sources" | "settings";

const NAV: Array<{ key: ViewKey; label: string; icon: typeof Home; section?: string }> = [
  { key: "overview", label: "Quality overview", icon: Home, section: "QUALITY ANALYSIS" },
  { key: "growth", label: "Growth & CAGR", icon: TrendingUp },
  { key: "pershare", label: "Per share", icon: Calculator },
  { key: "margins", label: "Margins & conversion", icon: Gauge },
  { key: "income", label: "Income statement", icon: Table2, section: "FINANCIALS" },
  { key: "cashflow", label: "Cash flow", icon: Activity },
  { key: "shares", label: "Shares & buybacks", icon: Users, section: "CAPITAL" },
  { key: "valuation", label: "Valuation", icon: CircleDollarSign },
  { key: "dcf", label: "DCF Valuation", icon: LineChart },
  { key: "comparison", label: "Multi-Stock Comparison", icon: GitCompareArrows, section: "PORTFOLIO" },
  { key: "coverage", label: "Data coverage", icon: Database },
  { key: "quality", label: "Data Quality", icon: ShieldCheck },
  { key: "sources", label: "Sources & methodology", icon: BookOpen, section: "SYSTEM" },
  { key: "settings", label: "Settings", icon: Settings },
];

function compactCurrency(value: number | null, currency = "USD") {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
}
function formatValue(value: number | null, kind: string, unit: Unit, currency = "USD") {
  if (value == null || Number.isNaN(value)) return "—";
  if (kind === "percent") return `${(value * 100).toFixed(1)}%`;
  if (kind === "ratio") return `${value.toFixed(1)}×`;
  if (kind === "perShare") return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(convertUnit(value, unit) ?? 0);
}
function change(current: number | null, prior: number | null) { return current != null && prior ? current / prior - 1 : null; }
function metricValue(periods: FinancialPeriod[], index: number, metric: string) {
  if (metric === "shareCountChange") return index ? change(valueOf(periods[index], "dilutedShares"), valueOf(periods[index - 1], "dilutedShares")) : null;
  if (metric === "shareCountAbsoluteChange") {
    const current = valueOf(periods[index], "dilutedShares"); const prior = index ? valueOf(periods[index - 1], "dilutedShares") : null;
    return current != null && prior != null ? current - prior : null;
  }
  if (metric === "cumulativeDilution") return change(valueOf(periods[index], "dilutedShares"), valueOf(periods[0], "dilutedShares"));
  return derivedValue(periods[index], metric);
}
function periodName(period: FinancialPeriod) { return period.fiscalQuarter ? `${period.fiscalQuarter} FY${period.fiscalYear}` : `FY ${period.fiscalYear}`; }
function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export function FinanceApp({ initialData }: { initialData: CompanyDataset }) {
  const [dataset, setDataset] = useState(initialData);
  const [view, setView] = useState<ViewKey>("overview");
  const [periodicity, setPeriodicity] = useState<Periodicity>(() => typeof window === "undefined" ? "annual" : (localStorage.getItem("finscope.periodicity") as Periodicity) || "annual");
  const [unit, setUnit] = useState<Unit>(() => typeof window === "undefined" ? "billion" : (localStorage.getItem("finscope.unit") as Unit) || "billion");
  const [chartMode, setChartMode] = useState<ChartMode>(() => typeof window === "undefined" ? "absolute" : (localStorage.getItem("finscope.chartMode") as ChartMode) || "absolute");
  const [range, setRange] = useState(() => typeof window === "undefined" ? 999 : Number(localStorage.getItem("finscope.historyRange")) || 999);
  const [query, setQuery] = useState(""); const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [dark, setDark] = useState(true); const [sidebarOpen, setSidebarOpen] = useState(true);
  const [favorite, setFavorite] = useState(false); const [selectedFact, setSelectedFact] = useState<NormalizedFact | null>(null);
  const [toast, setToast] = useState("");
  const [managerOpen,setManagerOpen]=useState(false);

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => { localStorage.setItem("finscope.periodicity", periodicity); }, [periodicity]);
  useEffect(() => { localStorage.setItem("finscope.unit", unit); }, [unit]);
  useEffect(() => { localStorage.setItem("finscope.chartMode", chartMode); }, [chartMode]);
  useEffect(() => { localStorage.setItem("finscope.historyRange", String(range)); }, [range]);
  useEffect(() => {
    if (window.innerWidth <= 800) window.requestAnimationFrame(() => setSidebarOpen(false));
  }, []);
  const allPeriods = useMemo(() => dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)), [dataset, periodicity]);
  const periods = allPeriods.slice(-(range >= 999 ? allPeriods.length : range));
  const latest = periods.at(-1) ?? dataset.periods.filter((period) => period.periodicity === "annual").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1)!;
  const suggestions = query ? findCompany(query).slice(0, 6) : COMPANIES.slice(0, 6);
  const rangeOptions = periodicity === "annual" ? [5, 10, 20, 999] : [8, 12, 20, 40, 999];

  async function selectTicker(ticker: string) {
    setSearchOpen(false); setQuery(""); if (ticker === dataset.company.ticker) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/company/${ticker}?refresh=${Date.now()}`, { cache: "no-store" }); const payload = await response.json() as CompanyDataset & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Data unavailable");
      setDataset(payload); history.replaceState(null, "", `/?ticker=${ticker}&view=${view}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Data unavailable"); }
    finally { setLoading(false); }
  }

  function exportCsv(metrics: string[], all = false) {
    const selected = all ? dataset.periods : periods;
    const rows = [["company","ticker","metric","period_start","period_end","fiscal_quarter","periodicity","value","currency","unit","provider","status","concept_or_formula","source_url"]];
    for (const period of selected) for (const metric of metrics) {
      const definition = METRICS[metric]; if (!definition) continue; const raw = period.facts[metric as MetricKey]; const value = derivedValue(period, metric);
      rows.push([dataset.company.name,dataset.company.ticker,definition.label,period.periodStart ?? "",period.periodEnd,period.fiscalQuarter ?? "",period.periodicity,value == null ? "" : String(value),period.currency,definition.kind,raw?.provenance.provider ?? "Calculated",raw?.provenance.status ?? "calculated",raw?.provenance.formula ?? raw?.provenance.concept ?? definition.formula ?? "",raw?.provenance.sourceUrl ?? ""]);
    }
    downloadText(`${dataset.company.ticker}-${all ? "complete" : view}-${periodicity}.csv`, rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"','""')}"`).join(",")).join("\n"), "text/csv;charset=utf-8");
  }

  function navigate(next: ViewKey) { setView(next); history.replaceState(null, "", `/?ticker=${dataset.company.ticker}&view=${next}`); }
  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2200); }

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
      <div className="brand-row"><button className="brand" onClick={() => navigate("overview")} aria-label="FinScope home"><span className="brand-mark"><BarChart3 size={18}/></span><span>finscope</span></button><button className="icon-button collapse-button" onClick={() => setSidebarOpen(false)} aria-label="Collapse sidebar"><PanelLeftClose size={17}/></button></div>
      <nav aria-label="Main navigation">{NAV.map((item) => <div key={item.key}>{item.section && <div className="nav-section">{item.section}</div>}<button className={`nav-item ${view === item.key ? "active" : ""}`} onClick={() => navigate(item.key)}><item.icon size={17}/><span>{item.label}</span>{item.key === "sources" && <span className="nav-dot"/>}</button></div>)}</nav>
      <div className="sidebar-bottom"><div className="source-health"><span className="pulse-dot"/><div><b>Primary data online</b><small>SEC · Yahoo · cached</small></div></div><div className="legal">Quality-stock research<br/>Not investment advice</div></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        {!sidebarOpen && <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar"><Menu size={18}/></button>}
        <div className="search-wrap"><Search size={17}/><input value={query} onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onKeyDown={(event) => event.key === "Enter" && suggestions[0] && selectTicker(suggestions[0].ticker)} placeholder="Search quality company or ticker…" aria-label="Search company or ticker"/><kbd><Command size={11}/> K</kbd>
          {searchOpen && <div className="search-results"><div className="search-caption">{query ? "MATCHING COMPANIES" : "VALIDATION UNIVERSE"}</div>{suggestions.map((company) => <button key={company.ticker} onMouseDown={() => selectTicker(company.ticker)}><span className="ticker-avatar">{company.ticker[0]}</span><span><b>{company.name}</b><small>{company.ticker} · {company.exchange}</small></span><span className="result-sector">{company.sector}</span></button>)}</div>}
        </div>
        <div className="top-actions"><button className="button secondary top-add-company" onClick={()=>setManagerOpen(true)}><Plus size={14}/> Add company</button><span className="verified"><ShieldCheck size={15}/> Traceable</span><button className="icon-button" onClick={() => setDark((value) => !value)} aria-label="Toggle theme">{dark ? <Sun size={17}/> : <Moon size={17}/>}</button><button className="avatar" aria-label="User menu">LR</button></div>
      </header>
      <main>
        <section className="company-header"><div className="company-id"><span className="company-logo">{dataset.company.ticker[0]}</span><div><div className="eyebrow">QUALITY STOCK RESEARCH · {dataset.company.exchange} · {dataset.company.currency}</div><h1>{dataset.company.name} <span>{dataset.company.ticker}</span></h1><p>{dataset.company.description}</p></div></div><div className="company-actions"><button className={`icon-button ${favorite ? "favorite" : ""}`} onClick={() => setFavorite((value) => !value)} aria-label="Toggle favorite"><Heart size={17} fill={favorite ? "currentColor" : "none"}/></button><button className="button secondary" onClick={() => exportCsv(Object.keys(METRICS), true)}><FileDown size={15}/> Export all</button><button className="icon-button"><MoreHorizontal size={18}/></button></div></section>
        {error && <div className="error-banner"><Info size={16}/><span>{error}. The last verified dataset remains displayed.</span><button onClick={() => setError("")}><X size={15}/></button></div>}
        {loading && <div className="loading-overlay"><Loader2 className="spin" size={24}/><span>Resolving SEC periods and TTM windows…</span></div>}
        <div className="control-bar"><div className="segmented" aria-label="Periodicity">{(["annual","quarterly","ttm"] as const).map((item) => <button key={item} className={periodicity === item ? "active" : ""} onClick={() => { setPeriodicity(item); setRange(999); }}>{item.toUpperCase()}</button>)}</div><div className="control-divider"/>
          <label>History <select value={range} onChange={(event) => setRange(Number(event.target.value))}>{rangeOptions.map((value) => <option value={value} key={value}>{value === 999 ? "Max" : `${value} periods`}</option>)}</select></label>
          <label>Units <select value={unit} onChange={(event) => setUnit(event.target.value as Unit)}><option value="unit">Units</option><option value="thousand">Thousands</option><option value="million">Millions</option><option value="billion">Billions</option></select></label>
          <label>Chart view <select value={chartMode} onChange={(event) => setChartMode(event.target.value as ChartMode)}><option value="absolute">Absolute</option><option value="perShare">Per share</option><option value="margins">Margins</option><option value="growth">Growth</option><option value="cagr">CAGR</option></select></label>
          <span className="as-of"><span className="pulse-dot"/> {periods.length ? `${periods.length} reliable periods · through ${periods.at(-1)!.periodEnd}` : `No reliable ${periodicity} periods`}</span>
        </div>
        <div className="content">
          {!periods.length && <div className="notice"><Info size={18}/><div><b>{periodicity.toUpperCase()} unavailable</b><p>{dataset.warnings.find((warning) => warning.includes("TTM")) ?? "The SEC dataset does not contain enough compatible standardized facts for this view."}</p></div></div>}
          {periods.length > 0 && view === "overview" && <Overview key={`overview-${chartMode}`} dataset={dataset} periods={periods} unit={unit} mode={chartMode} onView={navigate}/>}
          {periods.length > 0 && (["income","cashflow","margins","pershare","shares"] as ViewKey[]).includes(view) && <StatementView view={view as keyof typeof VIEW_METRICS} periods={periods} unit={unit} mode={chartMode} currency={dataset.company.currency} periodicity={periodicity} ticker={dataset.company.ticker} company={dataset.company.name} onFact={setSelectedFact} onExport={(metrics) => exportCsv(metrics)} onCopy={() => notify("Visible table copied")}/>}
          {view === "growth" && <GrowthView annualPeriods={dataset.periods.filter((period) => period.periodicity === "annual").sort((a,b) => a.periodEnd.localeCompare(b.periodEnd))}/>}
          {view === "valuation" && <ValuationAnalysis key={`${dataset.company.ticker}-${latest.periodEnd}`} dataset={dataset}/>}
          {view === "dcf" && <DcfValuation key={dataset.company.ticker} dataset={dataset}/>}
          {view === "comparison" && <MultiStockComparison initialData={dataset}/>}
          {view === "coverage" && <CoverageMatrix initialData={dataset}/>}
          {view === "quality" && <DataQuality dataset={dataset} onRefresh={setDataset}/>}
          {view === "sources" && <SourcesView dataset={dataset}/>}
          {view === "settings" && <SettingsView dark={dark} setDark={setDark}/>}
        </div>
      </main>
    </div>
    {selectedFact && <FactDrawer fact={selectedFact} onClose={() => setSelectedFact(null)}/>}
    {managerOpen&&<CompanyManager onClose={()=>setManagerOpen(false)} onSelect={(next)=>{setDataset(next);setManagerOpen(false);}}/>}
    {toast && <div className="toast"><Check size={15}/>{toast}</div>}
  </div>;
}

function MetricCard({ label, value, delta, currency, accent, detail, kind = "currency" }: { label: string; value: number | null; delta?: number | null; currency: string; accent: string; detail: string; kind?: "currency" | "shares" }) {
  const display = kind === "shares" && value != null ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value) : compactCurrency(value, currency);
  return <article className="metric-card" style={{ "--accent": accent } as React.CSSProperties}><div className="metric-top"><span>{label}</span><Info size={14}/></div><strong>{display}</strong><div className={`metric-delta ${delta != null && delta < 0 ? "negative" : "positive"}`}>{delta == null ? <Info size={13}/> : delta >= 0 ? <TrendingUp size={13}/> : <TrendingDown size={13}/>} {delta == null ? "No comparable" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`}<span>{detail}</span></div></article>;
}

function Overview({ dataset, periods, unit, mode, onView }: { dataset: CompanyDataset; periods: FinancialPeriod[]; unit: Unit; mode: ChartMode; onView: (view: ViewKey) => void }) {
  const latest = periods.at(-1)!; const prior = periods.at(-2);
  const fcf = derivedValue(latest, "freeCashFlow"); const fcfPerShare = derivedValue(latest, "freeCashFlowPerShare");
  const priorFcfPerShare = prior ? derivedValue(prior, "freeCashFlowPerShare") : null;
  const effectiveModeMetrics = mode === "perShare" ? ["freeCashFlowPerShare","revenuePerShare","netIncomePerShare","dilutedShares"] : mode === "margins" ? ["freeCashFlowMargin","grossMargin","operatingMargin","netMargin"] : ["freeCashFlow","freeCashFlowPerShare","dilutedShares","freeCashFlowMargin"];
  return <>
    <section className="quality-hero"><div><span className="panel-kicker">QUALITY OVERVIEW</span><h2>Per-share compounding, cash quality and dilution discipline</h2><p>Totals are useful. Per-share outcomes reveal whether shareholders actually benefited.</p></div><button className="button secondary" onClick={() => onView("growth")}>Open CAGR matrix <ExternalLink size={14}/></button></section>
    <section className="metrics-grid"><MetricCard label="Free cash flow / share" value={fcfPerShare} delta={change(fcfPerShare, priorFcfPerShare)} currency={dataset.company.currency} accent="#c8f169" detail={periodName(latest)}/><MetricCard label="Free cash flow" value={fcf} delta={change(fcf, prior ? derivedValue(prior,"freeCashFlow") : null)} currency={dataset.company.currency} accent="#53d39c" detail={periodName(latest)}/><MetricCard label="Revenue / share" value={derivedValue(latest,"revenuePerShare")} delta={change(derivedValue(latest,"revenuePerShare"), prior ? derivedValue(prior,"revenuePerShare") : null)} currency={dataset.company.currency} accent="#67b7ff" detail={periodName(latest)}/><MetricCard label="Diluted shares" value={valueOf(latest,"dilutedShares")} delta={change(valueOf(latest,"dilutedShares"), prior ? valueOf(prior,"dilutedShares") : null)} currency="USD" accent="#a78bfa" detail="lower is better" kind="shares"/></section>
    <QualityOverview periods={dataset.periods.filter((period) => period.periodicity === "annual").sort((a,b) => a.periodEnd.localeCompare(b.periodEnd))}/>
    <AdvancedChart periods={periods} metrics={effectiveModeMetrics} unit={unit} currency={dataset.company.currency} mode={mode} title="FCF compounding & shareholder impact" ticker={dataset.company.ticker} company={dataset.company.name}/>
  </>;
}

function QualityOverview({ periods }: { periods: FinancialPeriod[] }) {
  const latest = periods.at(-1); if (!latest) return null;
  const margins = periods.map((period) => derivedValue(period,"freeCashFlowMargin")).filter((value): value is number => value != null);
  const recent = (count: number) => periods.slice(-count).map((period) => derivedValue(period,"freeCashFlowMargin")).filter((value): value is number => value != null);
  const average = (values: number[]) => values.length ? values.reduce((sum,value) => sum + value,0) / values.length : null;
  const mean = average(margins); const deviation = mean == null ? null : Math.sqrt(margins.reduce((sum,value) => sum + Math.pow(value-mean,2),0) / margins.length);
  const stability = mean && deviation != null ? Math.max(0, 1 - deviation / Math.abs(mean)) : null;
  const positiveFcf = periods.filter((period) => (derivedValue(period,"freeCashFlow") ?? -1) > 0).length;
  const fcfGrowthYears = periods.slice(1).filter((period,index) => (derivedValue(period,"freeCashFlowPerShare") ?? -Infinity) > (derivedValue(periods[index],"freeCashFlowPerShare") ?? Infinity)).length;
  const conversionValues = periods.map((period) => derivedValue(period,"cashConversion")).filter((value): value is number => value != null);
  const shareCagr = cagrForPeriods(periods,"dilutedShares","max");
  const cards = [
    ["Current FCF margin", derivedValue(latest,"freeCashFlowMargin"), "FCF / Revenue"],
    ["5Y average FCF margin", average(recent(5)), "Arithmetic mean of available annual margins"],
    ["10Y average FCF margin", average(recent(10)), "Arithmetic mean of available annual margins"],
    ["Margin stability", stability, "1 − standard deviation / |average margin|"],
    ["Cash conversion", average(conversionValues.slice(-5)), "5Y average of FCF / Net income"],
    ["Diluted share CAGR", shareCagr.value, shareCagr.reason ?? `${shareCagr.years.toFixed(1)} actual years`],
  ] as const;
  return <section className="panel quality-panel"><div className="panel-head"><div><span className="panel-kicker">TRANSPARENT QUALITY INDICATORS</span><h2>Evidence, not an opaque score</h2></div><span className="verified"><Target size={14}/>{positiveFcf}/{periods.length} positive-FCF years</span></div><div className="quality-grid">{cards.map(([label,value,formula]) => <div key={label} title={formula}><span>{label}</span><strong>{value == null ? "N/M" : `${(value*100).toFixed(1)}%`}</strong><small>{formula}</small></div>)}</div><div className="quality-foot"><span><Check size={14}/>{fcfGrowthYears} of {Math.max(periods.length-1,0)} years grew FCF per share</span><span>FCF margin range {margins.length ? `${(Math.min(...margins)*100).toFixed(1)}%–${(Math.max(...margins)*100).toFixed(1)}%` : "N/M"}</span></div></section>;
}

function metricsForMode(view: keyof typeof VIEW_METRICS, mode: ChartMode) {
  if (mode === "perShare" && view !== "shares") return [...VIEW_METRICS.pershare];
  if (mode === "margins") return [...VIEW_METRICS.margins];
  return [...VIEW_METRICS[view]];
}

function StatementView({ view, periods, unit, mode, currency, periodicity, ticker, company, onFact, onExport, onCopy }: { view: keyof typeof VIEW_METRICS; periods: FinancialPeriod[]; unit: Unit; mode: ChartMode; currency: string; periodicity: Periodicity; ticker: string; company: string; onFact: (fact: NormalizedFact) => void; onExport: (metrics: string[]) => void; onCopy: () => void }) {
  const metrics = metricsForMode(view, mode); const title = NAV.find((item) => item.key === view)?.label ?? view;
  async function copyTable() { const header = ["Metric",...periods.map(periodName)].join("\t"); const rows = metrics.map((metric) => [METRICS[metric].label,...periods.map((_,index) => metricValue(periods,index,metric) ?? "")].join("\t")); await navigator.clipboard.writeText([header,...rows].join("\n")); onCopy(); }
  const chartMetrics = view === "shares" ? ["dilutedShares","sharesOutstanding","shareRepurchases","stockBasedCompensation","shareIssuance"] : metrics.slice(0,5);
  return <><section className="view-title"><div><span className="panel-kicker">{view === "shares" ? "CAPITAL ALLOCATION" : "AUDITABLE FINANCIALS"}</span><h2>{title}</h2><p>{periods.length} {periodicity} periods · reported, restated and calculated values remain distinguishable.</p></div><div className="view-actions"><button className="button secondary" onClick={copyTable}><Copy size={14}/> Copy</button><button className="button secondary" onClick={() => onExport(metrics)}><FileDown size={14}/> Export CSV</button></div></section>{view === "shares" && <DilutionStrip periods={periods}/>}<AdvancedChart key={`${view}-${mode}`} periods={periods} metrics={chartMetrics} unit={unit} currency={currency} mode={mode} title={`${title} trends`} ticker={ticker} company={company}/><section className="panel table-panel"><div className="panel-head"><div><span className="panel-kicker">FINANCIAL TABLE</span><h2>{title} history</h2></div><div className="status-legend"><span><i className="reported"/>Reported</span><span><i className="calculated"/>Calculated</span><span><i className="missing"/>Unavailable</span></div></div><FinancialTable periods={periods} metrics={metrics} unit={unit} currency={currency} onFact={onFact} mode={mode} showCagr={periodicity === "annual"}/></section></>;
}

function DilutionStrip({ periods }: { periods: FinancialPeriod[] }) {
  const latest = periods.at(-1); const horizons = [1,3,5,10,20].map((count) => { const start = periods.at(-(count+1)); return { count, value: latest && start ? change(valueOf(latest,"dilutedShares"),valueOf(start,"dilutedShares")) : null }; });
  return <section className="dilution-strip">{horizons.map((item) => <div key={item.count}><span>{item.count}{periods[0]?.periodicity === "quarterly" ? "Q" : "Y"} SHARE CHANGE</span><strong className={item.value != null && item.value < 0 ? "positive-text" : "negative-text"}>{item.value == null ? "N/M" : `${(item.value*100).toFixed(1)}%`}</strong><small>{item.value == null ? "Insufficient data" : item.value < 0 ? "effective reduction" : "effective dilution"}</small></div>)}</section>;
}

function FinancialTable({ periods, metrics, unit, currency, onFact, mode, showCagr }: { periods: FinancialPeriod[]; metrics: string[]; unit: Unit; currency: string; onFact: (fact: NormalizedFact) => void; mode: ChartMode; showCagr: boolean }) {
  const horizons = [3,5,10,15,20,"max"] as const;
  return <div className="table-scroll"><table className="financial-table"><thead><tr><th>Metric<small>{unit === "unit" ? currency : `${currency} · ${unit}`}</small></th>{periods.map((period) => <th key={period.periodEnd}>{periodName(period)}<small>{period.periodEnd}</small></th>)}{showCagr && horizons.map((horizon) => <th className="cagr-column" key={horizon}>{horizon === "max" ? "Max" : `${horizon}Y`}<small>CAGR</small></th>)}</tr></thead><tbody>{metrics.map((metric) => <tr key={metric}><th><span className="metric-name"><i style={{background:METRICS[metric].color}}/>{METRICS[metric].label}</span>{METRICS[metric].formula && <small>{METRICS[metric].formula}</small>}</th>{periods.map((period,index) => { const raw = period.facts[metric as MetricKey]; let value = metricValue(periods,index,metric); if (mode === "growth") value = index ? change(metricValue(periods,index,metric),metricValue(periods,index-1,metric)) : null; if (mode === "cagr") value = index ? cagrBetweenDates(metricValue(periods,0,metric),value,periods[0].periodEnd,period.periodEnd).value : null; const kind = mode === "growth" || mode === "cagr" ? "percent" : METRICS[metric].kind; return <td key={period.periodEnd} className={value == null ? "missing-cell" : ""}><button disabled={!raw} onClick={() => raw && onFact(raw)} title={raw?.provenance.formula ?? raw?.provenance.concept}>{formatValue(value,kind,unit,currency)}{raw ? <i className={raw.provenance.status === "calculated" ? "calculated-mark" : "reported-mark"}/> : value != null ? <i className="calculated-mark"/> : null}</button></td>;})}{showCagr && horizons.map((horizon) => { const result = cagrForPeriods(periods,metric,horizon); return <td className="cagr-column" key={horizon} title={result.reason ?? `${result.startDate} → ${result.endDate} · ${result.years.toFixed(2)} years`}>{result.value == null ? "N/M" : `${(result.value*100).toFixed(1)}%`}</td>;})}</tr>)}</tbody></table></div>;
}

function GrowthView({ annualPeriods }: { annualPeriods: FinancialPeriod[] }) {
  const [selectedMetric,setSelectedMetric] = useState("freeCashFlowPerShare"); const horizons = [3,5,10,15,20,"max"] as const;
  const [customStart,setCustomStart] = useState(0); const [customEnd,setCustomEnd] = useState(Math.max(annualPeriods.length-1,0));
  const safeStart = Math.min(customStart, Math.max(annualPeriods.length-1,0)); const safeEnd = Math.min(customEnd, Math.max(annualPeriods.length-1,0));
  const start = annualPeriods[safeStart]; const end = annualPeriods[safeEnd]; const custom = start && end ? cagrBetweenDates(derivedValue(start,selectedMetric),derivedValue(end,selectedMetric),start.periodEnd,end.periodEnd) : null;
  return <><section className="view-title"><div><span className="panel-kicker">LONG-TERM COMPOUNDING</span><h2>Growth & CAGR</h2><p>Actual period-end dates determine every duration. N/M values explain why compounding is not meaningful.</p></div><label className="metric-select">Comparison metric <select value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)}>{GROWTH_METRICS.map((metric) => <option value={metric} key={metric}>{METRICS[metric].label}</option>)}</select></label></section><section className="custom-cagr panel"><div><span className="panel-kicker">CUSTOM CAGR</span><strong>{custom?.value == null ? "N/M" : `${(custom.value*100).toFixed(2)}%`}</strong><small>{custom?.reason ?? `${custom?.startDate} → ${custom?.endDate} · ${custom?.years.toFixed(2)} actual years`}</small></div><label>Start<select value={customStart} onChange={(event)=>setCustomStart(Number(event.target.value))}>{annualPeriods.map((period,index)=><option value={index} key={period.periodEnd}>{periodName(period)} · {period.periodEnd}</option>)}</select></label><label>End<select value={customEnd} onChange={(event)=>setCustomEnd(Number(event.target.value))}>{annualPeriods.map((period,index)=><option value={index} key={period.periodEnd}>{periodName(period)} · {period.periodEnd}</option>)}</select></label></section><section className="panel cagr-table-panel"><div className="table-scroll"><table className="financial-table cagr-matrix"><thead><tr><th>Metric</th>{horizons.map((horizon) => <th key={horizon}>{horizon === "max" ? "Max" : `${horizon}Y`}<small>Actual dates</small></th>)}<th>Latest source</th></tr></thead><tbody>{GROWTH_METRICS.map((metric) => <tr key={metric}><th><span className="metric-name"><i style={{background:METRICS[metric].color}}/>{METRICS[metric].label}</span></th>{horizons.map((horizon) => { const result = cagrForPeriods(annualPeriods,metric,horizon); return <td key={horizon} className={result.value == null ? "missing-cell" : ""} title={result.reason ?? `${result.startValue?.toLocaleString()} → ${result.endValue?.toLocaleString()} | ${result.startDate} → ${result.endDate} | ${result.years.toFixed(2)} years`}>{result.value == null ? "N/M" : `${(result.value*100).toFixed(1)}%`}<small>{result.years ? `${result.years.toFixed(1)}y` : result.reason}</small></td>;})}<td>{annualPeriods.at(-1)?.facts[metric as MetricKey]?.provenance.sourceUrl ? <a href={annualPeriods.at(-1)!.facts[metric as MetricKey]!.provenance.sourceUrl} target="_blank" rel="noreferrer">SEC <ExternalLink size={11}/></a> : "Calculated"}</td></tr>)}</tbody></table></div></section><CagrComparison metric={selectedMetric} periods={annualPeriods}/></>;
}

function CagrComparison({ metric, periods }: { metric: string; periods: FinancialPeriod[] }) {
  const horizons = [3,5,10,15,20,"max"] as const; const results = horizons.map((horizon) => ({horizon,result:cagrForPeriods(periods,metric,horizon)}));
  return <section className="panel cagr-bars"><div className="panel-head"><div><span className="panel-kicker">CAGR COMPARISON</span><h2>{METRICS[metric].label}</h2></div><span className="verified"><CalendarDays size={14}/> Actual elapsed years</span></div><div>{results.map(({horizon,result}) => <div key={horizon}><span>{horizon === "max" ? "Max" : `${horizon}Y`}</span><div className="cagr-track"><i style={{width:result.value == null ? 0 : `${Math.min(Math.abs(result.value)*500,100)}%`,background:result.value != null && result.value < 0 ? "var(--danger)" : METRICS[metric].color}}/></div><strong title={result.reason}>{result.value == null ? "N/M" : `${(result.value*100).toFixed(1)}%`}</strong><small>{result.reason ?? `${result.startDate} → ${result.endDate}`}</small></div>)}</div></section>;
}

function SourcesView({dataset}:{dataset:CompanyDataset}) { return <><section className="view-title"><div><span className="panel-kicker">DATA LINEAGE</span><h2>Sources & methodology</h2><p>Every calculated quarter, TTM window and quality indicator exposes its formula.</p></div></section><section className="source-grid"><article className="panel source-card"><div className="source-icon sec">SEC</div><div><span className="panel-kicker">PRIMARY FUNDAMENTALS</span><h2>SEC EDGAR Company Facts</h2><p>Direct quarters are preferred. Cumulative six- and nine-month cash flows are differenced only with matching fiscal starts. Q4 is annual minus Q3 YTD.</p><a href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces" target="_blank" rel="noreferrer">Official documentation <ExternalLink size={13}/></a></div></article><article className="panel source-card"><div className="source-icon yahoo">Y!</div><div><span className="panel-kicker">MARKET PRICES</span><h2>Yahoo Finance history</h2><p>Adjusted close, actual trading-session date, ticker, currency and fallback direction are preserved.</p><a href="https://help.yahoo.com/kb/adjusted-close-sln28256.html" target="_blank" rel="noreferrer">Adjusted-close method <ExternalLink size={13}/></a></div></article></section><section className="panel formula-panel"><div className="panel-head"><div><span className="panel-kicker">CALCULATION DICTIONARY</span><h2>Explicit formulas</h2></div><span className="verified"><Check size={14}/> Tested</span></div><div className="formula-list">{Object.entries(FORMULAS).map(([key,formula]) => <div key={key}><span>{key.replace(/([A-Z])/g," $1")}</span><code>{formula}</code></div>)}</div></section><section className="panel limitations"><div className="panel-head"><div><span className="panel-kicker">DATASET NOTES</span><h2>Visible limitations</h2></div></div>{dataset.warnings.map((warning) => <p key={warning}><Info size={15}/>{warning}</p>)}</section></> }
function SettingsView({dark,setDark}:{dark:boolean;setDark:(value:boolean)=>void}) { return <><section className="view-title"><div><span className="panel-kicker">WORKSPACE</span><h2>Settings</h2><p>Analysis preferences remain local to this device.</p></div></section><section className="panel settings-panel"><div><span><b>Appearance</b><small>Optimized for long dark-mode research sessions.</small></span><div className="theme-toggle"><button className={dark?"active":""} onClick={()=>setDark(true)}><Moon size={15}/> Dark</button><button className={!dark?"active":""} onClick={()=>setDark(false)}><Sun size={15}/> Light</button></div></div><div><span><b>Calculated-quarter badges</b><small>Always visible; cannot be silently disabled.</small></span><span className="toggle on"><i/></span></div><div><span><b>Current-price substitution</b><small>Disabled by design for historical valuation.</small></span><span className="toggle"><i/></span></div></section></> }
function FactDrawer({ fact, onClose }: { fact: NormalizedFact; onClose: () => void }) {
  return <div className="drawer-backdrop" role="button" tabIndex={0} aria-label="Close value provenance" onClick={(event) => event.target === event.currentTarget && onClose()} onKeyDown={(event) => event.key === "Escape" && onClose()}>
    <aside className="fact-drawer">
      <div className="drawer-head"><div><span className="panel-kicker">VALUE PROVENANCE</span><h2>{METRICS[fact.metric]?.label ?? fact.metric}</h2></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div>
      <div className="fact-value"><strong>{fact.unit === "currency" ? compactCurrency(fact.value, fact.currency) : new Intl.NumberFormat("en-US", { notation: "compact" }).format(fact.value ?? 0)}</strong><span className="status-pill"><Check size={13}/>{fact.provenance.status}</span></div>
      <dl><div><dt>Period</dt><dd>{fact.fiscalQuarter ? `${fact.fiscalQuarter} FY${fact.fiscalYear}` : `FY ${fact.fiscalYear}`}</dd></div><div><dt>Start / end</dt><dd>{fact.periodStart ?? "instant"} → {fact.periodEnd}</dd></div><div><dt>Currency / unit</dt><dd>{fact.currency} · {fact.unit}</dd></div><div><dt>Provider</dt><dd>{fact.provenance.provider}</dd></div><div><dt>Concept</dt><dd><code>{fact.provenance.concept}</code></dd></div><div><dt>Formula</dt><dd>{fact.provenance.formula ?? "Direct reported fact"}</dd></div><div><dt>Filed</dt><dd>{fact.provenance.filingDate ?? "—"}</dd></div><div><dt>Accessions</dt><dd><code>{fact.provenance.sourceAccessions?.join(", ") ?? fact.provenance.accession ?? "—"}</code></dd></div></dl>
      <p className="fact-note">{fact.provenance.note}</p><a className="button primary" href={fact.provenance.sourceUrl} target="_blank" rel="noreferrer">Open SEC filing <ExternalLink size={14}/></a>
    </aside>
  </div>;
}
