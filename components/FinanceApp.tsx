"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { HeaderSearch } from "./HeaderSearch";
import { getJson } from "@/lib/fetch-json";
import { Skeleton, SkeletonCards, SkeletonTable } from "./Skeleton";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { TICKER_PATTERN } from "@/lib/market-profile";
import { COMPANY_COLUMNS, DEFAULT_COLUMNS, DEFAULT_COMPANY_FILTERS, DEFAULT_COMPANY_SORT, filterCompanyRows, preferredDirection, sortCompanyRows, type CompanyFilters, type CompanyRankingRow, type CompanySortKey, type SortDirection } from "@/lib/company-ranking";
import { cagrBetweenDates, cagrForPeriods, derivedValue, valueOf } from "@/lib/finance";
import { marketBasis, multipleOf } from "@/lib/market-basis";
import { CALLOUTS, DEFAULT_CALLOUTS, growthConsistency, growthGap, growthTable, HORIZONS, incrementalReturn, percentileAmong, ruleOfForty, worstDrawdown, type Horizon } from "@/lib/growth-quality";
import { CHARTABLE_METRICS, METRICS, VIEW_METRICS } from "@/lib/metrics";
import { balanceSheetDiagram, cashFlowDiagram, incomeStatementDiagram } from "@/lib/statement-flows";
import { buildValuationHistory, valuationSnapshot, valuationStatistics } from "@/lib/valuation-history";
import type { CompanyDataset, CompanyProfile, FinancialPeriod, MetricKey, Periodicity, PricePoint } from "@/lib/types";
import type { ThemeName } from "@/lib/charting";
import type { SeriesStyle } from "@/lib/chart-workspace";
import type { SeriesFrequency } from "@/lib/types";
import { currentDatasetPeriod } from "@/lib/current-period";

/**
 * Where you can be, at the top level.
 *
 * Statistics and DCF used to sit here too. Both are about one company — the DCF
 * page was even keyed on the open ticker — so both were destinations that threw
 * you out of the company you were reading to show you that same company again.
 * They are tabs on its page now. What is left is the four ways of choosing a
 * company and the one workspace that is genuinely about several at once.
 */
type MainView = "search" | "companies" | "company" | "market" | "charts" | "qs";
type SecondaryView = "quality" | "audit" | "coverage" | "sources" | null;
type Evidence = { label: string; value: number | null; period: FinancialPeriod; metric: string };

/**
 * A company reads as one thing, not eleven stacked on top of each other.
 *
 * These were separate sections in a single long scroll with an anchor list
 * above them, which meant the answer to "how is this business doing" was spread
 * over several screens. Overview is now one block that stands alone, and the
 * detail behind it is a click rather than a scroll.
 */
type CompanyTab = "overview" | "statistics" | "statements" | "financials" | "valuation" | "sources";
const COMPANY_TABS: Array<{ key: CompanyTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "statistics", label: "Statistics" },
  { key: "statements", label: "Statements" },
  { key: "financials", label: "Financials" },
  { key: "valuation", label: "Valuation" },
  { key: "sources", label: "Sources" },
];
const COMPANY_TAB_KEYS = new Set<string>(COMPANY_TABS.map((item) => item.key));

/**
 * How long a company held in this tab may be reused before it is asked for
 * again.
 *
 * Short enough that a results release reaches an open session on the next
 * navigation, long enough that clicking between six companies does not refetch
 * any of them. The server answers a cached copy in a few milliseconds, so the
 * cost of being wrong in this direction is small; the cost of being wrong in
 * the other is showing last quarter all day.
 */
const SESSION_MAX_AGE_MS = 1_800_000;

const NAV: Array<{ key: Exclude<MainView, "company">; label: string }> = [
  { key: "search", label: "Search" }, { key: "companies", label: "Watchlist" }, { key: "market", label: "Market" }, { key: "charts", label: "Charts" }, { key: "qs", label: "QS Screener" },
];
const NAV_KEYS = new Set<string>(NAV.map((item) => item.key));

const ChartsWorkspace = lazy(() => import("./ChartsWorkspace").then((module) => ({ default: module.ChartsWorkspace })));
const CompanyManager = lazy(() => import("./CompanyManager").then((module) => ({ default: module.CompanyManager })));
const CoverageMatrix = lazy(() => import("./CoverageMatrix").then((module) => ({ default: module.CoverageMatrix })));
const DataQuality = lazy(() => import("./DataQuality").then((module) => ({ default: module.DataQuality })));
const DcfValuation = lazy(() => import("./DcfValuation").then((module) => ({ default: module.DcfValuation })));
const FcfYieldCalculator = lazy(() => import("./FcfYieldCalculator").then((module) => ({ default: module.FcfYieldCalculator })));
const FormulaDataAudit = lazy(() => import("./FormulaDataAudit").then((module) => ({ default: module.FormulaDataAudit })));
const QsScreener = lazy(() => import("./QsScreener").then((module) => ({ default: module.QsScreener })));
const MarketPage = lazy(() => import("./MarketPage").then((module) => ({ default: module.MarketPage })));
const CompanyStatisticsTab = lazy(() => import("./CompanyStatisticsTab").then((module) => ({ default: module.CompanyStatisticsTab })));
const QualityValuationScatter = lazy(() => import("./QualityValuationScatter").then((module) => ({ default: module.QualityValuationScatter })));
const CompanyKpiGrid = lazy(() => import("./CompanyKpiGrid").then((module) => ({ default: module.CompanyKpiGrid })));
const StatementSankey = lazy(() => import("./StatementSankey").then((module) => ({ default: module.StatementSankey })));
const BalanceSheetPanel = lazy(() => import("./BalanceSheetPanel").then((module) => ({ default: module.BalanceSheetPanel })));
const HomePage = lazy(() => import("./HomePage").then((module) => ({ default: module.HomePage })));
const SearchPage = lazy(() => import("./SearchPage").then((module) => ({ default: module.SearchPage })));
const FreshnessCheck = lazy(() => import("./FreshnessCheck").then((module) => ({ default: module.FreshnessCheck })));

const currency = (value: number | null | undefined, code = "USD") => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: code, notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(value);
const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(value);
const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
const ratio = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}×`;
/**
 * A readable date, formatted identically on the server and in the browser.
 *
 * The locale and the time zone are stated rather than inherited: this page is
 * prerendered, and a format that depends on where it is rendered is a
 * hydration mismatch that makes React throw the server's tree away and render
 * the whole application again on the client.
 */
const DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const readableDate = (iso: string) => {
  const parsed = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? iso.slice(0, 10) : DAY.format(parsed);
};

/** This company's filing history on EDGAR, which is where every figure came from. */
const edgarUrl = (cik: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(cik)}&type=10-&dateb=&owner=include&count=40`;

const sortedPeriods = (dataset: CompanyDataset, periodicity: Periodicity) => dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
const latestPeriod = (dataset: CompanyDataset) => currentDatasetPeriod(dataset);
const change = (current: number | null, previous: number | null) => current != null && previous != null && previous !== 0 ? current / previous - 1 : null;

/**
 * How far the latest cash return on capital sits from its own five-year mean.
 *
 * A single year's reading moves with one heavy investment year. The distance
 * from the company's own recent average is what says whether the business is
 * still earning what it used to on the capital it employs.
 */
function cashRoCGap(annual: FinancialPeriod[], latest: FinancialPeriod | undefined) {
  const current = latest ? derivedValue(latest, "cashReturnOnCapital") : null;
  const history = annual.slice(-5).map((period) => derivedValue(period, "cashReturnOnCapital")).filter((value): value is number => value != null && Number.isFinite(value));
  if (current == null || history.length < 3) return null;
  return current - history.reduce((sum, value) => sum + value, 0) / history.length;
}

function metricDisplay(value: number | null, metric: string, code: string) {
  const kind = METRICS[metric]?.kind;
  if (kind === "percent") return percent(value);
  if (kind === "ratio") return ratio(value);
  if (kind === "currency" || kind === "perShare") return currency(value, code);
  return number(value);
}

const SECONDARY_KEYS = new Set<string>(["quality", "audit", "coverage", "sources"]);

/**
 * The application's state as it appears in the address bar.
 *
 * Everything here arrives from a string a person may have typed or edited, so
 * every field is checked against the set of things it is allowed to be and
 * anything else becomes `null` — an unreadable URL opens the front page rather
 * than a broken one.
 */
