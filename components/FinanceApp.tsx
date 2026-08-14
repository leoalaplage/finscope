"use client";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { cagrForPeriods, derivedValue, valueOf } from "@/lib/finance";
import { METRICS, VIEW_METRICS } from "@/lib/metrics";
import { buildValuationHistory, valuationSnapshot, valuationStatistics } from "@/lib/valuation-history";
import type { CompanyDataset, CompanyProfile, FinancialPeriod, MetricKey, Periodicity, PricePoint } from "@/lib/types";

type MainView = "companies" | "company" | "charts" | "dcf";
type SecondaryView = "quality" | "audit" | "coverage" | "sources" | "qs" | null;
type Evidence = { label: string; value: number | null; period: FinancialPeriod; metric: string };

const NAV: Array<{ key: Exclude<MainView, "company">; label: string }> = [
  { key: "companies", label: "Companies" }, { key: "charts", label: "Charts" }, { key: "dcf", label: "DCF" },
];

const ChartsWorkspace = lazy(() => import("./ChartsWorkspace").then((module) => ({ default: module.ChartsWorkspace })));
const CompanyManager = lazy(() => import("./CompanyManager").then((module) => ({ default: module.CompanyManager })));
const CoverageMatrix = lazy(() => import("./CoverageMatrix").then((module) => ({ default: module.CoverageMatrix })));
const DataQuality = lazy(() => import("./DataQuality").then((module) => ({ default: module.DataQuality })));
const DcfValuation = lazy(() => import("./DcfValuation").then((module) => ({ default: module.DcfValuation })));
const FormulaDataAudit = lazy(() => import("./FormulaDataAudit").then((module) => ({ default: module.FormulaDataAudit })));
const QsScreener = lazy(() => import("./QsScreener").then((module) => ({ default: module.QsScreener })));

