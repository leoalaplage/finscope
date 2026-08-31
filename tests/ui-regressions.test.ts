import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("UI regressions", () => {
  it("keeps the primary navigation intentionally limited", () => {
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    // The key stays "companies" on purpose: it is in every saved link.
    expect(source).toContain('{ key: "search", label: "Search" }, { key: "companies", label: "Watchlist" }, { key: "market", label: "Market" }, { key: "charts", label: "Charts" }, { key: "qs", label: "QS Screener" }');
    expect(source).not.toContain('label: "Data Quality"');
    expect(source).not.toContain('label: "Formula Audit"');
  });

  it("keeps everything about one company on that company's page", () => {
    /*
     * Statistics and DCF were destinations in the main navigation that both
     * showed the company you were already reading — the DCF page was literally
     * keyed on its ticker, and the Statistics tab rendered the very same panel
     * as the Statistics page, with a button between them that threw you from
     * one to the other.
     */
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    expect(source).toContain('type MainView = "search" | "companies" | "company" | "market" | "charts" | "qs"');
    expect(source).not.toContain("function DcfPage");
    expect(source).not.toContain("StatisticsPage");
    // Both live inside the company page now, and comparison happens there.
    expect(source).toContain("CompanyStatisticsTab");
    expect(source).toContain('{ key: "valuation", label: "Valuation" }');
    expect(source).toContain("FcfYieldCalculator");
    const tab = readFileSync(new URL("../components/CompanyStatisticsTab.tsx", import.meta.url), "utf8");
    // The open company is the first column and cannot be removed.
    expect(tab).toContain("const shown = [dataset, ...others]");
    expect(tab).toContain("company.ticker !== anchor");
  });

  it("reads the address bar as well as writing to it", () => {
    /*
     * Four calls wrote a ticker and a view into the URL and nothing read them
     * back, so a shared link opened the watchlist showing Apple, a refresh lost
     * the page, and Back did nothing at all.
     */
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    expect(source).toContain("function readRoute(");
    expect(source).toContain("readRoute(location.search)");
    expect(source).toContain('addEventListener("popstate", apply)');
    expect(source).toContain('removeEventListener("popstate", apply)');
    // Pushed, so Back retraces pages; the URL carries the company tab too.
    expect(source).toContain("history.pushState");
    expect(source).toContain('params.set("tab"');
    // Everything read out of the URL is checked against what it may be.
    expect(source).toContain("TICKER_PATTERN.test(ticker)");
    expect(source).toContain("COMPANY_TAB_KEYS.has(tab)");
    expect(source).toContain("NAV_KEYS.has(view)");
  });

  it("does not call a calculated TTM a filing or hide the offline fixture", () => {
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    expect(source).toContain("Latest calculated period");
    expect(source).toContain("Latest filing period");
    expect(source).toContain("Offline fixture from SEC facts");
    expect(source).toContain('if (route.ticker && route.ticker !== initialData.company.ticker) setView("search")');
    // A retry that keeps an existing fixture still reports the live failure.
    expect(source).toContain('catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load company"); }');
  });

  it("gives a two-series card a key and one honest headline", () => {
    // Cash and debt were drawn in two colours the card never named, under a
    // number that was the cash alone and a CAGR that described only half of a
    // position. Hovering a bar was the only way to tell which was which.
    const source = readFileSync(new URL("../components/CompanyKpiGrid.tsx", import.meta.url), "utf8");
    expect(source).toContain('net: "netDebt"');
    expect(source).toContain('className="kpi-legend"');
    expect(source).toContain('net > 0 ? "Net debt" : "Net cash"');
    // No badge on a paired card: the summary is computed only without a pair.
    expect(source).toContain("const summary = card.pair ? null :");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain(".kpi-legend {");
  });

  it("puts the market beside the filings on the overview, and lets it reach ten years", () => {
    const source = readFileSync(new URL("../components/CompanyKpiGrid.tsx", import.meta.url), "utf8");
    expect(source).toContain('{ metric: "stockPrice", title: "Share price", kind: "candles" }');
    expect(source).toContain('{ metric: "freeCashFlowYield", title: "FCF yield", kind: "market" }');
    expect(source).toContain('{ id: "10Y", years: 10 }');
    // Green against red is a CVD warning, not a pass, so the body carries the
    // direction too: hollow rising, solid falling.
    expect(source).toContain('fill={rising ? "var(--card)" : colour}');
  });

  it("puts what chooses the view in the toolbar and what tunes it behind one line", () => {
    /*
     * An early version put presets, panels, scale, layout, four checkboxes and
     * a per-series grid above the first plot — seven rows of controls between
     * a reader and the company they came to look at. Moving all of it below
     * the chart fixed that and created another problem: the three controls
     * that change what the chart *is* were two screens from the chart.
     *
     * The split is by what a control does, not by where it sits. Panels, scale
     * and layout are buttons in the toolbar; the rest is a disclosure that is
     * one line high until it is opened.
     */
    const source = readFileSync(new URL("../components/ChartsWorkspace.tsx", import.meta.url), "utf8");
    const toolbar = source.indexOf('className="chart-toolbar"');
    const chart = source.indexOf('className={`chart-stack');
    for (const control of ['aria-label="Panels"', 'aria-label="Scale"', 'aria-label="Layout"']) {
      const at = source.indexOf(control);
      expect(at, control).toBeGreaterThan(toolbar);
      expect(at, control).toBeLessThan(chart);
    }
    // Buttons, not selects: a button shows its state without being opened.
    expect(source).not.toContain("event.target.value as ScaleMode");
    expect(source).not.toContain("event.target.value as LayoutMode");
    // Everything else stays behind a disclosure, so the plot is still near the
    // top of the page.
    expect(source).toContain('<details className="chart-settings">');
    for (const control of ['className="chart-presets"', 'className="chart-appearance"', 'className="series-options"']) {
      expect(source.indexOf(control)).toBeGreaterThan(source.indexOf('<details className="chart-settings">'));
    }
    // What names the subject stays above it.
    expect(source.indexOf('aria-label="Companies on this chart"')).toBeLessThan(chart);
    expect(source.indexOf('aria-label="Metrics on this chart"')).toBeLessThan(chart);
  });

  it("offers candles and a session length on the price series only", () => {
    const source = readFileSync(new URL("../components/ChartsWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain('const market = MARKET_SERIES_METRICS.has(metric);');
    expect(source).toContain('["daily", "D", "Daily sessions"]');
    expect(source).toContain('["monthly", "M", "Monthly sessions"]');
    // Hollow rising, solid falling: green against red is a CVD warning.
    expect(source).toContain('fill={rising ? "var(--card)" : colour}');
  });

  it("names no market-data vendor in the interface", () => {
    // The provider is an implementation detail of the adapter, not something a
    // reader of a research page needs told on six different screens.
    for (const file of ["FinanceApp", "MarketPage", "ChartsWorkspace", "DcfValuation", "CompanyManager", "FormulaDataAudit"]) {
      const source = readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8");
      expect(source, `${file} still names the vendor`).not.toContain("Yahoo Finance");
    }
  });

  it("sets the interface in SF Pro, the way SF Pro is meant to be set", () => {
    /*
     * On Apple platforms `-apple-system` resolves to SF Pro; it cannot be
     * self-hosted, because Apple licenses it for building software for its own
     * platforms rather than for redistribution from a web server. What was
     * missing was never the font — it was the treatment: SF Pro is drawn
     * tighter as it grows, and setting it without that is the one thing that
     * makes an interface using it look like an interface that is not.
     */
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("--sans: -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"SF Pro Display\"");
    expect(css).toContain("font-family: var(--sans)");
    expect(css).toContain("--track-display:");
    expect(css).toContain("letter-spacing: var(--track-display)");
    // Every figure here belongs to a column of figures.
    expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(css).toContain(".recharts-default-tooltip { color: var(--text)");
  });

  it("draws straight lines and never asks the reader to configure the chart", () => {
    const source = readFileSync(new URL("../components/ChartsWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain('type="linear" connectNulls isAnimationActive={false}');
    for (const removed of ["AdvancedSettings", "AxisSettings", "SeriesSettings", "Saved layouts", "unitsMode", "rollingWindow"]) {
      expect(source).not.toContain(removed);
    }
  });

  it("loads every company referenced by a chart instead of leaving it loading", () => {
    const source = readFileSync(new URL("../components/ChartsWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain("const requiredTickers =");
    expect(source).toContain("/api/company/${encodeURIComponent(ticker)}");
  });

  it("keeps the Companies ranking columns focused on financial metrics", () => {
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    // The header is generated from the chosen columns now, so the guarantee
    // lives in the column catalogue rather than in the markup.
    const columns = readFileSync(new URL("../lib/company-ranking.ts", import.meta.url), "utf8");
    expect(columns).toContain('label: "Market Cap"');
    expect(columns).not.toContain('label: "Company"');
    expect(columns).not.toContain('label: "Price"');
    const header = source.match(/<table className="watchlist-table ranking-table">[\s\S]*?<\/thead>/)?.[0] ?? "";
    expect(header).toContain("Rank");
    expect(header).toContain("shownColumns.map");
    expect(source).toContain('localStorage.setItem("finscope.companySort"');
    expect(source).toContain('"Load all"');
  });
});

describe("the front page must not cost Worker CPU", () => {
  /**
   * A dynamic API anywhere in the root layout makes every page under it
   * dynamic, so the whole application tree gets server-rendered inside the
   * Worker on every single visit. That is what made the site answer "Worker
   * exceeded resource limits" rather than loading: reading one request header
   * to build an Open Graph URL cost 54ms of CPU per view instead of 1ms.
   */
  it("keeps request-time APIs out of the root layout", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).not.toMatch(/\bheaders\s*\(\s*\)/);
    expect(layout).not.toMatch(/\bcookies\s*\(\s*\)/);
    expect(layout).not.toMatch(/generateMetadata/);
    // The absolute origin a social preview needs comes from a constant instead.
    expect(layout).toContain("metadataBase");
  });

  it("keeps the home page static, since it renders a constant", () => {
    const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
    expect(page).toContain('export const dynamic = "force-static"');
  });

  /**
   * A prerendered document cannot know which theme this reader chose, so
   * nothing rendered from that choice may appear in the markup: React answers a
   * text mismatch by discarding the server tree and rendering the whole
   * application again on the client, which is exactly the cost the two rules
   * above exist to avoid. The attribute is stamped by a boot script instead,
   * and the one glyph that depends on it is drawn by the stylesheet.
   */
  it("keeps the reader's theme out of the prerendered markup", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain("THEME_BOOT");
    expect(layout).toContain('finscope.theme');
    // The boot script changes the attribute before hydration, which React
    // reports on `<html>` and will not patch up; suppressing it there keeps the
    // client's value and the console quiet. It covers that element only.
    expect(layout).toContain('<html lang="en" data-theme="dark" suppressHydrationWarning>');
    // The boot script sets the attribute only: an inline style on `<html>`
    // would be a second declaration competing with the stylesheet's own.
    const boot = layout.match(/const THEME_BOOT = `([^`]*)`/)?.[1] ?? "";
    expect(boot).toContain("dataset.theme");
    expect(boot).not.toContain("colorScheme");
    const app = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    expect(app).not.toContain('"☀"');
    expect(app).not.toContain("suppressHydrationWarning");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain('.theme-toggle::before { content: "☀"; }');
    expect(css).toContain(':root[data-theme="light"] .theme-toggle::before { content: "☾"; }');
  });
});

describe("the redesign", () => {
  it("lands on a search box and the watchlist, not a table of nineteen columns", () => {
    const home = readFileSync(new URL("../components/HomePage.tsx", import.meta.url), "utf8");
    expect(home).toContain("company-cards");
    expect(home).toContain("Search your watchlist");
    // The table is not gone, only moved off the front door.
    expect(home).toContain("onShowRanking");
  });

  it("reads a company as one block behind tabs rather than eleven stacked sections", () => {
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    expect(source).toContain("COMPANY_TABS");
    expect(source).toContain('className="company-block"');
    expect(source).not.toContain('className="anchor-nav"');
  });

  it("draws each overview card over the span it has, and leaves out one with nothing recent", () => {
    /*
     * Booking's gross-profit card drew eight quarters of bars and then eight
     * years of blank axis running to 2026, under a headline carrying no date.
     * A first attempt explained that in two sentences under the chart, which
     * is a paragraph of apology under a drawing that had already said it.
     */
    const grid = readFileSync(new URL("../components/CompanyKpiGrid.tsx", import.meta.url), "utf8");
    expect(grid).toContain("const drawn =");
    expect(grid).toContain("RETIRED_AFTER_YEARS");
    // The chart, the headline, the badge and the export all read the drawn
    // span, or one of them quotes a window the reader is not looking at.
    expect(grid).toContain("<BarChart data={drawn}");
    expect(grid).toContain("summariseSeries(drawn.map(");
    expect(grid).toContain("const latest = [...drawn].reverse()");
    expect(grid).toContain("SEC filings to ${drawn.at(-1)?.label");
    // No prose about the gap: the card is left out, or it draws its own span.
    // The class names, not the prose: the comment above the change quotes the
    // sentences it removed, which is exactly what a source-level test should
    // not trip over.
    expect(grid).not.toContain('className="kpi-coverage"');
    expect(grid).not.toContain('className="kpi-retired"');
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).not.toContain(".kpi-coverage");
    expect(css).not.toContain(".kpi-retired");
  });

  it("gives every overview chart a trend badge and its own PNG", () => {
    const grid = readFileSync(new URL("../components/CompanyKpiGrid.tsx", import.meta.url), "utf8");
    expect(grid).toContain("summariseSeries");
    expect(grid).toContain("exportSvgToPng");
    expect(grid).toContain("kpi-badge");
  });

  it("draws the QS Screener as a table rather than embedding a picture of one", () => {
    // The scores were painted onto a canvas inside an iframe: a reader could
    // not sort a column, select a figure, search the page or have it read out.
    const source = readFileSync(new URL("../components/QsScreener.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("<iframe");
    expect(source).not.toContain("postMessage");
    expect(source).toContain('className="qs-table"');
    // The engine is imported, not reimplemented.
    expect(source).toContain('from "@/lib/qs/screener"');
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).not.toContain(".qs-frame");
    expect(css).toContain(".qs-score span {");
  });

  it("draws the market session as a line rather than as candles", () => {
    // Three indices across a laptop leaves each panel about four hundred
    // pixels for seventy-eight five-minute bars: every body was a sliver and
    // every wick a hairline. The sequence of closes is what a reader could
    // actually make out, and that is what a line draws directly.
    const source = readFileSync(new URL("../components/MarketPage.tsx", import.meta.url), "utf8");
    expect(source).toContain('className="index-line"');
    expect(source).not.toContain("index-candle");
    expect(source).toContain("points.map((point) => point.close)");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    // Line, dot and badge take the panel's direction from one place.
    expect(css).toContain(".index-panel.up { color: var(--accent); }");
  });

  it("keeps the screener's table and its settings between visits", () => {
    // Pasting a hundred-row export is not something anyone wants to do twice,
    // and leaving the page used to unmount the component and lose all of it.
    const source = readFileSync(new URL("../components/QsScreener.tsx", import.meta.url), "utf8");
    expect(source).toContain('const STORAGE_KEY = "finscope.qs"');
    expect(source).toContain("localStorage.setItem(STORAGE_KEY");
    // Every column header orders the table, both ways.
    expect(source).toContain("SortableHeader");
    expect(source).toContain('aria-sort=');
    expect(source).toContain("sortRowsBy");
  });

  // The portfolio is out of the navigation for now, by request; its component
  // and its tests stay so it can come back without being rewritten.
  it.skip("states the portfolio's value and its return as separate answers", () => {
    // They differ by exactly the money paid in, and quoting either alone is how
    // a reader comes to believe a deposit was a good year.
    const source = readFileSync(new URL("../components/PortfolioPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("Change in value ·");
    expect(source).toContain("netContribution");
    expect(source).toContain("with deposits stripped out");
    // One window control, above the figures it governs.
    expect(source).toContain('className="portfolio-window"');
  });

  it("lets a chart fill the window, and draws it taller than a strip", () => {
    const source = readFileSync(new URL("../components/ChartsWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain("Full screen");
    expect(source).toContain('event.key === "Escape"');
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain(".chart-stack.expanded {");
    // A flex basis of zero here would beat the height and collapse the plot.
    expect(css).toContain(".chart-canvas { width: 100%; height: 540px;");
  });

  it("puts five-year figures on a watchlist card, and no price", () => {
    // A price is not a fact about a business, and fetching one per card cost up
    // to twenty-four requests to fill a column that answered nothing.
    const home = readFileSync(new URL("../components/HomePage.tsx", import.meta.url), "utf8");
    expect(home).toContain("freeCashFlowAfterSbcMargin5Y");
    expect(home).toContain("cashReturnOnCapital5Y");
    expect(home).toContain("freeCashFlowPerShareCagr5Y");
    expect(home).not.toContain("/api/price/");
    expect(home).not.toContain("Market cap");
  });

  it("names the reader's own companies when asking for digests, and fills a card from a dataset it already has", () => {
    // A company added by hand is in no list the server keeps, so asking for
    // "the watchlist" returned the built-in twenty-one and left the new card
    // reading "Financials not loaded" for ever — and showing three dashes even
    // once "Load all" had fetched its dataset, because the card read the stored
    // digest and nothing else.
    const home = readFileSync(new URL("../components/HomePage.tsx", import.meta.url), "utf8");
    expect(home).toContain("/api/watchlist?tickers=");
    expect(home).toContain("summariseDataset");
    expect(home).toContain("localDigests[company.ticker] ?? summaries?.[company.ticker]");
    // Asking once on mount is what left an added company out of every later
    // answer; the request has to follow the list.
    expect(home).toContain("}, [followed]);");
    for (const file of ["QsScreener"]) {
      const source = readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8");
      expect(source).toContain("/api/watchlist?tickers=");
    }
  });

  it("keeps one owner of the watchlist, so a company added in the dialog is still there afterwards", () => {
    // The dialog used to read the watchlist out of localStorage into a state of
    // its own and write it back. The application kept another under the same
    // key, so a company added here whose import then failed lived only in the
    // dialog's copy and was overwritten by the application's next save — gone
    // from the list before "Load all" could ever reach it.
    const manager = readFileSync(new URL("../components/CompanyManager.tsx", import.meta.url), "utf8");
    expect(manager).not.toContain('localStorage.getItem("finscope.watchlist")');
    expect(manager).not.toContain('localStorage.setItem("finscope.watchlist"');
    const app = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    expect(app).toContain("<CompanyManager watchlist={watchlist} setWatchlist={setWatchlist}");
    expect(app.match(/localStorage\.setItem\("finscope\.watchlist"/g)).toHaveLength(1);
  });

  it("gives the market page a window, and the panels nothing but their chart", () => {
    const source = readFileSync(new URL("../components/MarketPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("MARKET_RANGES");
    expect(source).toContain('/api/indices?range=');
    // The relative-volume gauge and its footnote are gone.
    expect(source).not.toContain("relativeVolume");
    expect(source).not.toContain("index-gauge");
  });

  it("draws the heat map without waiting to be measured", () => {
    /*
     * The map used to be positioned at the width the browser reported and drew
     * nothing until that arrived. A hidden tab lays nothing out and delivers
     * no resize observation, so a map mounted in one measured zero and stayed
     * empty for good — a middle click, or restoring a window full of tabs.
     * Nothing about a treemap's proportions needs pixels.
     */
    const source = readFileSync(new URL("../components/MarketHeatmap.tsx", import.meta.url), "utf8");
    expect(source).toContain("{ x: 0, y: 0, width: 100, height: 100 }");
    expect(source).toContain("`${group.rect.x}%`");
    // The measured width survives for one job only: whether a tile has room
    // for its ticker, where being wrong hides a label rather than the map.
    expect(source).toContain('const px = (share: number, axis: "x" | "y")');
    expect(source).toContain("width || 1100");
    expect(source).not.toContain("if (!priced.length || width <= 0) return [];");
  });

  it("measures the heat map again when the page becomes visible", () => {
    /*
     * A hidden tab lays nothing out and delivers no resize observation, so a
     * map mounted in a background tab measures zero width and the observer —
     * whose job is the changes — never corrects it, because nothing changes.
     * Opening the site with a middle click left an empty heat map that stayed
     * empty until the window was dragged.
     */
    const source = readFileSync(new URL("../components/MarketHeatmap.tsx", import.meta.url), "utf8");
    expect(source).toContain('document.addEventListener("visibilitychange", measure)');
    expect(source).toContain('document.removeEventListener("visibilitychange", measure)');
  });

  it("lets a crowded sector fill the heat map", () => {
    // Area is market value, so the smallest companies in the busiest sectors
    // come out a few pixels wide and carry neither name nor number.
    const source = readFileSync(new URL("../components/MarketHeatmap.tsx", import.meta.url), "utf8");
    expect(source).toContain("const [zoom, setZoom] = useState<string | null>(null)");
    expect(source).toContain('className="heat-sector-name"');
    expect(source).toContain('className="heat-zoom-out"');
    // Room, not a magnifier: the zoomed map is taller — and bounded, because
    // following the width unchecked made a fifteen-company sector a thousand
    // pixels tall, which is a scroll rather than a map.
    expect(source).toContain("Math.min(620, Math.max(380,");
  });

  it("states the index chart as performance, not as a level", () => {
    // "7,720" says nothing unless the reader already carries yesterday's close
    // in their head; "+0.3%" is the whole answer, and it is what the dashed
    // baseline already marks as zero.
    const source = readFileSync(new URL("../components/MarketPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("const toPercent =");
    expect(source).toContain("tickText");
    expect(source).toContain("index-grid-zero");
    // Without a baseline there is nothing to be a percentage of.
    expect(source).toContain("asPercent");
  });

  it("gives every one-of-N control inside the page the same track and thumb", () => {
    /*
     * Segmented groups, the time range and the period switch are the same
     * choice and look the same. The header's destinations no longer do: a pill
     * in a tray made the top-level navigation read as one more setting, so it
     * is a word with the accent rule under it instead — the same mark the
     * wordmark and every section label use.
     */
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    for (const control of [".segmented button.active", ".range-buttons button.active", ".period-buttons button.active"]) {
      expect(css).toContain(`${control} { background: var(--surface); color: var(--text); font-weight: 650; box-shadow: var(--shadow); }`);
    }
    expect(css).toContain(".site-header nav button.active::after");
  });

  it("opens on the question rather than on somebody else's watchlist", () => {
    /*
     * The application used to land on twenty-two cards of figures for
     * companies the reader had not asked about, before they had said what they
     * came for.
     */
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    expect(source).toContain('useState<MainView>("search")');
    expect(source).toContain("<SearchPage watchlist={watchlist}");
    const page = readFileSync(new URL("../components/SearchPage.tsx", import.meta.url), "utf8");
    // The cursor belongs in the field on a page whose only purpose is the field.
    expect(page).toContain("field.current?.focus()");
    expect(page).toContain('aria-autocomplete="list"');
  });
});