function readRoute(search: string) {
  const params = new URLSearchParams(search);
  const ticker = (params.get("ticker") ?? "").toUpperCase();
  const view = params.get("view") ?? "";
  const tab = params.get("tab") ?? "";
  const panel = params.get("panel") ?? "";
  return {
    ticker: TICKER_PATTERN.test(ticker) ? ticker : null,
    view: view === "company" || NAV_KEYS.has(view) ? view as MainView : null,
    tab: COMPANY_TAB_KEYS.has(tab) ? tab as CompanyTab : null,
    secondary: SECONDARY_KEYS.has(panel) ? panel as SecondaryView : null,
    ranking: params.get("table") === "1",
  };
}

export function FinanceApp({ initialData }: { initialData: CompanyDataset }) {
  const [datasets, setDatasets] = useState<Record<string, CompanyDataset>>({ [initialData.company.ticker]: initialData });
  const [dataset, setDataset] = useState(initialData);
  /* The application opens on the question, not on somebody else's watchlist. */
  const [view, setView] = useState<MainView>("search");
  /* Which tab of the company page is open. Held here rather than inside that
     page so it can be read from and written to the address bar. */
  const [companyTab, setCompanyTab] = useState<CompanyTab>("overview");
  const [secondary, setSecondary] = useState<SecondaryView>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  // The landing is a search box and the watchlist. The ranking table is still
  // one click away for anyone comparing the whole list at once.
  const [ranking, setRanking] = useState(false);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  // Set only by an explicit "Open in Charts"; plain navigation leaves the
  // workspace exactly as the reader last arranged it.
  const [chartSeed, setChartSeed] = useState<{ ticker?: string; metric?: string; nonce: number; style?: SeriesStyle; frequency?: SeriesFrequency }>();
  /**
   * Keeps the page you are on visible in the navigation.
   *
   * Even at five, on a narrow phone the strip can scroll, which means the
   * active destination can sit off-screen — arriving on Charts and seeing a bar
   * that starts at "Watchlist" reads as though nothing is selected.
   */
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>("button.active");
    active?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [view, secondary]);
  const [watchlist, setWatchlist] = useState<CompanyProfile[]>(() => { if (typeof window === "undefined") return DEFAULT_WATCHLIST; try { return JSON.parse(localStorage.getItem("finscope.watchlist") ?? "null") ?? DEFAULT_WATCHLIST; } catch { return DEFAULT_WATCHLIST; } });
  useEffect(() => { localStorage.setItem("finscope.watchlist", JSON.stringify(watchlist)); }, [watchlist]);
  // When each company was last fetched, so a long-lived session can tell a
  // company it holds from one it holds and should refresh. Not state: nothing
  // renders from it, and writing it must never schedule a render.
  const loadedAt = useRef<Record<string, number>>({});
  const seeded = useRef(initialData.company.ticker);
  /*
   * Where the reader actually asked to be, and the live filings for it.
   *
   * The server renders the offline Apple fixture — keeping the four-megabyte
   * dataset out of the HTML is what lets this page render at all — so on every
   * load the client replaces it. What it did *not* do was look at the address
   * bar first, so a link to any other company opened Apple's watchlist, and
   * every URL this application had spent four `replaceState` calls writing was
   * decorative.
   */
  useEffect(() => {
    let active = true;
    const apply = () => {
      const route = readRoute(location.search);
      setSecondary(route.secondary);
      setRanking(route.ranking);
      if (route.tab) setCompanyTab(route.tab);
      if (route.view) setView(route.view);
      const ticker = route.ticker ?? seeded.current;
      // The company named in the URL, or the fixture's own, refreshed.
      loadCompanyData(ticker).then((payload) => {
        if (!active || !payload) return;
        setDataset((current) => current.company.ticker === ticker || route.ticker === ticker ? payload : current);
      }).catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : `Could not load ${ticker}`);
        // A failed deep link to another ticker must never present Apple's
        // fixture as though it belonged to the requested company.
        if (route.ticker && route.ticker !== initialData.company.ticker) setView("search");
      });
    };
    apply();
    // Back and Forward are navigation, and were doing nothing whatsoever.
    addEventListener("popstate", apply);
    return () => { active = false; removeEventListener("popstate", apply); };
    // Runs once: `apply` reads the address bar, which is the source of truth
    // here, and re-running it on every state change would fight the writer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Dark is the default this interface was designed against; the choice is
  // remembered, and the chart palette is re-stepped for whichever is active.
  const [theme, setTheme] = useState<ThemeName>(() => {
    if (typeof window === "undefined") return "dark";
    const saved = localStorage.getItem("finscope.theme");
    return saved === "light" || saved === "dark" ? saved : "dark";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // `color-scheme` follows the attribute in the stylesheet; setting it here
    // as well would leave an inline style competing with the same declaration.
    localStorage.setItem("finscope.theme", theme);
  }, [theme]);

  /*
   * The address bar, read as well as written.
   *
   * Four places wrote `history.replaceState` with a ticker and a view, and
   * nothing anywhere read `location.search` back. So the URL looked
   * shareable and was not: sending someone `/?ticker=VEEV&view=company` landed
   * them on the watchlist looking at Apple, refreshing lost wherever you were,
   * and the browser's Back button did nothing at all. For a product people are
   * meant to send each other links to, that is not a detail.
   *
   * State is pushed rather than replaced, so Back retraces the pages you
   * visited — except the tab within a company, which is replaced: Back should
   * take you out of a company, not walk you back through its six tabs.
   */
  function writeRoute(next: { view?: MainView; ticker?: string; tab?: CompanyTab; secondary?: SecondaryView; ranking?: boolean }, mode: "push" | "replace" = "push") {
    const params = new URLSearchParams();
    params.set("ticker", next.ticker ?? dataset.company.ticker);
    if (next.secondary) params.set("panel", next.secondary);
    else {
      params.set("view", next.view ?? view);
      if ((next.view ?? view) === "company") params.set("tab", next.tab ?? companyTab);
      if ((next.view ?? view) === "companies" && (next.ranking ?? ranking)) params.set("table", "1");
    }
    const url = `/?${params.toString()}`;
    if (mode === "push" && url !== `${location.pathname}${location.search}`) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }

  function navigate(next: MainView) {
    setSecondary(null); setChartSeed(undefined); setRanking(false); setView(next);
    writeRoute({ view: next, secondary: null, ranking: false });
    window.scrollTo({ top: 0 });
  }
  function openPanel(panel: SecondaryView) {
    setSecondary(panel);
    writeRoute({ secondary: panel });
    window.scrollTo({ top: 0 });
  }
  function closePanel() {
    setSecondary(null);
    writeRoute({ secondary: null });
  }
  function showRanking(on: boolean) {
    setRanking(on);
    writeRoute({ view: "companies", ranking: on });
  }
  function openTab(next: CompanyTab) {
    setCompanyTab(next);
    // Replaced, not pushed: see writeRoute.
    writeRoute({ view: "company", tab: next }, "replace");
    window.scrollTo({ top: 0 });
  }
  async function loadCompanyData(ticker: string) {
    // A company held since this tab was opened is reused, up to a point. A
    // session left open across a results release used to keep serving the
    // filings it happened to fetch that morning, so reopening the company
    // showed the old quarter with no way to ask for the new one short of a
    // reload — the server was current and the browser was not.
    if (datasets[ticker] && Date.now() - (loadedAt.current[ticker] ?? 0) < SESSION_MAX_AGE_MS) return datasets[ticker];
    const payload = await getJson<CompanyDataset>(`/api/company/${encodeURIComponent(ticker)}`, { what: `${ticker}`, init: { cache: "no-store" } });
    loadedAt.current[ticker] = Date.now();
    setDatasets((current) => ({ ...current, [ticker]: payload }));
    return payload;
  }
  async function openCompany(ticker: string, tab: CompanyTab = "overview") {
    setSecondary(null); setError("");
    // Held company: show it at once and let loadCompanyData decide whether it
    // is old enough to be worth asking for again, in the background.
    const held = datasets[ticker];
    if (held) { setDataset(held); setCompanyTab(tab); setView("company"); writeRoute({ view: "company", ticker, tab, secondary: null }); }
    else setLoading(ticker);
    try {
      const payload = await loadCompanyData(ticker);
      setDataset((current) => current.company.ticker === ticker || !held ? payload : current);
      setCompanyTab(tab); setView("company"); writeRoute({ view: "company", ticker, tab, secondary: null });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load company"); }
    finally { setLoading(""); }
  }
  function acceptDataset(next: CompanyDataset) {
    loadedAt.current[next.company.ticker] = Date.now();
    setDatasets((current) => ({ ...current, [next.company.ticker]: next })); setDataset(next);
    setWatchlist((current) => current.some((company) => company.ticker === next.company.ticker) ? current : [...current, next.company]);
    setManagerOpen(false); setCompanyTab("overview"); setView("company");
    writeRoute({ view: "company", ticker: next.company.ticker, tab: "overview", secondary: null });
  }
  /**
   * A company chosen from the header search that the reader does not follow.
   *
   * Added first and opened second, deliberately in that order: a company they
   * picked belongs on their list whether or not the SEC answers for it this
   * minute, and a failed load should leave a card they can retry rather than
   * nothing at all. This is the same order the import dialog uses.
   */
  function addAndOpen(company: CompanyProfile) {
    setWatchlist((current) => current.some((item) => item.ticker === company.ticker) ? current : [...current, company]);
    void openCompany(company.ticker);
  }
  function openCharts(ticker = dataset.company.ticker, metric?: string, presentation?: { style?: SeriesStyle; frequency?: SeriesFrequency }) {
    setSecondary(null); setChartSeed({ ticker, metric, nonce: Date.now(), ...presentation }); setView("charts");
    writeRoute({ view: "charts", ticker, secondary: null });
    window.scrollTo({ top: 0 });
  }

  return <div className="site-shell">
    <header className="site-header"><button className="wordmark" onClick={() => navigate("companies")}>FinScope</button><nav aria-label="Main navigation" ref={navRef}>{NAV.map((item) => <button key={item.key} className={view === item.key && !secondary ? "active" : ""} onClick={() => navigate(item.key)}>{item.label}</button>)}</nav><span className="header-company">{/* Not on the page that is itself a search field. */}{view !== "search" && <HeaderSearch watchlist={watchlist} onOpen={openCompany} onAdd={addAndOpen}/>}<button className="header-ticker" title={`Open ${dataset.company.ticker}`} onClick={() => openCompany(dataset.company.ticker)}>{dataset.company.ticker}</button><button className="theme-toggle" aria-label="Switch between the light and dark theme" title="Switch between the light and dark theme" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}/></span></header>
    {error && <div className="global-message" role="alert"><span><b>Could not load company.</b> {error}. Existing data remains available.</span><button onClick={() => setError("")}>Dismiss</button></div>}
    <main className="site-main">
      {secondary === "quality" && <SecondaryHeading title="Data Quality" onBack={closePanel}/>} {secondary === "quality" && <Suspense fallback={<SkeletonTable label="the data quality report"/>}><DataQuality dataset={dataset} onRefresh={(next) => { setDataset(next); setDatasets((current) => ({ ...current, [next.company.ticker]: next })); }}/></Suspense>}
      {secondary === "audit" && <SecondaryHeading title="Formula Audit" onBack={closePanel}/>} {secondary === "audit" && <Suspense fallback={<SkeletonTable label="the formula audit"/>}><FormulaDataAudit dataset={dataset}/></Suspense>}
      {secondary === "coverage" && <SecondaryHeading title="Import status" onBack={closePanel}/>} {secondary === "coverage" && <Suspense fallback={<SkeletonTable label="the import status"/>}><CoverageMatrix initialData={dataset}/></Suspense>}
      {secondary === "sources" && <SourcesPage tickers={watchlist.filter((company) => company.resolutionStatus !== "unresolved").map((company) => company.ticker)} onBack={closePanel}/>}
      {!secondary && view === "search" && <Suspense fallback={<Skeleton label="the search page" lines={4}/>}><SearchPage watchlist={watchlist} onOpen={openCompany} onAdd={addAndOpen} onBrowse={() => navigate("companies")}/></Suspense>}
      {!secondary && view === "qs" && <Suspense fallback={<SkeletonTable label="the QS Screener" rows={10}/>}><QsScreener tickers={watchlist.map((company) => company.ticker)}/></Suspense>}
      {!secondary && view === "companies" && !ranking && <Suspense fallback={<SkeletonCards label="your watchlist" count={8}/>}><HomePage watchlist={watchlist} datasets={datasets} loading={loading} onOpen={openCompany} onLoad={loadCompanyData} onSearchAdd={() => setManagerOpen(true)} onShowRanking={() => showRanking(true)} onRemove={(ticker) => setWatchlist((current) => current.filter((company) => company.ticker !== ticker))}/></Suspense>}
      {!secondary && view === "companies" && ranking && <div><button className="back-button" onClick={() => showRanking(false)}>← Watchlist</button><CompaniesPage watchlist={watchlist} datasets={datasets} activeTicker={dataset.company.ticker} loading={loading} onSearchAdd={() => setManagerOpen(true)} onLoad={loadCompanyData} onOpen={openCompany} onCharts={(ticker) => openCharts(ticker)} onRemove={(ticker) => setWatchlist((current) => current.filter((company) => company.ticker !== ticker))}/></div>}
      {!secondary && view === "company" && <CompanyPage key={dataset.company.ticker} dataset={dataset} theme={theme} watchlist={watchlist} datasets={datasets} tab={companyTab} onTab={openTab} onBack={() => navigate("companies")} onCharts={openCharts} onLoad={loadCompanyData}/>}
      {!secondary && view === "market" && <Suspense fallback={<SkeletonCards label="the market session" count={3} height={230}/>}><MarketPage watchlist={watchlist.filter((company) => company.resolutionStatus !== "unresolved").map((company) => company.ticker)}/></Suspense>}
      {!secondary && view === "charts" && <Suspense fallback={<Skeleton label="the chart workspace" chart height={420}/>}><ChartsWorkspace initialData={dataset} seed={chartSeed} theme={theme}/></Suspense>}
    </main>
    <footer className="site-footer"><span>Auditable financial research · Not investment advice</span><details><summary>More</summary><div><button onClick={() => openPanel("quality")}>Data Quality</button><button onClick={() => openPanel("audit")}>Formula Audit</button><button onClick={() => openPanel("coverage")}>Import status</button><button onClick={() => openPanel("sources")}>Sources</button></div></details></footer>
    {managerOpen && <Suspense fallback={null}><CompanyManager watchlist={watchlist} setWatchlist={setWatchlist} onSelect={acceptDataset} onClose={() => setManagerOpen(false)}/></Suspense>}
  </div>;
}