const currency = (value: number | null | undefined, code = "USD") => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: code, notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(value);
const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(value);
const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
const ratio = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}×`;
const sortedPeriods = (dataset: CompanyDataset, periodicity: Periodicity) => dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
const latestPeriod = (dataset: CompanyDataset) => sortedPeriods(dataset, "ttm").at(-1) ?? sortedPeriods(dataset, "annual").at(-1);
const change = (current: number | null, previous: number | null) => current != null && previous != null && previous !== 0 ? current / previous - 1 : null;

function metricDisplay(value: number | null, metric: string, code: string) {
  const kind = METRICS[metric]?.kind;
  if (kind === "percent") return percent(value);
  if (kind === "ratio") return ratio(value);
  if (kind === "currency" || kind === "perShare") return currency(value, code);
  return number(value);
}

export function FinanceApp({ initialData }: { initialData: CompanyDataset }) {
  const [datasets, setDatasets] = useState<Record<string, CompanyDataset>>({ [initialData.company.ticker]: initialData });
  const [dataset, setDataset] = useState(initialData);
  const [view, setView] = useState<MainView>("companies");
  const [secondary, setSecondary] = useState<SecondaryView>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [chartSeed, setChartSeed] = useState<{ ticker?: string; metric?: string; nonce: number }>({ ticker: initialData.company.ticker, nonce: 0 });
  const [watchlist, setWatchlist] = useState<CompanyProfile[]>(() => { if (typeof window === "undefined") return DEFAULT_WATCHLIST; try { return JSON.parse(localStorage.getItem("finscope.watchlist") ?? "null") ?? DEFAULT_WATCHLIST; } catch { return DEFAULT_WATCHLIST; } });
  useEffect(() => { localStorage.setItem("finscope.watchlist", JSON.stringify(watchlist)); }, [watchlist]);
  useEffect(() => { document.documentElement.dataset.theme = "light"; document.documentElement.style.colorScheme = "light"; }, []);

  function navigate(next: MainView) {
    setSecondary(null); setView(next);
    history.replaceState(null, "", `/?ticker=${dataset.company.ticker}&view=${next}`);
    window.scrollTo({ top: 0 });
  }
  async function openCompany(ticker: string) {
    setSecondary(null); setError("");
    if (datasets[ticker]) { setDataset(datasets[ticker]); setView("company"); history.replaceState(null, "", `/?ticker=${ticker}&view=company`); return; }
    setLoading(ticker);
    try {
      const response = await fetch(`/api/company/${encodeURIComponent(ticker)}`, { cache: "no-store" }); const payload = await response.json() as CompanyDataset & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load company");
      setDatasets((current) => ({ ...current, [ticker]: payload })); setDataset(payload); setView("company"); history.replaceState(null, "", `/?ticker=${ticker}&view=company`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load company"); }
    finally { setLoading(""); }
  }
  function acceptDataset(next: CompanyDataset) {
    setDatasets((current) => ({ ...current, [next.company.ticker]: next })); setDataset(next);
    setWatchlist((current) => current.some((company) => company.ticker === next.company.ticker) ? current : [...current, next.company]);
    setManagerOpen(false); setView("company");
  }
  function openCharts(ticker = dataset.company.ticker, metric?: string) {
    setChartSeed({ ticker, metric, nonce: Date.now() }); navigate("charts");
  }
  function openDcf() { navigate("dcf"); }

  return <div className="site-shell">
    <header className="site-header"><button className="wordmark" onClick={() => navigate("companies")}>FinScope</button><nav aria-label="Main navigation">{NAV.map((item) => <button key={item.key} className={view === item.key && !secondary ? "active" : ""} onClick={() => navigate(item.key)}>{item.label}</button>)}</nav><span className="header-company">{dataset.company.ticker}</span></header>
    {error && <div className="global-message" role="alert"><span><b>Could not load company.</b> {error}. Existing data remains available.</span><button onClick={() => setError("")}>Dismiss</button></div>}
    <main className="site-main">
      {secondary === "quality" && <SecondaryHeading title="Data Quality" onBack={() => setSecondary(null)}/>} {secondary === "quality" && <Suspense fallback={<p className="simple-state">Loading…</p>}><DataQuality dataset={dataset} onRefresh={(next) => { setDataset(next); setDatasets((current) => ({ ...current, [next.company.ticker]: next })); }}/></Suspense>}
      {secondary === "audit" && <SecondaryHeading title="Formula Audit" onBack={() => setSecondary(null)}/>} {secondary === "audit" && <Suspense fallback={<p className="simple-state">Loading…</p>}><FormulaDataAudit dataset={dataset}/></Suspense>}
      {secondary === "coverage" && <SecondaryHeading title="Import status" onBack={() => setSecondary(null)}/>} {secondary === "coverage" && <Suspense fallback={<p className="simple-state">Loading…</p>}><CoverageMatrix initialData={dataset}/></Suspense>}
      {secondary === "sources" && <SourcesPage dataset={dataset} onBack={() => setSecondary(null)}/>}
      {secondary === "qs" && <SecondaryHeading title="QS Screener" onBack={() => setSecondary(null)}/>} {secondary === "qs" && <Suspense fallback={<p className="simple-state">Loading…</p>}><QsScreener dark={false}/></Suspense>}
      {!secondary && view === "companies" && <CompaniesPage watchlist={watchlist} datasets={datasets} activeTicker={dataset.company.ticker} loading={loading} onSearchAdd={() => setManagerOpen(true)} onOpen={openCompany} onCharts={(ticker) => openCharts(ticker)} onRemove={(ticker) => setWatchlist((current) => current.filter((company) => company.ticker !== ticker))}/>}
      {!secondary && view === "company" && <CompanyPage key={dataset.company.ticker} dataset={dataset} onBack={() => navigate("companies")} onCharts={openCharts} onDcf={openDcf}/>}
      {!secondary && view === "charts" && <Suspense fallback={<p className="simple-state">Loading…</p>}><ChartsWorkspace initialData={dataset} seed={chartSeed}/></Suspense>}
      {!secondary && view === "dcf" && <div><header className="page-heading"><div><h1>DCF</h1><p>{dataset.company.name} · assumptions remain traceable to their historical base.</p></div><button onClick={() => navigate("companies")}>Change company</button></header><Suspense fallback={<p className="simple-state">Loading…</p>}><DcfValuation key={dataset.company.ticker} dataset={dataset}/></Suspense></div>}
    </main>
    <footer className="site-footer"><span>Auditable financial research · Not investment advice</span><details><summary>More</summary><div><button onClick={() => setSecondary("quality")}>Data Quality</button><button onClick={() => setSecondary("audit")}>Formula Audit</button><button onClick={() => setSecondary("coverage")}>Import status</button><button onClick={() => setSecondary("sources")}>Sources</button><button onClick={() => setSecondary("qs")}>QS Screener</button></div></details></footer>
    {managerOpen && <Suspense fallback={null}><CompanyManager onSelect={acceptDataset} onClose={() => setManagerOpen(false)}/></Suspense>}
  </div>;
}

function SecondaryHeading({ title, onBack }: { title: string; onBack: () => void }) { return <header className="page-heading"><div><h1>{title}</h1><p>Secondary research tool for the selected company.</p></div><button onClick={onBack}>Back</button></header>; }

function CompaniesPage({ watchlist, datasets, activeTicker, loading, onSearchAdd, onOpen, onCharts, onRemove }: { watchlist: CompanyProfile[]; datasets: Record<string, CompanyDataset>; activeTicker: string; loading: string; onSearchAdd: () => void; onOpen: (ticker: string) => void; onCharts: (ticker: string) => void; onRemove: (ticker: string) => void }) {
  const [query, setQuery] = useState(""); const [sortKey, setSortKey] = useState<"ticker" | "company" | "updated">("ticker");
  const [prices, setPrices] = useState<Record<string, PricePoint | null>>({});
  const loadedTickers = Object.keys(datasets).sort().join("|");
  useEffect(() => { let active = true; const date = new Date().toISOString().slice(0, 10); Promise.allSettled(loadedTickers.split("|").filter(Boolean).filter((ticker) => !(ticker in prices)).map(async (ticker) => { const response = await fetch(`/api/price/${encodeURIComponent(ticker)}?date=${date}`); const payload = await response.json() as PricePoint & { error?: string }; if (!response.ok) throw new Error(payload.error); if (active) setPrices((current) => ({ ...current, [ticker]: payload })); })).catch(() => undefined); return () => { active = false; }; }, [loadedTickers, prices]);
  const rows = useMemo(() => watchlist.filter((company) => `${company.ticker} ${company.name}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sortKey === "company" ? a.name.localeCompare(b.name) : sortKey === "updated" ? (datasets[b.ticker]?.retrievedAt ?? "").localeCompare(datasets[a.ticker]?.retrievedAt ?? "") : a.ticker.localeCompare(b.ticker)), [watchlist, datasets, query, sortKey]);
  return <div><header className="page-heading"><div><h1>Companies</h1><p>{watchlist.length} companies in your local watchlist.</p></div><button onClick={onSearchAdd}>Add company</button></header><section className="list-tools"><label>Search<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticker or company"/></label><label>Sort<select value={sortKey} onChange={(event) => setSortKey(event.target.value as typeof sortKey)}><option value="ticker">Ticker</option><option value="company">Company</option><option value="updated">Updated</option></select></label></section><div className="table-scroll"><table className="watchlist-table"><thead><tr><th>Ticker</th><th>Company</th><th>Price</th><th>FCF Margin</th><th>FCF/share CAGR 5Y</th><th>Revenue/share CAGR 5Y</th><th>Operating Margin</th><th>Dilution 5Y</th><th>P/FCF</th><th>Valuation vs AVG 5Y</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{rows.map((company) => {
    const data = datasets[company.ticker]; const point = prices[company.ticker]; const currentPrice = point?.priceClose ?? point?.close ?? null; const period = data ? latestPeriod(data) : undefined; const annual = data ? sortedPeriods(data, "annual") : []; const latestAnnual = annual.at(-1); const prior5 = annual.at(-6); const dilution = latestAnnual && prior5 ? change(valueOf(latestAnnual, "dilutedShares"), valueOf(prior5, "dilutedShares")) : null; const rowShares = period ? derivedValue(period, "sharesOutstanding") ?? derivedValue(period, "dilutedShares") : null; const rowFcf = period ? derivedValue(period, "freeCashFlow") : null; const pfcf = currentPrice != null && rowShares != null && rowFcf != null && rowFcf > 0 ? currentPrice * rowShares / rowFcf : null;
    return <tr key={company.ticker} className={company.ticker === activeTicker ? "selected-row" : ""}><th><button className="text-button" onClick={() => onOpen(company.ticker)}>{company.ticker}</button></th><td>{company.name}<small>{company.currency} · {company.exchange}</small></td><td>{currency(currentPrice, company.currency)}</td><td>{period ? percent(derivedValue(period, "freeCashFlowMargin")) : "—"}</td><td>{data ? percent(cagrForPeriods(annual, "freeCashFlowPerShare", 5).value) : "—"}</td><td>{data ? percent(cagrForPeriods(annual, "revenuePerShare", 5).value) : "—"}</td><td>{period ? percent(derivedValue(period, "operatingMargin")) : "—"}</td><td>{percent(dilution)}</td><td>{ratio(pfcf)}</td><td>—</td><td>{loading === company.ticker ? "Loading…" : data ? data.retrievedAt.slice(0, 10) : company.resolutionStatus === "unresolved" ? "Unavailable" : "Not loaded"}</td><td><div className="row-actions"><button onClick={() => onOpen(company.ticker)}>{data ? "Open" : "Load"}</button><button onClick={() => onCharts(company.ticker)}>Charts</button><button onClick={() => onRemove(company.ticker)}>Remove</button></div></td></tr>;
  })}</tbody></table></div>{!rows.length && <p className="simple-state">No companies match this search.</p>}</div>;
}

function CompanyPage({ dataset, onBack, onCharts, onDcf }: { dataset: CompanyDataset; onBack: () => void; onCharts: (ticker?: string, metric?: string) => void; onDcf: () => void }) {
  const [periodicity, setPeriodicity] = useState<Periodicity>(() => typeof window === "undefined" ? "annual" : (localStorage.getItem("finscope.periodicity") as Periodicity) || "annual");
  const [price, setPrice] = useState<PricePoint | null>(null); const [priceError, setPriceError] = useState(""); const [evidence, setEvidence] = useState<Evidence | null>(null);
  useEffect(() => { localStorage.setItem("finscope.periodicity", periodicity); }, [periodicity]);
  useEffect(() => { let active = true; fetch(`/api/price/${dataset.company.ticker}?date=${new Date().toISOString().slice(0, 10)}`, { cache: "no-store" }).then(async (response) => { const payload = await response.json() as PricePoint & { error?: string }; if (!response.ok) throw new Error(payload.error || "Could not load stock price"); if (active) setPrice(payload); }).catch((cause) => active && setPriceError(cause instanceof Error ? cause.message : "Could not load stock price")); return () => { active = false; }; }, [dataset.company.ticker]);
  const selected = sortedPeriods(dataset, periodicity); const latest = latestPeriod(dataset); const annual = sortedPeriods(dataset, "annual");
  if (!latest) return <p className="simple-state">No data available</p>;
  const shares = derivedValue(latest, "sharesOutstanding") ?? derivedValue(latest, "dilutedShares"); const currentPrice = price?.priceClose ?? price?.close ?? null; const marketCap = currentPrice != null && shares != null ? currentPrice * shares : null;
  const openMetric = (metric: string, period = latest) => setEvidence({ label: METRICS[metric]?.label ?? metric, value: derivedValue(period, metric), period, metric });
  return <div className="company-page"><button className="back-button" onClick={onBack}>← Companies</button><header className="company-title"><div><h1>{dataset.company.name}</h1><p>{dataset.company.ticker} · {dataset.company.exchange} · {dataset.company.currency} · Updated {dataset.retrievedAt.slice(0, 10)}</p></div><div className="company-title-actions"><button onClick={() => onCharts(dataset.company.ticker)}>Open in Charts</button><button onClick={onDcf}>Open DCF</button></div></header><dl className="company-facts"><div><dt>Stock price</dt><dd>{priceError ? "Could not load stock price" : price ? currency(currentPrice, dataset.company.currency) : "Loading…"}</dd></div><div><dt>Market cap</dt><dd>{currency(marketCap, dataset.company.currency)}</dd></div><div><dt>Currency</dt><dd>{dataset.company.currency}</dd></div><div><dt>Latest period</dt><dd>{latest.periodEnd}</dd></div></dl>
    <nav className="anchor-nav" aria-label="Company sections">{["overview", "financials", "growth", "margins", "capital", "valuation", "sources"].map((id) => <a key={id} href={`#${id}`}>{id === "capital" ? "Capital Allocation" : id === "sources" ? "Sources & Data Quality" : id.replace(/^./, (value) => value.toUpperCase())}</a>)}</nav>
    <section id="overview" className="plain-section"><SectionTitle title="Overview" onCharts={() => onCharts(dataset.company.ticker)}/><MetricSummaryTable dataset={dataset} price={currentPrice} onOpen={openMetric}/></section>
    <section id="financials" className="plain-section"><div className="section-heading"><h2>Financials</h2><div className="period-buttons">{(["annual", "quarterly", "ttm"] as Periodicity[]).map((item) => <button className={periodicity === item ? "active" : ""} key={item} onClick={() => setPeriodicity(item)}>{item === "ttm" ? "TTM" : item[0].toUpperCase() + item.slice(1)}</button>)}</div></div>{selected.length ? <SimpleFinancialTable periods={selected.slice(-10)} metrics={[...VIEW_METRICS.income, ...VIEW_METRICS.cashflow.slice(0, 4)]} onOpen={openMetric} currencyCode={dataset.company.currency}/> : <p className="simple-state">No data available for {periodicity}.</p>}</section>
    <section id="growth" className="plain-section"><SectionTitle title="Per Share & Growth" onCharts={() => onCharts(dataset.company.ticker, "freeCashFlowPerShare")}/><GrowthTable periods={annual}/></section>
    <section id="margins" className="plain-section"><SectionTitle title="Margins" onCharts={() => onCharts(dataset.company.ticker, "freeCashFlowMargin")}/><CurrentAndAverageTable periods={annual} metrics={[...VIEW_METRICS.margins]} onOpen={openMetric} currencyCode={dataset.company.currency}/></section>
    <section id="capital" className="plain-section"><SectionTitle title="Capital Allocation" onCharts={() => onCharts(dataset.company.ticker, "dilutedShares")}/><CurrentAndAverageTable periods={annual} metrics={["dilutedShares", "shareCountChange", "shareRepurchases", "shareIssuance", "dividendsPaid", "stockBasedCompensation"]} onOpen={openMetric} currencyCode={dataset.company.currency}/></section>
    <section id="valuation" className="plain-section"><SectionTitle title="Valuation" onCharts={() => onCharts(dataset.company.ticker, "stockPrice")}/><ValuationTable dataset={dataset} price={price}/></section>
    <section id="sources" className="plain-section"><h2>Sources & Data Quality</h2><table><tbody><tr><th>Fundamentals</th><td>SEC EDGAR Company Facts</td></tr><tr><th>Market data</th><td>Yahoo Finance adjusted close</td></tr><tr><th>Validation</th><td>{dataset.quality?.lastValidatedAt?.slice(0, 10) ?? dataset.retrievedAt.slice(0, 10)}</td></tr><tr><th>Coverage</th><td>{dataset.quality?.coverage.map((item) => `${item.periodicity}: ${item.periodCount}`).join(" · ") ?? `${dataset.periods.length} periods`}</td></tr></tbody></table>{dataset.warnings.length ? <ul>{dataset.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>No active data warnings.</p>}</section>
    {evidence && <EvidenceDialog evidence={evidence} onClose={() => setEvidence(null)}/>}
  </div>;
}

function SectionTitle({ title, onCharts }: { title: string; onCharts: () => void }) { return <div className="section-heading"><h2>{title}</h2><button onClick={onCharts}>Open in Charts</button></div>; }

function MetricSummaryTable({ dataset, price, onOpen }: { dataset: CompanyDataset; price: number | null; onOpen: (metric: string) => void }) {
  const latest = latestPeriod(dataset)!; const annual = sortedPeriods(dataset, "annual"); const previous = annual.at(-2); const latestAnnual = annual.at(-1); const shares = derivedValue(latest, "dilutedShares"); const marketCap = price != null && shares != null ? price * shares : null; const pfcf = marketCap != null ? marketCap / (derivedValue(latest, "freeCashFlow") || Number.NaN) : null;
  const metrics: Array<[string, number | null, string]> = [
    ["Revenue", derivedValue(latest, "revenue"), "revenue"], ["Revenue growth", latestAnnual && previous ? change(derivedValue(latestAnnual, "revenue"), derivedValue(previous, "revenue")) : null, "revenueGrowth"],
    ["Operating margin", derivedValue(latest, "operatingMargin"), "operatingMargin"], ["Free cash flow", derivedValue(latest, "freeCashFlow"), "freeCashFlow"], ["FCF margin", derivedValue(latest, "freeCashFlowMargin"), "freeCashFlowMargin"],
    ["FCF / share", derivedValue(latest, "freeCashFlowPerShare"), "freeCashFlowPerShare"], ["FCF / share CAGR 5Y", cagrForPeriods(annual, "freeCashFlowPerShare", 5).value, "freeCashFlowPerShareCagr"], ["EPS", derivedValue(latest, "netIncomePerShare"), "netIncomePerShare"],
    ["Diluted shares", shares, "dilutedShares"], ["Dilution 5Y", annual.length > 5 ? change(derivedValue(annual.at(-1)!, "dilutedShares"), derivedValue(annual.at(-6)!, "dilutedShares")) : null, "shareCountChange"], ["ROIC", derivedValue(latest, "roic"), "roic"], ["P / FCF", Number.isFinite(pfcf ?? NaN) ? pfcf : null, "priceToFreeCashFlow"],
  ];
  return <table><thead><tr><th>Metric</th><th>Current</th><th>Period</th></tr></thead><tbody>{metrics.map(([label, value, metric]) => <tr key={label}><th><button className="text-button" onClick={() => onOpen(metric)}>{label}</button></th><td>{METRICS[metric]?.kind === "percent" || metric.toLowerCase().includes("growth") || metric.toLowerCase().includes("cagr") || metric.toLowerCase().includes("margin") || metric === "shareCountChange" || metric === "roic" ? percent(value) : metric === "priceToFreeCashFlow" ? ratio(value) : metric === "dilutedShares" ? number(value) : currency(value, dataset.company.currency)}</td><td>{latest.periodEnd}</td></tr>)}</tbody></table>;
}

function SimpleFinancialTable({ periods, metrics, onOpen, currencyCode }: { periods: FinancialPeriod[]; metrics: string[]; onOpen: (metric: string, period: FinancialPeriod) => void; currencyCode: string }) { return <div className="table-scroll"><table><thead><tr><th>Metric</th>{periods.map((period) => <th key={period.periodEnd}>{period.label}<small>{period.periodEnd}</small></th>)}</tr></thead><tbody>{metrics.map((metric) => <tr key={metric}><th>{METRICS[metric]?.label ?? metric}</th>{periods.map((period) => <td key={period.periodEnd}><button className="value-button" onClick={() => onOpen(metric, period)}>{metricDisplay(derivedValue(period, metric), metric, currencyCode)}</button></td>)}</tr>)}</tbody></table></div>; }

function GrowthTable({ periods }: { periods: FinancialPeriod[] }) { const horizons = [3, 5, 10, 15, 20, "max"] as const; const metrics = ["revenue", "revenuePerShare", "netIncomePerShare", "freeCashFlow", "freeCashFlowPerShare", "dilutedShares"]; return <div className="table-scroll"><table><thead><tr><th>Metric</th>{horizons.map((horizon) => <th key={horizon}>{horizon === "max" ? "Max" : `${horizon}Y`}</th>)}</tr></thead><tbody>{metrics.map((metric) => <tr key={metric}><th>{METRICS[metric].label}</th>{horizons.map((horizon) => <td key={horizon}>{percent(cagrForPeriods(periods, metric, horizon).value)}</td>)}</tr>)}</tbody></table></div>; }

function CurrentAndAverageTable({ periods, metrics, onOpen, currencyCode }: { periods: FinancialPeriod[]; metrics: string[]; onOpen: (metric: string, period: FinancialPeriod) => void; currencyCode: string }) {
  const latest = periods.at(-1); if (!latest) return <p className="simple-state">No data available</p>;
  return <table><thead><tr><th>Metric</th><th>Current</th><th>5Y average</th><th>Period</th></tr></thead><tbody>{metrics.map((metric) => { const values = periods.slice(-5).map((period) => derivedValue(period, metric)).filter((value): value is number => value != null && Number.isFinite(value)); const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; return <tr key={metric}><th><button className="text-button" onClick={() => onOpen(metric, latest)}>{METRICS[metric]?.label ?? metric}</button></th><td>{metricDisplay(derivedValue(latest, metric), metric, currencyCode)}</td><td>{metricDisplay(average, metric, currencyCode)}</td><td>{latest.periodEnd}</td></tr>; })}</tbody></table>;
}

function ValuationTable({ dataset, price }: { dataset: CompanyDataset; price: PricePoint | null }) {
  const ttm = useMemo(() => sortedPeriods(dataset, "ttm"), [dataset]); const [points, setPoints] = useState<Record<string, PricePoint | null>>({}); const [error, setError] = useState(""); const dates = useMemo(() => [...new Set([...ttm.map((period) => period.filingDate), new Date().toISOString().slice(0, 10)])], [ttm]);
  useEffect(() => { let active = true; fetch(`/api/prices/${dataset.company.ticker}?dates=${dates.join(",")}&published=1`).then(async (response) => { const payload = await response.json() as { points?: Array<{ requestedDate: string; point?: PricePoint }>; error?: string }; if (!response.ok) throw new Error(payload.error || "Valuation history unavailable"); if (active) setPoints(Object.fromEntries((payload.points ?? []).map((item) => [item.requestedDate, item.point ?? null]))); }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "Valuation history unavailable")); return () => { active = false; }; }, [dataset.company.ticker, dates]);
  const latest = ttm.at(-1) ?? sortedPeriods(dataset, "annual").at(-1); const current = latest && price ? valuationSnapshot(latest, price) : null; const history = buildValuationHistory(ttm, points); const stats = valuationStatistics(history, "priceToFreeCashFlow", current?.metrics.priceToFreeCashFlow ?? null, 5);
  if (error) return <p className="simple-state">{error}. Fundamental data remains available.</p>;
  return <table><thead><tr><th>Metric</th><th>Current</th><th>AVG 5Y</th><th>Median 5Y</th><th>Premium / Discount</th><th>Percentile</th></tr></thead><tbody><tr><th>Price / Free cash flow</th><td>{ratio(stats.current)}</td><td>{ratio(stats.average)}</td><td>{ratio(stats.median)}</td><td>{percent(stats.premiumToAverage)}</td><td>{stats.percentile == null ? "—" : `${(stats.percentile * 100).toFixed(0)}%`}</td></tr></tbody></table>;
}