function SecondaryHeading({ title, onBack }: { title: string; onBack: () => void }) { return <header className="page-heading"><div><h1>{title}</h1><p>Secondary research tool for the selected company.</p></div><button onClick={onBack}>Back</button></header>; }

function CompaniesPage({ watchlist, datasets, activeTicker, loading, onSearchAdd, onLoad, onOpen, onCharts, onRemove }: { watchlist: CompanyProfile[]; datasets: Record<string, CompanyDataset>; activeTicker: string; loading: string; onSearchAdd: () => void; onLoad: (ticker: string) => Promise<CompanyDataset>; onOpen: (ticker: string) => void; onCharts: (ticker: string) => void; onRemove: (ticker: string) => void }) {
  type RankingDisplayRow = CompanyRankingRow & { profile: CompanyProfile };
  const [filters, setFilters] = useState<CompanyFilters>(DEFAULT_COMPANY_FILTERS);
  const [sort, setSort] = useState<{ key: CompanySortKey; direction: SortDirection }>(() => {
    if (typeof window === "undefined") return DEFAULT_COMPANY_SORT;
    try {
      const saved = JSON.parse(localStorage.getItem("finscope.companySort") ?? "null") as { key?: CompanySortKey; direction?: SortDirection } | null;
      return saved?.key && (saved.direction === "asc" || saved.direction === "desc") ? { key: saved.key, direction: saved.direction } : DEFAULT_COMPANY_SORT;
    } catch { return DEFAULT_COMPANY_SORT; }
  });
  const [columns, setColumns] = useState<CompanySortKey[]>(() => {
    if (typeof window === "undefined") return DEFAULT_COLUMNS;
    try {
      const saved = JSON.parse(localStorage.getItem("finscope.companyColumns") ?? "null") as CompanySortKey[] | null;
      const valid = Array.isArray(saved) ? saved.filter((key) => COMPANY_COLUMNS.some((column) => column.key === key)) : null;
      return valid?.length ? valid : DEFAULT_COLUMNS;
    } catch { return DEFAULT_COLUMNS; }
  });
  const [prices, setPrices] = useState<Record<string, PricePoint | null>>({});
  const [valuationPremiums, setValuationPremiums] = useState<Record<string, number | null>>({});
  const [bulkLoading, setBulkLoading] = useState<Set<string>>(() => new Set());
  const [bulkState, setBulkState] = useState({ running: false, done: 0, total: 0, failed: 0 });
  const loadedTickers = Object.keys(datasets).sort().join("|");
  useEffect(() => { localStorage.setItem("finscope.companySort", JSON.stringify(sort)); }, [sort]);
  useEffect(() => { localStorage.setItem("finscope.companyColumns", JSON.stringify(columns)); }, [columns]);
  // Each newly loaded company would otherwise fan out into a price and a
  // valuation-history request straight away. During a bulk load that turns a
  // deliberately sequential walk back into a stampede of concurrent work. These two
  // effects wait for the batch to finish, then fill in every company at once.
  useEffect(() => {
    if (bulkState.running) return;
    let active = true; const date = new Date().toISOString().slice(0, 10);
    for (const ticker of loadedTickers.split("|").filter(Boolean).filter((item) => !(item in prices))) {
      fetch(`/api/price/${encodeURIComponent(ticker)}?date=${date}`).then(async (response) => {
        const payload = await response.json() as PricePoint & { error?: string }; if (!response.ok) throw new Error(payload.error || "Price unavailable");
        if (active) setPrices((current) => ({ ...current, [ticker]: payload }));
      }).catch(() => active && setPrices((current) => ({ ...current, [ticker]: null })));
    }
    return () => { active = false; };
  }, [loadedTickers, prices, bulkState.running]);
  useEffect(() => {
    if (bulkState.running) return;
    let active = true;
    for (const ticker of loadedTickers.split("|").filter(Boolean).filter((item) => prices[item] && !(item in valuationPremiums))) {
      const data = datasets[ticker]; const currentPrice = prices[ticker]; if (!data || !currentPrice) continue;
      const periods = sortedPeriods(data, "ttm"); const dates = [...new Set(periods.map((period) => period.filingDate).filter(Boolean))];
      // A company with no TTM periods has no dates to price. Asking anyway
      // returns 400 and logs an error for a question nobody asked.
      if (!dates.length) continue;
      fetch(`/api/prices/${encodeURIComponent(ticker)}?dates=${dates.join(",")}&published=1`).then(async (response) => {
        const payload = await response.json() as { points?: Array<{ requestedDate: string; point?: PricePoint }>; error?: string }; if (!response.ok) throw new Error(payload.error || "Valuation history unavailable");
        const pointMap = Object.fromEntries((payload.points ?? []).map((item) => [item.requestedDate, item.point ?? null])); const latest = periods.at(-1) ?? sortedPeriods(data, "annual").at(-1); const snapshot = latest ? valuationSnapshot(latest, currentPrice) : null; const history = buildValuationHistory(periods, pointMap); const premium = valuationStatistics(history, "priceToFreeCashFlow", snapshot?.metrics.priceToFreeCashFlow ?? null, 5).premiumToAverage;
        if (active) setValuationPremiums((current) => ({ ...current, [ticker]: premium }));
      }).catch(() => active && setValuationPremiums((current) => ({ ...current, [ticker]: null })));
    }
    return () => { active = false; };
  }, [datasets, loadedTickers, prices, valuationPremiums, bulkState.running]);
  const rawRows = useMemo<RankingDisplayRow[]>(() => watchlist.map((profile) => {
    const data = datasets[profile.ticker]; const point = prices[profile.ticker]; const period = data ? latestPeriod(data) : undefined; const annual = data ? sortedPeriods(data, "annual") : []; const latestAnnual = annual.at(-1); const prior5 = annual.at(-6);
    const dilution = latestAnnual && prior5 ? change(valueOf(latestAnnual, "dilutedShares"), valueOf(prior5, "dilutedShares")) : null; const fcf = period ? derivedValue(period, "freeCashFlow") : null;
    // One basis for the card, the table and the scatter: a price matched to the
    // currency the statements are kept in, over a stated share count.
    const marketCap = period ? marketBasis(period, point).basis?.marketCap ?? null : null; const pfcf = multipleOf(marketCap, fcf);
    const gap = data ? growthGap(annual, 10) : null;
    return { profile, ticker: profile.ticker, marketCap, fcfMargin: period ? derivedValue(period, "freeCashFlowMargin") : null, fcfShareCagr: data ? cagrForPeriods(annual, "freeCashFlowPerShare", 5).value : null, revenueShareCagr: data ? cagrForPeriods(annual, "revenuePerShare", 5).value : null, operatingMargin: period ? derivedValue(period, "operatingMargin") : null, dilution, pfcf, valuationVsAverage: valuationPremiums[profile.ticker] ?? null,
      revenueCagr10: gap?.revenue ?? null, fcfCagr10: gap?.freeCashFlow ?? null, fcfVsRevenue10: gap?.spread ?? null,
      fcfConsistency5: data ? growthConsistency(annual, "freeCashFlow", 5).rSquared : null,
      fcfConsistency10: data ? growthConsistency(annual, "freeCashFlow", 10).rSquared : null,
      fcfAfterSbcMargin: period ? derivedValue(period, "freeCashFlowAfterSbcMargin") : null,
      roic: period ? derivedValue(period, "roic") : null,
      cashRoC: period ? derivedValue(period, "cashReturnOnCapital") : null,
      cashRoCvsAverage: cashRoCGap(annual, period),
      roiic5: data ? incrementalReturn(annual, 5).value : null,
      ruleOfForty: data ? ruleOfForty(annual).value : null,
      capitalIntensity: period ? derivedValue(period, "capitalIntensity") : null,
      fcfDrawdown: data ? worstDrawdown(annual).value : null,
      updated: data?.retrievedAt.slice(0, 10) ?? null, loading: loading === profile.ticker || bulkLoading.has(profile.ticker) || Boolean(data && !(profile.ticker in prices)) };
  }), [watchlist, datasets, prices, valuationPremiums, loading, bulkLoading]);
  const rows = useMemo(() => sortCompanyRows(filterCompanyRows(rawRows, filters), sort.key, sort.direction), [rawRows, filters, sort]);
  const selectSort = (key: CompanySortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "desc" ? "asc" : "desc" } : { key, direction: preferredDirection(key) });
  const heading = (label: string, key: CompanySortKey) => <button className="sort-heading" onClick={() => selectSort(key)} aria-label={`Sort by ${label}`}>{label}<span aria-hidden="true">{sort.key === key ? sort.direction === "desc" ? " ↓" : " ↑" : ""}</span></button>;
  const setNumericFilter = (key: keyof CompanyFilters, value: string, multiplier: number) => setFilters((current) => ({ ...current, [key]: value === "" ? null : Number(value) * multiplier }));
  const missingReason = (row: RankingDisplayRow, label: string) => row.loading ? `${label} is still loading.` : row.profile.resolutionStatus === "unresolved" ? `${label} is unavailable because this ticker could not be resolved.` : !datasets[row.ticker] ? `Load ${row.ticker} to calculate ${label}.` : `${label} is not meaningful or is missing from the validated source data.`;
  const shownColumns = COMPANY_COLUMNS.filter((column) => columns.includes(column.key));
  const formatCell = (row: RankingDisplayRow, column: typeof COMPANY_COLUMNS[number]) => {
    const value = row[column.key];
    if (value == null || !Number.isFinite(value)) return <td key={column.key} title={missingReason(row, column.label)}>—</td>;
    // A figure means little alone; its place among the loaded peers does.
    const place = percentileAmong(value, rawRows.map((peer) => peer[column.key]), preferredDirection(column.key) === "desc");
    const text = column.format === "currency" ? currency(value, row.profile.currency)
      : column.format === "ratio" ? ratio(value)
      : column.format === "points" ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`
      : column.format === "score" ? value.toFixed(2)
      : column.format === "points40" ? (value * 100).toFixed(0)
      : column.format === "drawdown" ? `−${(value * 100).toFixed(0)}%`
      : percent(value);
    return <td key={column.key} title={place ? `${column.label}: ${place.rank} of ${place.of} loaded companies` : column.hint}>{text}{place && place.of >= 5 && <small className="rank-badge">{place.rank}/{place.of}</small>}</td>;
  };
  async function loadAll() {
    const targets = watchlist.filter((company) => company.resolutionStatus !== "unresolved" && !datasets[company.ticker]).map((company) => company.ticker);
    if (!targets.length) { setBulkState({ running: false, done: 0, total: 0, failed: 0 }); return; }
    let cursor = 0; let failed = 0; const retryable: string[] = [];
    setBulkState({ running: true, done: 0, total: targets.length, failed: 0 });
    const worker = async () => {
      while (cursor < targets.length) {
        const ticker = targets[cursor++]; setBulkLoading((current) => new Set(current).add(ticker));
        try { await onLoad(ticker); } catch { retryable.push(ticker); }
        finally {
          setBulkLoading((current) => { const next = new Set(current); next.delete(ticker); return next; });
          setBulkState((current) => ({ ...current, done: current.done + 1, failed }));
        }
      }
      // A refused company is almost always a busy isolate rather than a broken
      // filing, and the isolate needs a moment to be replaced. Retrying
      // instantly asks the same exhausted instance the same question, which is
      // why a whole batch used to come back as failures; a pause and two
      // further rounds recover nearly all of them.
      for (let round = 0; round < 2 && retryable.length; round++) {
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (round + 1)));
        for (const ticker of retryable.splice(0)) {
          setBulkLoading((current) => new Set(current).add(ticker));
          try { await onLoad(ticker); } catch { retryable.push(ticker); }
          finally {
            setBulkLoading((current) => { const next = new Set(current); next.delete(ticker); return next; });
          }
        }
      }
      failed = retryable.length;
      setBulkState((current) => ({ ...current, failed }));
    };
    // One at a time. Normalizing a company costs enough CPU that parallel
    // loads used to be refused outright by the platform, failing most of the
    // batch. Sequential is slower and finishes.
    await worker();
    setBulkState((current) => ({ ...current, running: false, failed }));
  }
  return <div><header className="page-heading"><div><h1>Watchlist</h1><p>{watchlist.length} companies in your local watchlist · ranked by {sort.key} {sort.direction === "desc" ? "descending" : "ascending"}.</p>{bulkState.total > 0 && <small>{bulkState.running ? `Loading all companies: ${bulkState.done}/${bulkState.total}` : `Load all finished: ${bulkState.done - bulkState.failed} loaded${bulkState.failed ? `, ${bulkState.failed} failed` : ""}`}</small>}</div><div className="company-title-actions"><button disabled={bulkState.running} onClick={() => void loadAll()}>{bulkState.running ? `Loading ${bulkState.done}/${bulkState.total}…` : "Load all"}</button><button onClick={onSearchAdd}>Add company</button></div></header>
    <details className="company-filters"><summary>Filters</summary><section className="list-tools"><label>Search by ticker<input type="search" value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="AAPL"/></label><label>Minimum Market Cap ($bn)<input type="number" value={filters.minimumMarketCap == null ? "" : filters.minimumMarketCap / 1_000_000_000} onChange={(event) => setNumericFilter("minimumMarketCap", event.target.value, 1_000_000_000)}/></label><label>Minimum FCF Margin (%)<input type="number" value={filters.minimumFcfMargin == null ? "" : filters.minimumFcfMargin * 100} onChange={(event) => setNumericFilter("minimumFcfMargin", event.target.value, .01)}/></label><label>Minimum FCF/share CAGR 5Y (%)<input type="number" value={filters.minimumFcfShareCagr == null ? "" : filters.minimumFcfShareCagr * 100} onChange={(event) => setNumericFilter("minimumFcfShareCagr", event.target.value, .01)}/></label><label>Maximum Dilution 5Y (%)<input type="number" value={filters.maximumDilution == null ? "" : filters.maximumDilution * 100} onChange={(event) => setNumericFilter("maximumDilution", event.target.value, .01)}/></label><button onClick={() => setFilters(DEFAULT_COMPANY_FILTERS)}>Reset filters</button></section></details>
    <details className="scatter-panel"><summary>Quality vs price<small>{rows.length} companies</small></summary>
      <Suspense fallback={<Skeleton label="the quality-versus-valuation scatter" chart height={340}/>}><QualityValuationScatter rows={rows} onOpen={onOpen}/></Suspense>
    </details>
    <details className="column-picker"><summary>Columns<small>{shownColumns.length} of {COMPANY_COLUMNS.length}</small></summary>
      <div>{COMPANY_COLUMNS.map((column) => <label key={column.key} title={column.hint}>
        <input type="checkbox" checked={columns.includes(column.key)} onChange={(event) => setColumns((current) => event.target.checked ? [...current, column.key] : current.filter((key) => key !== column.key))}/>
        {column.label}
      </label>)}</div>
      <div className="column-picker-actions"><button onClick={() => setColumns(DEFAULT_COLUMNS)}>Reset to default</button><button onClick={() => setColumns(COMPANY_COLUMNS.map((column) => column.key))}>Show all</button></div>
    </details>
    <div className="table-scroll"><table className="watchlist-table ranking-table"><thead><tr><th>Rank</th><th>{heading("Ticker", "ticker")}</th>{shownColumns.map((column) => <th key={column.key} title={column.hint}>{heading(column.label, column.key)}</th>)}<th>{heading("Updated", "updated")}</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.ticker} className={row.ticker === activeTicker ? "selected-row" : ""}><td className="rank-cell">{index + 1}</td><th><button className="text-button" onClick={() => onOpen(row.ticker)}>{row.ticker}</button><small>{row.profile.currency} · {row.profile.exchange}</small><div className="ticker-actions"><button onClick={() => onCharts(row.ticker)}>Charts</button><button onClick={() => onRemove(row.ticker)}>Remove</button></div></th>{shownColumns.map((column) => formatCell(row, column))}<td title={row.updated ? undefined : missingReason(row, "Updated")}>{row.loading ? "Loading…" : row.updated ?? "—"}</td></tr>)}</tbody></table></div>{!rows.length && <p className="simple-state">No companies match the active filters.</p>}</div>;
}

/**
 * The two valuation models, side by side as tabs.
 *
 * The reverse model leads because it asks fewer questions and every one of them
 * is a question a shareholder can hold an opinion about. The full FCFF model
 * stays a click away for anyone who wants to build the cash flows up from
 * revenue and discount them at a cost of capital.
 */
function CompanyPage({ dataset, theme, watchlist, datasets, tab, onTab, onBack, onCharts, onLoad }: {
  dataset: CompanyDataset; theme: ThemeName;
  watchlist: CompanyProfile[]; datasets: Record<string, CompanyDataset>;
  /* The open tab lives in the shell, so it can be read from and written to the
     address bar: a link to a company's valuation is a link people send. */
  tab: CompanyTab; onTab: (tab: CompanyTab) => void;
  onBack: () => void;
  onCharts: (ticker?: string, metric?: string, presentation?: { style?: SeriesStyle; frequency?: SeriesFrequency }) => void;
  onLoad: (ticker: string) => Promise<CompanyDataset | undefined>;
}) {
  const [periodicity, setPeriodicity] = useState<Periodicity>(() => typeof window === "undefined" ? "annual" : (localStorage.getItem("finscope.periodicity") as Periodicity) || "annual");
  const [price, setPrice] = useState<PricePoint | null>(null); const [priceError, setPriceError] = useState(""); const [evidence, setEvidence] = useState<Evidence | null>(null);
  // Which discounted-cash-flow model the Valuation tab is showing.
  const [model, setModel] = useState<"reverse" | "fcff">("reverse");
  useEffect(() => { localStorage.setItem("finscope.periodicity", periodicity); }, [periodicity]);
  useEffect(() => { let active = true; getJson<PricePoint>(`/api/price/${dataset.company.ticker}?date=${new Date().toISOString().slice(0, 10)}`, { what: "the share price" }).then((payload) => { if (active) setPrice(payload); }).catch((cause) => active && setPriceError(cause instanceof Error ? cause.message : "The share price is unavailable.")); return () => { active = false; }; }, [dataset.company.ticker]);
  const selected = sortedPeriods(dataset, periodicity); const latest = latestPeriod(dataset); const annual = sortedPeriods(dataset, "annual");
  const fixture = dataset.warnings.some((warning) => warning.startsWith("Offline fixture:"));
  // The statement diagrams are drawn from the last complete fiscal year, not
  // from a trailing window: a Sankey of TTM figures would mix four filings and
  // could not be checked against any single one of them.
  const lastFullYear = annual.at(-1);
  const incomeFlow = lastFullYear ? incomeStatementDiagram(lastFullYear) : null;
  const balanceFlow = lastFullYear ? balanceSheetDiagram(lastFullYear) : null;
  const cashFlow = lastFullYear ? cashFlowDiagram(lastFullYear) : null;
  if (!latest) return <p className="simple-state">No data available</p>;
  /*
   * The headline figures, or the reason there are none.
   *
   * A market capitalisation is a price times a share count, and both halves can
   * be wrong in ways that look right: ASML's shares are quoted in dollars while
   * its books are kept in euros, and most filers publish no period-end share
   * count in this feed at all. `marketBasis` answers both questions once, for
   * every screen, and refuses rather than mixing.
   */
  const priced = marketBasis(latest, price); const basis = priced.basis; const marketCap = basis?.marketCap ?? null;
  const openMetric = (metric: string, period = latest) => setEvidence({ label: METRICS[metric]?.label ?? metric, value: derivedValue(period, metric), period, metric });
  return <div className="company-page">
    <button className="back-button" onClick={onBack}>← Companies</button>
    <header className="company-title">
      <div>
        <h1>{dataset.company.name}</h1>
        {/* A sector we do not know is not a sector called "Unclassified". */}
        <p>{[dataset.company.ticker, dataset.company.exchange, dataset.company.sector].filter((part) => part && part !== "Unclassified").join(" · ")}</p>
      </div>
      <div className="company-title-actions">
        <button className="button-primary" onClick={() => onCharts(dataset.company.ticker)}>Open in Charts</button>
        <button onClick={() => onTab("valuation")}>Value it</button>
      </div>
    </header>

    {/*
      * Three levels of density, in the order a reader wants them.
      *
      * This was four cards of equal weight: the share price, the market
      * capitalisation, the currency — which the line above already states — and
      * a bare period end date labelled "Latest period". Nothing was more
      * important than anything else, and the one thing a reader of an auditable
      * research tool most wants at the top of a company, which filing this is
      * and when it was read, was reduced to "Updated 2026-08-25" in the
      * subtitle: a date about us rather than about the company.
      */}
    <div className="company-headline">
      <div className="company-figure">
        <span>Share price</span>
        <strong>{priceError ? <em className="figure-missing">Unavailable</em> : price ? currency(price.priceClose ?? price.close, price.currency) : <span className="figure-waiting" role="status" aria-label="Loading the share price"/>}</strong>
      </div>
      <div className="company-figure quiet">
        <span>Market cap</span>
        <strong>{marketCap == null && price == null && !priceError ? <span className="figure-waiting" role="status" aria-label="Loading the market capitalisation"/> : marketCap == null ? <em className="figure-missing">Unavailable</em> : currency(marketCap, dataset.company.currency)}</strong>
        {/* Never a bare dash where a figure was withheld: the reason is the
            point, and it is the same sentence every other screen gives. */}
        {marketCap == null && (price != null || priceError) && <small>{priceError || priced.reason}</small>}
        {/* The long form of this is in the Statistics panel, on the row that
            states the same figure; here it is one line under the number. */}
        {basis?.sharesBasis === "diluted" && <small>On the diluted weighted average: the filer publishes no period-end share count.</small>}
      </div>
      <p className="company-provenance">
        {latest.periodicity === "ttm" ? <>Latest calculated period <b>{latest.label}</b>, through {readableDate(latest.periodEnd)}.</> : <>Latest filing period <b>{latest.label}</b>, to {readableDate(latest.periodEnd)}.</>}
        {fixture ? <> Offline fixture from SEC facts, frozen on {readableDate(dataset.retrievedAt)}.</> : <> Read from SEC EDGAR on {readableDate(dataset.retrievedAt)}.</>}
        {dataset.company.cik && <> <a href={edgarUrl(dataset.company.cik)} target="_blank" rel="noreferrer">See the filings</a></>}
      </p>
    </div>

    <nav className="company-tabs" aria-label="Company sections">
      {COMPANY_TABS.map((item) => <button key={item.key} type="button" className={tab === item.key ? "active" : ""} aria-current={tab === item.key} onClick={() => onTab(item.key)}>{item.label}</button>)}
    </nav>

    {tab === "overview" && <div className="company-block">
      <section id="overview" className="plain-section"><SectionTitle title="Overview" onCharts={() => onCharts(dataset.company.ticker)}/>
      <Suspense fallback={<SkeletonCards label="the overview charts" count={4} height={220}/>}><CompanyKpiGrid dataset={dataset} theme={theme} onOpenMetric={(metric, presentation) => onCharts(dataset.company.ticker, metric, presentation)}/></Suspense>
      <h3 className="kpi-table-heading">Latest figures</h3><MetricSummaryTable dataset={dataset} price={price} onOpen={openMetric} onCharts={(metric) => onCharts(dataset.company.ticker, metric)}/></section>
    </div>}

    {/* A balance sheet is a statement, so it stopped being a seventh tab of its
        own and became the end of this one — the diagram and the detail behind
        it, in that order, rather than two destinations for one document. */}
    {tab === "statements" && <div className="company-block">
      <section id="flows" className="plain-section"><SectionTitle title="Statements" onCharts={() => onCharts(dataset.company.ticker, "revenue")}/>
      <p className="section-note">The latest reported fiscal year, drawn as the flow it describes. Every ribbon is a filed figure or a subtraction from one.</p>
      <Suspense fallback={<Skeleton label="the statement diagrams" chart height={300}/>}>
        {incomeFlow ? <StatementSankey diagram={incomeFlow} title="Income statement"/> : <p className="simple-state">The latest year does not carry enough reported lines to draw an income statement.</p>}
        {cashFlow ? <StatementSankey diagram={cashFlow} title="Cash flow"/> : <p className="simple-state">The latest year does not carry a reported operating cash flow.</p>}
        {balanceFlow ? <StatementSankey diagram={balanceFlow} title="Balance sheet"/> : <p className="simple-state">The latest year does not carry a reported total for assets.</p>}
      </Suspense></section>
      <section id="balance" className="plain-section"><SectionTitle title="Balance sheet in detail" onCharts={() => onCharts(dataset.company.ticker, "totalAssets")}/>
      <p className="section-note">What the company owns, what it owes, and whether the difference is comfortable. A quality business with a fragile balance sheet is a different proposition.</p>
      <Suspense fallback={<SkeletonTable label="the balance sheet"/>}><BalanceSheetPanel dataset={dataset}/></Suspense></section>
    </div>}

    {tab === "statistics" && <Suspense fallback={<SkeletonTable label="the statistics panel" rows={12}/>}>
      <CompanyStatisticsTab dataset={dataset} price={price} watchlist={watchlist} datasets={datasets} onLoad={onLoad}/>
    </Suspense>}

    {tab === "financials" && <div className="company-block">
      <section id="financials" className="plain-section"><div className="section-heading"><h2>Financials</h2><div className="period-buttons">{(["annual", "quarterly", "ttm"] as Periodicity[]).map((item) => <button className={periodicity === item ? "active" : ""} key={item} onClick={() => setPeriodicity(item)}>{item === "ttm" ? "TTM" : item[0].toUpperCase() + item.slice(1)}</button>)}</div></div>{selected.length ? <SimpleFinancialTable periods={selected.slice(-10)} metrics={[...VIEW_METRICS.income, ...VIEW_METRICS.cashflow.slice(0, 4)]} onOpen={openMetric} onCharts={(metric) => onCharts(dataset.company.ticker, metric)} currencyCode={dataset.company.currency}/> : <p className="simple-state">No data available for {periodicity}.</p>}</section>
      <section id="pershare" className="plain-section"><SectionTitle title="Per Share" onCharts={() => onCharts(dataset.company.ticker, "freeCashFlowPerShare")}/>
      <p className="section-note">Every figure divided by the diluted weighted average share count, so growth is what an owner actually kept after dilution.</p>
      {annual.some((period) => derivedValue(period, "revenuePerShare") != null)
        ? <><CurrentAndAverageTable periods={annual} metrics={[...VIEW_METRICS.pershare]} onOpen={openMetric} onCharts={(metric) => onCharts(dataset.company.ticker, metric)} currencyCode={dataset.company.currency}/>
          <div className="table-scroll pershare-history"><SimpleFinancialTable periods={annual.slice(-10)} metrics={[...VIEW_METRICS.pershare]} onOpen={openMetric} onCharts={(metric) => onCharts(dataset.company.ticker, metric)} currencyCode={dataset.company.currency}/></div></>
        : <p className="simple-state">No per-share figures: {dataset.company.name} publishes no combined diluted share count. Companies with several share classes tag each class separately, and the SEC endpoint carries only undimensioned facts.</p>}
    </section>
      <section id="margins" className="plain-section"><SectionTitle title="Margins" onCharts={() => onCharts(dataset.company.ticker, "freeCashFlowMargin")}/><CurrentAndAverageTable periods={annual} metrics={[...VIEW_METRICS.margins]} onOpen={openMetric} onCharts={(metric) => onCharts(dataset.company.ticker, metric)} currencyCode={dataset.company.currency}/></section>
      <section id="capital" className="plain-section"><SectionTitle title="Capital Allocation" onCharts={() => onCharts(dataset.company.ticker, "dilutedShares")}/><CurrentAndAverageTable periods={annual} metrics={["dilutedShares", "shareCountChange", "shareRepurchases", "shareIssuance", "dividendsPaid", "stockBasedCompensation"]} onOpen={openMetric} onCharts={(metric) => onCharts(dataset.company.ticker, metric)} currencyCode={dataset.company.currency}/></section>
      <section id="growth" className="plain-section"><SectionTitle title="Growth & Cash Quality" onCharts={() => onCharts(dataset.company.ticker, "freeCashFlowPerShare")}/><GrowthQuality dataset={dataset} annual={annual}/></section>
    </div>}

    {/* What the market charges today against what it has charged, and then the
        model where you decide what it is worth. Both were destinations before:
        a Valuation tab that stated one multiple, and a DCF page in the main
        navigation that was keyed on this very company. */}
    {tab === "valuation" && <div className="company-block">
      <section id="valuation" className="plain-section"><SectionTitle title="Valuation" onCharts={() => onCharts(dataset.company.ticker, "stockPrice")}/><ValuationTable dataset={dataset} price={price}/></section>
      <section id="dcf" className="plain-section">
        <div className="section-heading">
          <h2>Discounted cash flow</h2>
          <div className="segmented">
            <button className={model === "reverse" ? "active" : ""} onClick={() => setModel("reverse")}>Reverse DCF</button>
            <button className={model === "fcff" ? "active" : ""} onClick={() => setModel("fcff")}>Full DCF</button>
          </div>
        </div>
        <p className="section-note">Every assumption is yours; every historical figure behind it is traceable.</p>
        <Suspense fallback={<Skeleton label="the valuation model" chart height={360}/>}>
          {model === "reverse"
            ? <FcfYieldCalculator
                // The server renders a fixture and live filings replace it
                // moments later. The calculator seeds its inputs once from the
                // dataset, so it has to be rebuilt when the dataset underneath
                // it changes — otherwise it keeps offering the fixture's cash
                // flow to edit.
                key={`${dataset.company.ticker}:${dataset.retrievedAt}`}
                dataset={dataset} price={price} theme={theme}/>
            : <DcfValuation dataset={dataset}/>}
        </Suspense>
      </section>
    </div>}

    {tab === "sources" && <section id="sources" className="plain-section"><h2>Sources & Data Quality</h2><div className="table-scroll"><table><tbody><tr><th>Fundamentals</th><td>SEC EDGAR Company Facts</td></tr><tr><th>Market data</th><td>Split-adjusted closing prices</td></tr><tr><th>Validation</th><td>{dataset.quality?.lastValidatedAt?.slice(0, 10) ?? dataset.retrievedAt.slice(0, 10)}</td></tr><tr><th>Coverage</th><td>{dataset.quality?.coverage.map((item) => `${item.periodicity}: ${item.periodCount}`).join(" · ") ?? `${dataset.periods.length} periods`}</td></tr></tbody></table></div>{dataset.warnings.length ? <ul>{dataset.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>No active data warnings.</p>}</section>}
    {evidence && <EvidenceDialog evidence={evidence} onClose={() => setEvidence(null)}/>}
  </div>;
}

/**
 * The metric's name opens it in Charts; its value opens the provenance drawer.
 *
 * Reading a figure and asking "what has this done over time" is the common
 * move, so the name goes there. The audit trail stays one click away on the
 * number itself, which is what someone questioning the figure clicks anyway.
 */
function MetricName({ metric, label, onCharts, onOpen }: { metric: string; label: string; onCharts?: (metric: string) => void; onOpen: () => void }) {
  if (onCharts && CHARTABLE_METRICS.has(metric)) {
    return <button className="text-button" title={`Open ${label} in Charts`} onClick={() => onCharts(metric)}>{label}</button>;
  }
  return <button className="text-button" title={`Show where ${label} comes from`} onClick={onOpen}>{label}</button>;
}

function SectionTitle({ title, onCharts }: { title: string; onCharts: () => void }) { return <div className="section-heading"><h2>{title}</h2><button onClick={onCharts}>Open in Charts</button></div>; }

function MetricSummaryTable({ dataset, price, onOpen, onCharts }: { dataset: CompanyDataset; price: PricePoint | null; onOpen: (metric: string) => void; onCharts: (metric: string) => void }) {
  // Diluted shares stay the row's own subject, but the multiple below is built
  // on the same basis as Statistics and Valuation — and refuses a negative free
  // cash flow, which this table used to divide into and print.
  const latest = latestPeriod(dataset)!; const annual = sortedPeriods(dataset, "annual"); const previous = annual.at(-2); const latestAnnual = annual.at(-1); const shares = derivedValue(latest, "dilutedShares"); const marketCap = marketBasis(latest, price).basis?.marketCap ?? null; const pfcf = multipleOf(marketCap, derivedValue(latest, "freeCashFlow"));
  const metrics: Array<[string, number | null, string]> = [
    ["Revenue", derivedValue(latest, "revenue"), "revenue"], ["Revenue growth", latestAnnual && previous ? change(derivedValue(latestAnnual, "revenue"), derivedValue(previous, "revenue")) : null, "revenueGrowth"],
    ["Operating margin", derivedValue(latest, "operatingMargin"), "operatingMargin"], ["Free cash flow", derivedValue(latest, "freeCashFlow"), "freeCashFlow"], ["FCF margin", derivedValue(latest, "freeCashFlowMargin"), "freeCashFlowMargin"],
    ["FCF / share", derivedValue(latest, "freeCashFlowPerShare"), "freeCashFlowPerShare"], ["FCF / share CAGR 5Y", cagrForPeriods(annual, "freeCashFlowPerShare", 5).value, "freeCashFlowPerShareCagr"], ["EPS", derivedValue(latest, "netIncomePerShare"), "netIncomePerShare"],
    ["Diluted shares", shares, "dilutedShares"], ["Dilution 5Y", annual.length > 5 ? change(derivedValue(annual.at(-1)!, "dilutedShares"), derivedValue(annual.at(-6)!, "dilutedShares")) : null, "shareCountChange"], ["ROIC", derivedValue(latest, "roic"), "roic"], ["P / FCF", pfcf, "priceToFreeCashFlow"],
  ];
  return <div className="table-scroll"><table><thead><tr><th>Metric</th><th>Current</th><th>Period</th></tr></thead><tbody>{metrics.map(([label, value, metric]) => <tr key={label}><th><MetricName metric={metric} label={label} onCharts={onCharts} onOpen={() => onOpen(metric)}/></th><td>{METRICS[metric]?.kind === "percent" || metric.toLowerCase().includes("growth") || metric.toLowerCase().includes("cagr") || metric.toLowerCase().includes("margin") || metric === "shareCountChange" || metric === "roic" ? percent(value) : metric === "priceToFreeCashFlow" ? ratio(value) : metric === "dilutedShares" ? number(value) : currency(value, dataset.company.currency)}</td><td>{latest.periodEnd}</td></tr>)}</tbody></table></div>;
}

function SimpleFinancialTable({ periods, metrics, onOpen, onCharts, currencyCode }: { periods: FinancialPeriod[]; metrics: string[]; onOpen: (metric: string, period: FinancialPeriod) => void; onCharts: (metric: string) => void; currencyCode: string }) { return <div className="table-scroll"><table><thead><tr><th>Metric</th>{periods.map((period) => <th key={period.periodEnd}>{period.label}<small>{period.periodEnd}</small></th>)}</tr></thead><tbody>{metrics.map((metric) => <tr key={metric}><th><MetricName metric={metric} label={METRICS[metric]?.label ?? metric} onCharts={onCharts} onOpen={() => onOpen(metric, periods.at(-1)!)}/></th>{periods.map((period) => <td key={period.periodEnd}><button className="value-button" onClick={() => onOpen(metric, period)}>{metricDisplay(derivedValue(period, metric), metric, currencyCode)}</button></td>)}</tr>)}</tbody></table></div>; }

function GrowthQuality({ dataset, annual }: { dataset: CompanyDataset; annual: FinancialPeriod[] }) {
  const [bars, setBars] = useState<Array<{ date: string; value: number }> | null>(null);
  useEffect(() => {
    let active = true;
    const earliest = annual[0]?.periodEnd ?? `${new Date().getUTCFullYear() - 11}-01-01`;
    getJson<{ bars?: Array<{ date: string; close: number; adjustedClose: number | null }> }>(`/api/market/${encodeURIComponent(dataset.company.ticker)}?start=${earliest}&end=${new Date().toISOString().slice(0, 10)}&frequency=monthly`, { what: "the share price history" })
      .then((payload) => {
        if (active) setBars((payload.bars ?? []).flatMap((bar) => { const value = bar.adjustedClose ?? bar.close; return value == null ? [] : [{ date: bar.date, value }]; }));
      }).catch(() => active && setBars([]));
    return () => { active = false; };
  }, [dataset.company.ticker, annual]);

  const rows = growthTable(annual);
  // Share price compounds on trading dates, so it is measured against the real
  // session nearest each anniversary rather than a fiscal year end.
  const priceCagr = (horizon: Horizon) => {
    if (!bars?.length) return { value: null, reason: bars ? "Market history unavailable" : "Loading" };
    const end = bars.at(-1)!;
    const target = `${Number(end.date.slice(0, 4)) - horizon}${end.date.slice(4)}`;
    const start = bars.find((bar) => bar.date >= target);
    if (!start || start.date > `${Number(target.slice(0, 4)) + 1}${target.slice(4)}`) return { value: null, reason: `Only ${((Date.parse(end.date) - Date.parse(bars[0].date)) / (365.2425 * 86_400_000)).toFixed(0)} years of prices` };
    return { value: cagrBetweenDates(start.value, end.value, start.date, end.date).value, reason: undefined };
  };
  const [pinned, setPinned] = useState<string[]>(() => {
    if (typeof window === "undefined") return DEFAULT_CALLOUTS;
    try {
      const saved = JSON.parse(localStorage.getItem("finscope.callouts") ?? "null") as string[] | null;
      return Array.isArray(saved) ? saved.filter((id) => CALLOUTS.some((item) => item.id === id)) : DEFAULT_CALLOUTS;
    } catch { return DEFAULT_CALLOUTS; }
  });
  useEffect(() => { localStorage.setItem("finscope.callouts", JSON.stringify(pinned)); }, [pinned]);
  const shown = CALLOUTS.filter((item) => pinned.includes(item.id));

  return <>
    <div className="table-scroll"><table><thead><tr><th>Compound annual growth</th>{HORIZONS.map((horizon) => <th key={horizon}>{horizon}Y</th>)}</tr></thead><tbody>
      {rows.filter((row) => row.metric !== "stockPrice").map((row) => <tr key={row.metric}><th>{row.label}</th>{HORIZONS.map((horizon) => {
        const item = row.cells[horizon];
        return <td key={horizon} title={item.reason}>{item.value == null ? "—" : percent(item.value)}</td>;
      })}</tr>)}
      <tr><th>Share price</th>{HORIZONS.map((horizon) => { const item = priceCagr(horizon); return <td key={horizon} title={item.reason}>{item.value == null ? item.reason === "Loading" ? "…" : "—" : percent(item.value)}</td>; })}</tr>
    </tbody></table></div>

    {shown.length > 0 && <div className="quality-callouts">{shown.map((item) => {
      const result = item.compute(annual);
      return <div key={item.id}><dt>{item.label}</dt><dd>{result.display}</dd><small>{result.note}</small></div>;
    })}</div>}

    <details className="callout-picker"><summary>Pinned measures<small>{shown.length} of {CALLOUTS.length}</small></summary>
      <div>{CALLOUTS.map((item) => <label key={item.id}>
        <input type="checkbox" checked={pinned.includes(item.id)} onChange={(event) => setPinned((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}/>
        {item.label}
      </label>)}</div>
      <small>Kept for every company you open.</small>
    </details>
  </>;
}


function CurrentAndAverageTable({ periods, metrics, onOpen, onCharts, currencyCode }: { periods: FinancialPeriod[]; metrics: string[]; onOpen: (metric: string, period: FinancialPeriod) => void; onCharts: (metric: string) => void; currencyCode: string }) {
  const latest = periods.at(-1); if (!latest) return <p className="simple-state">No data available</p>;
  return <div className="table-scroll"><table><thead><tr><th>Metric</th><th>Current</th><th>5Y average</th><th>Period</th></tr></thead><tbody>{metrics.map((metric) => { const values = periods.slice(-5).map((period) => derivedValue(period, metric)).filter((value): value is number => value != null && Number.isFinite(value)); const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; return <tr key={metric}><th><MetricName metric={metric} label={METRICS[metric]?.label ?? metric} onCharts={onCharts} onOpen={() => onOpen(metric, latest)}/></th><td>{metricDisplay(derivedValue(latest, metric), metric, currencyCode)}</td><td>{metricDisplay(average, metric, currencyCode)}</td><td>{latest.periodEnd}</td></tr>; })}</tbody></table></div>;
}

function ValuationTable({ dataset, price }: { dataset: CompanyDataset; price: PricePoint | null }) {
  const ttm = useMemo(() => sortedPeriods(dataset, "ttm"), [dataset]); const [points, setPoints] = useState<Record<string, PricePoint | null>>({}); const [error, setError] = useState(""); const dates = useMemo(() => [...new Set([...ttm.map((period) => period.filingDate), new Date().toISOString().slice(0, 10)])], [ttm]);
  useEffect(() => { let active = true; getJson<{ points?: Array<{ requestedDate: string; point?: PricePoint }> }>(`/api/prices/${dataset.company.ticker}?dates=${dates.join(",")}&published=1`, { what: "the valuation history" }).then((payload) => { if (active) setPoints(Object.fromEntries((payload.points ?? []).map((item) => [item.requestedDate, item.point ?? null]))); }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "The valuation history is unavailable.")); return () => { active = false; }; }, [dataset.company.ticker, dates]);
  const latest = currentDatasetPeriod(dataset); const current = latest && price ? valuationSnapshot(latest, price) : null; const history = buildValuationHistory(ttm, points); const stats = valuationStatistics(history, "priceToFreeCashFlow", current?.metrics.priceToFreeCashFlow ?? null, 5);
  if (error) return <p className="simple-state">{error}. Fundamental data remains available.</p>;
  // A row of dashes is not an answer. Where the multiple could not be struck —
  // a price in another currency, no readable share count — say which.
  const withheld = latest && price && !current ? marketBasis(latest, price).reason : undefined;
  return <><div className="table-scroll"><table><thead><tr><th>Metric</th><th>Current</th><th>AVG 5Y</th><th>Median 5Y</th><th>Premium / Discount</th><th>Percentile</th></tr></thead><tbody><tr><th>Price / Free cash flow</th><td>{ratio(stats.current)}</td><td>{ratio(stats.average)}</td><td>{ratio(stats.median)}</td><td>{percent(stats.premiumToAverage)}</td><td>{stats.percentile == null ? "—" : `${(stats.percentile * 100).toFixed(0)}%`}</td></tr></tbody></table></div>{withheld && <p className="simple-state">{withheld}</p>}</>;
}

function EvidenceDialog({ evidence, onClose }: { evidence: Evidence; onClose: () => void }) {
  const fact = evidence.period.facts[evidence.metric as MetricKey]; return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="evidence-title"><div className="section-heading"><h2 id="evidence-title">{evidence.label}</h2><button onClick={onClose}>Close</button></div><dl><div><dt>Value</dt><dd>{number(evidence.value)}</dd></div><div><dt>Source</dt><dd>{fact?.provenance.provider ?? "Calculated"}</dd></div><div><dt>Period</dt><dd>{evidence.period.periodEnd} · {evidence.period.periodicity}</dd></div><div><dt>Formula</dt><dd>{fact?.provenance.formula ?? METRICS[evidence.metric]?.formula ?? "Direct reported fact"}</dd></div><div><dt>Validation</dt><dd>{fact?.validation?.status ?? fact?.provenance.status ?? (evidence.value == null ? "Missing" : "Calculated and verified")}</dd></div></dl>{fact?.provenance.sourceUrl && <a href={fact.provenance.sourceUrl} target="_blank" rel="noreferrer">Open source</a>}</section></div>;
}

function SourcesPage({ tickers, onBack }: { tickers: string[]; onBack: () => void }) { return <div><header className="page-heading"><div><h1>Sources</h1><p>Data lineage, calculation policy, and a check that what you are reading is the latest filed.</p></div><button onClick={onBack}>Back</button></header>
  <Suspense fallback={<SkeletonTable label="the freshness check" rows={4}/>}><FreshnessCheck tickers={tickers}/></Suspense><section className="plain-section"><h2>Primary sources</h2><div className="table-scroll"><table><tbody><tr><th>Fundamentals</th><td><a href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces" target="_blank" rel="noreferrer">SEC EDGAR Company Facts</a></td></tr><tr><th>Market data</th><td>Split-adjusted closing prices, matched to an explicit session date</td></tr></tbody></table></div></section><section className="plain-section"><h2>Methodology</h2><p>Direct reported quarters are preferred. Derived quarters, TTM windows, per-share metrics and margins retain their formula and validation status. Chart fundamentals stay on their fiscal dates; market observations stay on their trading-session dates.</p></section></div>; }