function EvidenceDialog({ evidence, onClose }: { evidence: Evidence; onClose: () => void }) {
  const fact = evidence.period.facts[evidence.metric as MetricKey]; return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="evidence-title"><div className="section-heading"><h2 id="evidence-title">{evidence.label}</h2><button onClick={onClose}>Close</button></div><dl><div><dt>Value</dt><dd>{number(evidence.value)}</dd></div><div><dt>Source</dt><dd>{fact?.provenance.provider ?? "Calculated"}</dd></div><div><dt>Period</dt><dd>{evidence.period.periodEnd} · {evidence.period.periodicity}</dd></div><div><dt>Formula</dt><dd>{fact?.provenance.formula ?? METRICS[evidence.metric]?.formula ?? "Direct reported fact"}</dd></div><div><dt>Validation</dt><dd>{fact?.validation?.status ?? fact?.provenance.status ?? (evidence.value == null ? "Missing" : "Calculated and verified")}</dd></div></dl>{fact?.provenance.sourceUrl && <a href={fact.provenance.sourceUrl} target="_blank" rel="noreferrer">Open source</a>}</section></div>;
}

function SourcesPage({ dataset, onBack }: { dataset: CompanyDataset; onBack: () => void }) { return <div><header className="page-heading"><div><h1>Sources</h1><p>{dataset.company.name} · data lineage and calculation policy.</p></div><button onClick={onBack}>Back</button></header><section className="plain-section"><h2>Primary sources</h2><table><tbody><tr><th>Fundamentals</th><td><a href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces" target="_blank" rel="noreferrer">SEC EDGAR Company Facts</a></td></tr><tr><th>Market data</th><td><a href="https://help.yahoo.com/kb/adjusted-close-sln28256.html" target="_blank" rel="noreferrer">Yahoo Finance adjusted close</a></td></tr></tbody></table></section><section className="plain-section"><h2>Methodology</h2><p>Direct reported quarters are preferred. Derived quarters, TTM windows, per-share metrics and margins retain their formula and validation status. Chart fundamentals stay on their fiscal dates; market observations stay on their trading-session dates.</p></section></div>; }
