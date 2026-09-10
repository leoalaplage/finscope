import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IO_SECTIONS } from "../lib/io/sections";

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
    // Company statistics stay here; valuation links to the single DCF page so
    // two competing calculators cannot disagree without an explanation.
    expect(source).toContain("CompanyStatisticsTab");
    expect(source).toContain('{ key: "valuation", label: "Valuation" }');
    expect(source).toContain('href={`/dcf?s=${encodeURIComponent(dataset.company.ticker)}&mode=full`}');
    expect(source).not.toContain("FcfYieldCalculator");
    const tab = readFileSync(new URL("../components/CompanyStatisticsTab.tsx", import.meta.url), "utf8");
    // The open company starts selected but is a real toggle: after choosing a
    // peer, the reader can remove the anchor and inspect that peer alone.
    expect(tab).toContain("useState<string[]>([anchor])");
    expect(tab).toContain("onClick={() => toggle(anchor)}");
    expect(tab).toContain('aria-label="Statistics period"');
    expect(tab).toContain('setPeriodicity("ttm")');
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
    // The header now names the period and says what it is made of, which is a
    // stronger version of the same rule: a trailing window is four filed
    // quarters, a year is a filed year, and neither is called the other.
    expect(source).toContain("Four filed quarters, through");
    expect(source).toContain("Filed year, to");
    expect(source).toContain("Offline fixture from SEC facts");
    // A deep link that fails must not present the fixture as the company that
    // was asked for. It used to escape to the search page, which reads as a
    // link to a company that opens an empty search box; it now fails on the
    // page it pointed at, naming the company and offering the retry.
    expect(source).toContain("if (route.ticker && route.ticker !== initialData.company.ticker) setFailed({ ticker, reason })");
    expect(source).toContain("<CompanyUnavailable");
    expect(source).not.toContain('setView("search")');
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

  it("puts cash-flow yield and per-share history inside Valuation", () => {
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    const snapshot = readFileSync(new URL("../components/ValuationFundamentals.tsx", import.meta.url), "utf8");
    expect(source).toContain("ValuationFundamentals");
    expect(source).toContain("Free cash flow yield");
    expect(snapshot).toContain("FCF yield");
    expect(snapshot).toContain("Free cash flow per share");
    expect(snapshot).toContain('aria-label="FCF per share frequency"');
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
  it("opens a plain company page on five years while preserving explicit ranges", () => {
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    expect(company).toContain('const empty: Address = { metrics: [], range: "5Y"');
    expect(company).toContain('state.range !== "5Y"');
  });

  it("lists each financial measure in only one statement section", () => {
    const metrics = IO_SECTIONS.flatMap((section) => section.metrics);
    expect(new Set(metrics).size).toBe(metrics.length);
  });

  it("keeps the company Quality Score on one desktop row", () => {
    const score = readFileSync(new URL("../components/io/Score.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    expect(score).not.toContain('<div className="label">Coverage</div>');
    expect(score).not.toContain("/ 100");
    expect(css).toContain(".score-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }");
  });

  it("keeps landing-page company choices usable without the RSC link bridge", () => {
    const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
    const watchlist = readFileSync(new URL("../components/io/HomeWatchlist.tsx", import.meta.url), "utf8");
    const search = readFileSync(new URL("../components/io/Search.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    expect(page).toContain("<HomeWatchlist />");
    expect(watchlist).toContain('href={`/s/${encodeURIComponent(ticker)}`}');
    // The list still persists to the reader's own device; the definition moved
    // to one module so the screener scores the same list the home page edits.
    const store = readFileSync(new URL("../components/io/watchlist.ts", import.meta.url), "utf8");
    expect(store).toContain("localStorage.setItem(WATCHLISTS_KEY");
    expect(store).toContain("localStorage.getItem(WATCHLIST_KEY)");
    // One editor writes the list, and both the home page and the market page
    // open that one. A second copy would be two editors that agree until one
    // of them is changed.
    const editor = readFileSync(new URL("../components/io/WatchlistEditor.tsx", import.meta.url), "utf8");
    expect(editor).toContain("writeWatchlistCollection(next)");
    expect(editor).toContain("Reset {DEFAULT_TICKERS.length}");
    expect(watchlist).toContain("<WatchlistEditor");
    const performance = readFileSync(new URL("../components/io/MarketPerformance.tsx", import.meta.url), "utf8");
    expect(performance).toContain("<WatchlistEditor");
    expect(page).not.toContain('from "next/link"');
    // Still a real document navigation where it navigates at all — the compare
    // page hands the symbol back instead, and passes no destination.
    expect(search).toContain("action={onPick ? undefined : destination}");
    /*
     * The suggestion panel is back, by request.
     *
     * It was removed once because it covered the watchlist on the landing page
     * — which is what a menu does — and its absence is what let "apple" open a
     * page called APPLE: a reader typing a name could not see which company
     * they were about to open. Covering the grid is the lesser problem.
     */
    expect(search).toContain('role="listbox"');
    expect(search).toContain('className="results"');
    expect(search).toContain('aria-autocomplete="list"');
    expect(search).toContain('type="search"');
    expect(css).toContain(".io .search input:focus-visible { outline: none; box-shadow: none; }");
    expect(company).toContain('role="progressbar"');
    expect(company).toContain("about {state.progress}%");
  });

  it("names a company's own sector on its card, never the name of the list", () => {
    const watchlist = readFileSync(new URL("../components/io/HomeWatchlist.tsx", import.meta.url), "utf8");
    expect(watchlist).not.toContain('?? "Watchlist"');
    expect(watchlist).toContain("summarySector(summary)");
    // A card with no sector yet states the ticker alone rather than a placeholder.
    expect(watchlist).toContain("{sector ? <span>{sector}</span> : null}");
  });

  it("drops the resolver's placeholders from a company header", () => {
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    // One definition of what a placeholder is, in lib/sector.ts, read by the
    // page that shows a profile and by the digest the home page reads.
    expect(company).toContain("[company.exchange, company.sector].map(stated)");
    expect(company).not.toContain("{company.sector}");
    expect(company).not.toContain("{company.exchange}");
  });

  it("waits for the whole watchlist before grading any of it", () => {
    const screener = readFileSync(new URL("../components/io/Screener.tsx", import.meta.url), "utf8");
    // The endpoint names what it is still building, and the page says so with a
    // progress bar instead of opening on whichever rows happened to be cached.
    expect(screener).toContain("pending?: string[]");
    expect(screener).toContain('role="progressbar"');
    expect(screener).toContain("timer = setTimeout(build, POLL_MS)");
    // The weights are a pure function of a table already in hand: choosing a
    // preset must not refetch the list, which is what made it fill up on click.
    expect(screener).toContain("}, [followed, scoringPasted]);");
  });

  it("offers the share price beside a filed measure on the one big chart", () => {
    const section = readFileSync(new URL("../components/io/PriceSection.tsx", import.meta.url), "utf8");
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    // The overlay is told where the measures on screen open, not just which
    // periods they came from: the two have to start on the same day.
    expect(section).toContain("useOverlayPrice(ticker, periods, withPrice && offersPrice, metricsOpenOn)");
    expect(section).toContain(">\n            Share price\n          </button>");
    // Shareable, like every other choice made on this page.
    expect(company).toContain('withPrice: asked.get("p") === "1"');
    // Both chart switches now show whether they are on.
    expect(css).toContain('.metric-toggle[aria-pressed="true"]');
  });

  it("reads a portfolio through to the businesses under it", () => {
    const portfolio = readFileSync(new URL("../components/io/Portfolio.tsx", import.meta.url), "utf8");
    const page = readFileSync(new URL("../app/portfolio/page.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../components/io/Shell.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    // The destination remains in both navigation layouts and names its active state.
    expect(shell).toContain('href="/portfolio" aria-current={isCurrent("/portfolio") ? "page" : undefined}>Portfolio</a>');
    // The book is this device's, so the page is a constant and the valuation
    // happens in the browser: nothing about what somebody owns is sent anywhere.
    expect(page).toContain('export const dynamic = "force-static"');
    expect(portfolio).toContain("useStoredHoldings()");
    expect(portfolio).toContain("valuePortfolio(positions, feed.summaries, prices, names)");
    // Ownership is shares over shares in issue, applied to a filed figure.
    expect(portfolio).toContain("position.shares / summary.shares");
    expect(css).toContain(".allocation-bar span { display: block; height: 100%; background: var(--plot); }");
  });

  it("shows value-weighted portfolio risk and contribution without inventing a composite risk score", () => {
    const portfolio = readFileSync(new URL("../components/io/Portfolio.tsx", import.meta.url), "utf8");
    expect(portfolio).toContain("portfolioQuality(valued.positions");
    expect(portfolio).toContain("Quality contribution");
    expect(portfolio).toContain("Day contribution");
    expect(portfolio).toContain("Sector concentration");
    // The caption that said the exposures overlap has gone; what it was
    // guarding against is guarded by the shape of the panel itself, which
    // states weights and never adds them into a score.
    expect(portfolio).not.toContain("riskScore");
  });

  it("carries the company you are reading to the screens that are about one", () => {
    const shell = readFileSync(new URL("../components/io/Shell.tsx", import.meta.url), "utf8");
    const compare = readFileSync(new URL("../components/io/Compare.tsx", import.meta.url), "utf8");
    const remembered = readFileSync(new URL("../components/io/remembered.ts", import.meta.url), "utf8");
    const memory = readFileSync(new URL("../lib/io/last-company.ts", import.meta.url), "utf8");
    // Compare and the DCF are about one company at a time, and the reader is
    // usually already reading one: the bar takes it with them.
    expect(shell).toContain('const compareHref = onCompany("/compare", held);');
    expect(shell).toContain('const dcfHref = onCompany("/dcf", held);');
    expect(shell).toContain('<a href={compareHref}');
    expect(shell).toContain('<a href={dcfHref}');
    // Read as a store, so the first client render matches the prerendered
    // markup and the link fills in on the render after.
    expect(remembered).toContain('useSyncExternalStore(subscribe, read, () => "")');
    // A write in this tab is not a storage event, so the memory says so itself.
    expect(memory).toContain('window.dispatchEvent(new Event("finscope:last-company"))');
    // And a comparison of one says what it is waiting for.
    expect(compare).toContain("Name a second company to read {tickers[0]} against.");
  });

  it("gives the discounted cash flow a page that answers in one screen", () => {
    const page = readFileSync(new URL("../app/dcf/page.tsx", import.meta.url), "utf8");
    const dcf = readFileSync(new URL("../components/io/Dcf.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../components/io/Shell.tsx", import.meta.url), "utf8");
    expect(shell).toContain('>DCF</a>');
    // The company being valued is in the address, so a valuation can be sent.
    expect(page).toContain('export const dynamic = "force-static"');
    expect(dcf).toContain('url.searchParams.set("s", next)');
    /*
     * The page answers before it is touched.
     *
     * A discounted cash flow normally has to be driven — a growth rate, a
     * discount rate, a horizon — and answers whatever it is fed. This one is
     * asked backwards: at today's price, what growth would the company have to
     * deliver? That is arithmetic on the price, so it needs nothing from the
     * reader, and it can be set beside what the company has actually done.
     */
    /*
     * The finding on its own line, and the two comparisons drawn rather than
     * written. It was a strip of figures followed by two paragraphs of
     * monospace prose: thirty-eight per cent of the page was text a reader had
     * to parse to reach three words.
     */
    expect(dcf).toContain('<div className="label">The price asks</div>');
    expect(dcf).toContain('<div className="label">It has delivered</div>');
    expect(dcf).toContain('<div className="label">Fair value</div>');
    /*
     * Three figures in the ruled grid this site states figures in, and no
     * drawing of them. They were bars on two axes for a while: honest, and
     * redundant — a bar reaching further than a mark says what two numbers
     * side by side already say, in more space and one more thing to learn.
     */
    expect(dcf).not.toContain("dcf-axis");
    expect(dcf).not.toContain("function Axis(");
    /*
     * The fair value is a band, which is what the measurement supports: a
     * single value per share moves nine to nineteen per cent on one point of
     * the discount rate, and the rate is itself an estimate — a three-year beta
     * window instead of five moves the value by up to a quarter.
     */
    expect(dcf).toContain("const BAND = .01;");
    expect(dcf).toContain("low: model.worth(required + BAND, model.record.rate)");
    /*
     * And no sentence at all. Two numbers side by side say which is larger,
     * and a line of prose telling the reader so was the page explaining its
     * own table. The green and red went first, for the same reason: the market
     * table scans a column of moves and wants the hue; three figures do not.
     */
    expect(dcf).not.toContain("The price is asking for");
    expect(dcf).not.toContain("verdict-headline");
    expect(dcf).not.toContain("day-mark");
    // A dash still owes its reason, so the reason sits under the dash.
    expect(dcf).toContain("const asksNote = (() => {");
    expect(dcf).toContain("no growth to ${percent(model.asks.bound, 0)} a year justifies this price");
    /*
     * And the same question the other way round, which needs nothing at all.
     *
     * Requiring a return and solving for growth is one reading; taking the
     * growth the company has delivered and solving for the return is the one
     * most readers mean by "is this worth buying". Both records are offered
     * because they routinely disagree, and the reader's own rate is the third
     * row rather than the price of admission.
     */
    expect(dcf).toContain("impliedReturn(model.terms, row.rate)");
    expect(dcf).toContain("If it grows like the last ${Math.round(near.years)} years");
    expect(dcf).toContain('label: "If it grows at your own rate"');
    /*
     * Two controls, and the first one says what it is.
     *
     * Four bare percentages beside a heading are four percentages of nothing.
     * The return required is the only figure on the page nobody filed; the
     * growth field is optional and named as an assumption.
     */
    expect(dcf).toContain('<span className="label">The return you want a year</span>');
    /*
     * And the growth field is the third row's own figure, not a box at the
     * foot of the page: the assumption is made where its answer appears.
     */
    expect(dcf).toContain('label: "If it grows at your own rate"');
    expect(dcf).toContain('{row.id === "own" ? (');
    expect(dcf).toContain("const custom = assumed ?? Math.round");
    expect(dcf).toContain('setPicked("own")');
    /*
     * What is gone: three named cases, a strip of four statistics and a
     * twelve-cell grid of margins, all of which had to be understood before
     * any of them could be read.
     */
    expect(dcf).not.toContain("caseValues");
    expect(dcf).not.toContain("dcf-matrix");
    expect(dcf).not.toContain('<div className="label">Earns a year</div>');
    /*
     * And a filled cell stays filled inside the chosen row.
     *
     * The row highlight is a background and the fill is a background, and the
     * row's rule is the more specific — so the figure that matters most on the
     * page was drawn in inverse ink on the wrong ground, in both themes.
     */
    // The two screens are one reading: each links to the other's company.
    expect(dcf).toContain("rememberCompany(ticker)");
    const company2 = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    expect(company2).toContain('href={`/dcf?s=${encodeURIComponent(company.ticker)}`}');
    // A company nobody has opened is waited for rather than refused.
    expect(dcf).toContain("timer = setTimeout(load, POLL_MS)");
  });

  it("draws what it is worth against what it costs, and nothing else", () => {
    const dcfSource = readFileSync(new URL("../components/io/Dcf.tsx", import.meta.url), "utf8");
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    // The model lives on its own page. A reader deep in a company's statements
    // is not the reader asking what its price implies.
    expect(company).not.toContain("<ImpliedExpectations");
    expect(company).toContain(">DCF →</a>");
    // The reader moves the return required; the terminal rate is a constant
    // rather than a control, because one tuned per company is a forecast again.
    expect(dcfSource).toContain("const RATES = [.06, .08, .10, .12];");
    /*
     * And the default among them is not a round number at all.
     *
     * Moving the required return from eight per cent to twelve changes the
     * growth the price is asking for by seven to twelve points, so a reader
     * with no view picking the middle button was picking the answer. The page
     * opens on this company's own cost of equity, built from the ten-year
     * Treasury it already serves and a beta measured against the S&P 500 from
     * price series it already returns.
     */
    expect(dcfSource).toContain("const required = chosen ?? priced?.rate ?? .10;");
    expect(dcfSource).toContain("costOfEquity(yields == null ? null : yields / 100, returnsOf(company), returnsOf(market))");
    expect(dcfSource).toContain("is this company&rsquo;s cost of equity");
    // The workings sit behind a disclosure, as the score audit has since it
    // was written: every one is worth keeping and none of them is the answer.
    expect(dcfSource).toContain('<details className="dcf-workings">');
    expect(dcfSource).toContain("How this was struck");
    // A beta belongs to a filer, so it is carried with the ticker it was
    // measured for rather than left on screen while the next one loads.
    expect(dcfSource).toContain("risk?.ticker === ticker ? risk.value : null");
    /*
     * And the projection fades rather than falling off a cliff. A rate held
     * flat for a decade and then dropped to two and a half per cent overnight
     * is a shape no business has ever had.
     */
    expect(dcfSource).toContain("const HOLD = 5;");
    expect(dcfSource).toContain("terminalGrowth: TERMINAL, holdYears: HOLD");
    expect(dcfSource).toContain("const TERMINAL = .025;");
    expect(dcfSource).not.toContain("setTerminal");
    // Free cash flow is struck after interest, so it is held against the market
    // capitalisation and never against the enterprise value.
    expect(dcfSource).toContain("quote.price * basis.shares");
    expect(dcfSource).not.toContain("netDebt");
    /*
     * And nothing is drawn at all.
     *
     * The page carried a two-view panel, then one chart of value against
     * price, then two axes beside the figures. Each was honest and each said
     * what the figures beside it already said; what a reader wants from this
     * page is a sentence and three numbers.
     */
    expect(dcfSource).not.toContain("MultiLine");
    expect(dcfSource).not.toContain("valuePath");
    expect(dcfSource).not.toContain("How to read this");
    expect(dcfSource).not.toContain("What the price implies");
    // The control that needed naming is named: four bare percentages beside a
    // heading are four percentages of nothing.
    expect(dcfSource).toContain("<span className=\"label\">The return you want a year</span>");
    /*
     * And the page says what the reader is trusting.
     *
     * Two thirds of a ten-year discounted cash flow is the perpetuity after
     * it, and which filed window the cash came from is not always the newest
     * one — Amazon's and Oracle's newest are negative, and a blank page for
     * two of the largest companies here told a reader less than a stated
     * substitution does.
     */
    expect(dcfSource).toContain("terminalShare({ ...model.terms, discountRate: required }, priceAsks)");
    expect(dcfSource).toContain("of that value is the perpetuity after year");
    expect(dcfSource).toContain("function latestPositive(");
    expect(dcfSource).toContain("the company spent more than it earned.");
    // A record measured across a change of sign is meaningless, so the window
    // shortens — but only where the whole one cannot be measured at all.
    expect(dcfSource).toContain("const whole = measured(points);");
    expect(dcfSource).toContain("const SHORTEST_RECORD = 4;");
  });

  it("reads the wire under the indices as text, and never as a door", () => {
    const page = readFileSync(new URL("../app/market/page.tsx", import.meta.url), "utf8");
    const news = readFileSync(new URL("../components/io/MarketNews.tsx", import.meta.url), "utf8");
    const parser = readFileSync(new URL("../lib/news.ts", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    // Under the charts, and on this page only: the workspace shares the
    // component above it.
    expect(page.indexOf("<MarketNews />")).toBeGreaterThan(page.indexOf("<MarketPage indicesOnly />"));
    // Somebody else's document is data. Nothing from it is rendered as markup,
    // and nothing from it is followed: the feed's own link would send a reader
    // somewhere nobody here vouches for, and its hostname is not a byline this
    // page prints under every headline.
    expect(news).not.toContain("dangerouslySetInnerHTML");
    expect(news).not.toContain("<a ");
    expect(news).not.toContain('target="_blank"');
    expect(news).not.toContain("hostname");
    expect(parser).toContain('replace(/<[^>]*>/g, " ")');
    // Set like every other line of text here: a headline in the proportional
    // face reads as though it came from somewhere else.
    expect(css).toContain(".news-headline { font-family: var(--mono);");
    // Headlines, and only headlines: the summaries the parser reads are not
    // sent, and the feed's own name is not a badge on the section.
    expect(news).not.toContain("news-summary");
    expect(news).not.toContain("item.summary");
    expect(news).not.toContain("Breaking The News");
    /*
     * The wire's address is dropped in the Worker, not in the component, so
     * nothing downstream can offer one. A company's own newsroom is the other
     * case and keeps its link: there the destination is the filer being read
     * about, and the release is the document the headline stands for.
     */
    const route = readFileSync(new URL("../app/api/news/route.ts", import.meta.url), "utf8");
    expect(route).toContain('type Headline = Omit<NewsItem, "summary" | "sourceUrl">;');
    const company = readFileSync(new URL("../app/api/company/[ticker]/news/route.ts", import.meta.url), "utf8");
    expect(company).toContain("sourceUrl }: NewsItem): Headline => ({ title, category, publishedAt, sourceUrl })");
  });

  it("places portfolio analysis below sector concentration and omits the FCF-owned summary cell", () => {
    const portfolio = readFileSync(new URL("../components/io/Portfolio.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    expect(portfolio.lastIndexOf("<PortfolioAnalysis")).toBeGreaterThan(portfolio.indexOf("Sector concentration"));
    expect(portfolio).not.toContain('<Stat label="FCF owned"');
    // Seven figures in a row of eight leaves a ruled box nobody filled in, so
    // the strip states its own count and the short last row spans the rest.
    expect(portfolio).toContain('className="grid-ruled stats stats-seven"');
    expect(css).toContain(".stats-seven { grid-template-columns: repeat(7, minmax(0, 1fr)); }");
    expect(css).toContain(".stats-seven > :last-child { grid-column: span 2; }");
    // The figure left the strip; the sentence under it no longer defines a
    // label that is not there.
    expect(portfolio).not.toContain("Owned is your fraction");
    // Three captions the reader asked to be rid of: a subtitle that repeated
    // the headings under it, and two paragraphs explaining arithmetic the
    // figures already carry.
    expect(portfolio).not.toContain("Concentration, score contribution");
    expect(portfolio).not.toContain("Exposures overlap");
    expect(portfolio).not.toContain("Contributions add to the weighted score");
  });

  it("draws today's multiple against the window the reader chose", () => {
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    const history = readFileSync(new URL("../components/io/ValuationHistory.tsx", import.meta.url), "utf8");
    const series = readFileSync(new URL("../components/io/valuation-series.ts", import.meta.url), "utf8");
    // One read for the page: the table states the ranges and the chart draws
    // the line, and two requests for the same prices would be two answers.
    expect(company).toContain("const valuation = useValuationHistory(");
    expect(company).toContain("<ValuationHistory state={valuation} selected={selectedMetrics} onSelect={selectMetric} />");
    expect(company).toContain("valuation={valuation}");
    // One window at a time, switched in a click, and drawn rather than tabulated.
    expect(history).toContain("historicalValuationRange(state.history, metric.key, now, years, asOf)");
    expect(history).toContain("const WINDOWS = [5, 10] as const;");
    expect(history).not.toContain("<table>");
    expect(series).toContain("published=1");
    // A row sends its multiple to the chart at the top, like every other table.
    expect(history).toContain("onSelect(chosen ? null : metric.key)");
    expect(history).not.toContain("Current valuation against observed 5Y and 10Y ranges");
    expect(history).not.toContain("One observation per published");
  });

  it("lets the big chart draw a multiple it struck itself", () => {
    const section = readFileSync(new URL("../components/io/PriceSection.tsx", import.meta.url), "utf8");
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    // A filer publishes free cash flow and a share count, not what the market
    // charged for them, so these three are not in `view.metrics`. Everything
    // that decides what a chart can carry has to know them anyway.
    expect(company).toContain("VALUATION_METRICS.find((metric) => metric.key === key)?.unit");
    expect(section).toContain("VALUATION_METRICS.find((item) => item.key === key) ?? view.metrics.find");
    expect(section).toContain("if (isValuationMetric(key))");
    // Read as % change, lines of different ages still begin on the same day.
    expect(section).toContain("const rebaseFrom = rebased");
  });

  it("shows FCF per-share growth and consistency beside valuation history", () => {
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    const growth = readFileSync(new URL("../components/io/FcfShareGrowth.tsx", import.meta.url), "utf8");
    expect(company).toContain("<FcfShareGrowth view={view} />");
    expect(growth).toContain("5Y CAGR");
    expect(growth).toContain("10Y CAGR");
    expect(growth).toContain("R² · 5Y");
    expect(growth).toContain("R² · 10Y");
    expect(growth).not.toContain("Steadier near 1.00");
  });

  it("keeps the FCF per-share comparison in its own table", () => {
    const compare = readFileSync(new URL("../components/io/Compare.tsx", import.meta.url), "utf8");
    expect(compare).toContain("<FcfShareComparison columns={columns} />");
    expect(compare).toContain("Growth &amp; consistency");
    expect(compare).toContain('label: "R² · 5Y"');
    expect(compare).toContain('label: "R² · 10Y"');
    expect(compare).not.toContain("R² steadier near 1.00");
  });

  it("opens Compare on the requested essentials and keeps every other row behind Show all", () => {
    const compare = readFileSync(new URL("../components/io/Compare.tsx", import.meta.url), "utf8");
    for (const key of [
      "grossMargin", "operatingMargin", "netMargin", "operatingCashFlowMargin",
      "freeCashFlowMargin", "freeCashFlowAfterSbcMargin", "cashConversion", "roic",
      "cashReturnOnCapital", "debtToEquity", "interestCoverage",
    ]) expect(compare).toContain(`"${key}"`);
    for (const key of [
      "revenue", "grossProfit", "operatingIncome", "netIncome", "dilutedShares",
      "netIncomePerShare", "freeCashFlowPerShare", "freeCashFlowAfterSbcPerShare",
    ]) expect(compare).toContain(`"${key}"`);
    expect(compare).toContain('{expanded ? "Show essentials" : "Show all"}');
  });

  it("searches every chart metric while keeping twelve visible by default", () => {
    const compare = readFileSync(new URL("../components/io/Compare.tsx", import.meta.url), "utf8");
    expect(compare).toContain('const [metricQuery, setMetricQuery] = useState("")');
    expect(compare).toContain('aria-label="Search metrics"');
    expect(compare).toContain("featured.slice(0, FEATURED.length)");
    expect(compare).toContain("featured.filter((row) =>");
    expect(compare).toContain("No metric found");
  });

  it("exposes the three headline indices on a dedicated public Market page", () => {
    const shell = readFileSync(new URL("../components/io/Shell.tsx", import.meta.url), "utf8");
    const page = readFileSync(new URL("../app/market/page.tsx", import.meta.url), "utf8");
    const market = readFileSync(new URL("../components/MarketPage.tsx", import.meta.url), "utf8");
    const indices = readFileSync(new URL("../lib/indices.ts", import.meta.url), "utf8");
    expect(shell).toContain('href="/market" aria-current={isCurrent("/market") ? "page" : undefined}>Market</a>');
    expect(page).toContain('export const dynamic = "force-static"');
    expect(page).toContain("<MarketPage indicesOnly />");
    expect(market).toContain('/api/indices?range=');
    expect(indices).toContain('label: "S&P 500"');
    expect(indices).toContain('label: "NASDAQ"');
    expect(indices).toContain('label: "Dow Jones"');
    // The last-price badge is drawn at the corner radius of the panels around
    // it rather than as a pill of its own.
    expect(market).toContain("height={16} rx={2}");
    // One scale for the row: the three panels are measured together, so zero
    // is at the same height in each and a deeper fall is drawn deeper.
    expect(market).toContain("sharedPercentScale(");
    expect(market).toContain("<IndexPanel key={entry.id} entry={entry} range={range} scale={scale}/>");
    expect(market).toContain("const top = shared ? fromPercent(shared.high) : high + pad;");
  });

  it("puts the company's own newsroom last on its page, under everything it filed", () => {
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    const market = readFileSync(new URL("../components/io/MarketNews.tsx", import.meta.url), "utf8");
    // Under the statements: the page is what the company filed, and this is
    // the one section that is what it said since.
    expect(company.indexOf("<CompanyNews key={company.ticker} ticker={company.ticker} />")).toBeGreaterThan(company.indexOf("<Statements view={view}"));
    expect(company.indexOf("<CompanyNews")).toBeLessThan(company.indexOf('<footer className="foot">'));
    // Both news panels read an instant the same way, from one helper.
    expect(market).toContain('import { clock } from "./format"');
    expect(market).not.toContain("function clock(");
    // Keyed by company, so one company's releases never sit under another's
    // name while the next request is out.
    expect(company).toContain("<CompanyNews key={company.ticker}");
  });

  it("puts an official, date-explicit macro snapshot below the market indices", () => {
    const page = readFileSync(new URL("../app/market/page.tsx", import.meta.url), "utf8");
    const macro = readFileSync(new URL("../components/io/MacroSnapshot.tsx", import.meta.url), "utf8");
    const route = readFileSync(new URL("../app/api/macro/route.ts", import.meta.url), "utf8");
    const definitions = readFileSync(new URL("../lib/macro.ts", import.meta.url), "utf8");
    const ioCss = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    /*
     * The order the market page reads in. A reader opening "Market" wants what
     * happened to what they hold before what happened to the economy, so their
     * own list sits directly under the indices and the macro panel — the least
     * personal thing on the page — keeps its place at the foot.
     */
    expect(page.indexOf("<MarketPerformance />")).toBeGreaterThan(page.indexOf("<MarketPage indicesOnly />"));
    expect(page.indexOf("<MarketNews />")).toBeGreaterThan(page.indexOf("<MarketPerformance />"));
    expect(page.indexOf("<MacroSnapshot />")).toBeGreaterThan(page.indexOf("<MarketNews />"));
    expect(macro).toContain('aria-label="Select a macro geography"');
    expect(macro).toContain("latest available data");
    expect(macro).toContain("Published observations only");
    expect(macro).toContain('aria-label={`Open ${indicator.label} history`}');
    expect(macro).toContain('const HISTORY_RANGES: HistoryRange[] = ["1Y", "5Y", "10Y", "MAX"]');
    expect(macro).toContain('history.indicator.id === "inflation"');
    expect(macro).toContain("Compare countries");
    expect(macro).toContain("MAX_COMPARED_COUNTRIES = 5");
    expect(macro).toContain("comparisonCountries");
    expect(macro).toContain("MacroHistoryChart histories={chartHistories}");
    expect(macro).toContain("Different publication frequency, not overlaid");
    expect(macro).toContain("CPI · base 100");
    expect(macro).toContain('effectiveSeries === CPI_INDEX_SERIES.id');
    expect(macro).toContain("readEurostatDirect");
    expect(ioCss).toMatch(/\.macro-history-tooltip\s*\{[\s\S]*?inset-block-start:\s*-14px;/);
    expect(route).toContain("api.worldbank.org");
    expect(route).toContain("api.bls.gov/publicAPI/v2/timeseries/data/");
    expect(definitions).toContain("ec.europa.eu/eurostat/api");
    expect(route).toContain("data-api.ecb.europa.eu");
    expect(route).toContain("sdmx.oecd.org");
    expect(route).toContain("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json");
    expect(route).toContain("daily_treasury_yield_curve");
    expect(route).toContain('cachedJson(`macro:${country.code}:v8`');
    const history = readFileSync(new URL("../app/api/macro/history/route.ts", import.meta.url), "utf8");
    expect(history).toContain("OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL");
    expect(history).toContain("DF_IALFS_UNE_M");
    expect(history).toContain("DF_QNA_EXPENDITURE_GROWTH_G20");
    expect(history).toContain('parameters: "coicop18=TOTAL&unit=I25"');
    expect(history).toContain(".M.N.CPI.IX._T.N._Z");
    expect(history).toContain("rebaseObservations");
    expect(history).toContain("finscope-macro-source.leoalaplage.workers.dev");
    expect(history).toContain("IMF IFS via DBnomics");
    expect(history).toContain("joinCpiHistories");
    expect(history).toContain("bestCachedHistoryBody");
    expect(history).toContain('CPI_INDEX_SERIES.id ? "v9"');
    expect(history).toContain("macro-history:");
  });

  it("carries the level of output for every geography, and names no data provider on screen", () => {
    const macro = readFileSync(new URL("../components/io/MacroSnapshot.tsx", import.meta.url), "utf8");
    const definitions = readFileSync(new URL("../lib/macro.ts", import.meta.url), "utf8");
    const history = readFileSync(new URL("../app/api/macro/history/route.ts", import.meta.url), "utf8");
    const ioCss = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    // GDP in current dollars is published for all ten geographies; the OECD
    // composite leading indicator it replaces was published for some of them
    // and refused cloud traffic for the rest.
    expect(definitions).toContain('id: "gdp"');
    expect(definitions).not.toContain("oecd-cli");
    expect(history).toContain('gdp: "NY.GDP.MKTP.CD"');
    expect(macro).toContain("compactUsd");
    // The panel states the observation and its date; where it came from is a
    // question the page does not put to the reader.
    expect(macro).not.toContain("Open official source");
    expect(macro).not.toContain("indicator.sourceUrl ?");
    expect(macro).not.toContain("indicator.source ||");
    expect(macro).not.toContain("{item.indicator.source}");
    expect(ioCss).not.toContain(".macro-history-foot a");
    // Inflation is asked about as a rate, so the panel opens on the rate.
    expect(macro).toContain('useState<InflationView>("rate")');
    expect(macro).toContain('if (indicator.id === "inflation") { setInflationView("rate")');
  });

  it("returns to the last valid company, or to the watchlist without one", () => {
    const shell = readFileSync(new URL("../components/io/Shell.tsx", import.meta.url), "utf8");
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    const shortcut = readFileSync(new URL("../components/io/CompanyReturn.tsx", import.meta.url), "utf8");
    const page = readFileSync(new URL("../app/company/page.tsx", import.meta.url), "utf8");
    expect(shell).toContain('href="/company" aria-current={isCurrent("/company") ? "page" : undefined}>Company</a>');
    expect(company).toContain("rememberCompany(view.company.ticker)");
    expect(shortcut).toContain("window.location.replace(lastCompanyPath())");
    expect(shortcut).toContain('href="/">Back to watchlist');
    expect(page).toContain('export const dynamic = "force-static"');
  });

  it("separates navigation destinations and describes settings that really exist", () => {
    const shell = readFileSync(new URL("../components/io/Shell.tsx", import.meta.url), "utf8");
    const settings = readFileSync(new URL("../components/io/Settings.tsx", import.meta.url), "utf8");
    const page = readFileSync(new URL("../app/settings/page.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    expect(shell).toContain('href="/settings" aria-label="Open settings"');
    expect(shell).toContain("SettingsIcon");
    expect(css).toContain(".bar-nav a + a { border-inline-start: 1px solid var(--line-strong); }");
    expect(page).toContain('export const dynamic = "force-static"');
    expect(settings).toContain("Appearance");
    expect(settings).toContain("Data &amp; privacy");
    expect(settings).toContain("There is no FinScope account or cloud sync");
    expect(settings).not.toContain('type="email"');
    expect(settings).not.toContain("Create account");
    expect(settings).toContain("onClick={() => setTheme(option.value)}");
  });

  it("keeps the shared shell and local-data editors keyboard reachable", () => {
    const shell = readFileSync(new URL("../components/io/Shell.tsx", import.meta.url), "utf8");
    const search = readFileSync(new URL("../components/io/Search.tsx", import.meta.url), "utf8");
    const dialog = readFileSync(new URL("../components/io/use-modal-dialog.ts", import.meta.url), "utf8");
    expect(shell).toContain('<a className="skip-link" href="#main-content">');
    expect(shell).toContain('className="wrap bar-mobile-nav"');
    expect(search).toContain("aria-activedescendant={activeOptionId}");
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain("opener?.focus()");
  });

  it("sets the Market introduction in the same mono ink as the page", () => {
    const css = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    expect(css).toContain(".market-page .page-heading p { margin-top: var(--u); color: var(--ink); font-family: var(--mono);");
  });

  it("says which of the two readings of a chart is in force", () => {
    const section = readFileSync(new URL("../components/io/PriceSection.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    // The old switch named its own mechanism and looked identical on and off.
    expect(section).not.toContain(">\n            Start from 0\n          </button>");
    expect(section).toContain("aria-pressed={!rebased}");
    expect(section).toContain(">Values</button>");
    expect(section).toContain(">% change</button>");
    // And a switch that is on is filled, not tinted by one step.
    expect(css).toContain('.metric-toggle[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: var(--inverse); }');
  });

  it("measures a book against the index it is always measured against", () => {
    const portfolio = readFileSync(new URL("../components/io/Portfolio.tsx", import.meta.url), "utf8");
    expect(portfolio).toContain('const BENCHMARK = { symbol: "^GSPC", label: "S&P 500" };');
    // Both rebased from the same week, on the shares held today: the page says
    // as much rather than passing it off as a record of what was traded.
    expect(portfolio).toContain("rebasePair(asked, closes.index)");
    expect(portfolio).toContain("not a record of what was");
    // A month of weekly closes is four points; the short windows are drawn from
    // the daily series, and both are fetched once.
    expect(portfolio).toContain("DAILY_WINDOWS.has(span) && history.daily.index.length > 0");
    expect(portfolio).toContain('frequency=daily&start=');
    // The book is the subject on that frame, so it is the one that is filled.
    expect(portfolio).toContain('{ label: "Portfolio", points: book, area: true }');
    // The history is fetched once and the window slices it.
    expect(portfolio).toContain("}, [followed]);");
    expect(portfolio).toContain("}, [history, followed, positions, span]);");
  });

  it("states an enterprise value on the borrowings a filer actually filed", () => {
    const view = readFileSync(new URL("../lib/io/view.ts", import.meta.url), "utf8");
    const stats = readFileSync(new URL("../components/io/Stats.tsx", import.meta.url), "utf8");
    const qs = readFileSync(new URL("../lib/qs-export.ts", import.meta.url), "utf8");
    // The cash is always this period's; only the borrowings are read back.
    expect(view).toContain("reportedDebt(dataset.periods, period)");
    expect(view).toContain('const cash = valueOf(period, "cashAndEquivalents");');
    // And where they came from is on the page, never silently carried.
    expect(stats).toContain("basis?.debtFrom");
    // One definition of the reading: the screener used to hold its own, which
    // is how it came to rank Copart on a net debt the page would not state.
    expect(qs).toContain("reportedDebt(dataset.periods, current)");
    expect(qs).not.toContain("function reportedDebt(");
  });

  it("wears a favicon drawn in the site's one ink", () => {
    const icon = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
    expect(icon).not.toContain("#68C4FF");
    expect(icon).toContain("@media (prefers-color-scheme: dark)");
    expect(icon).toContain("#08080a");
  });

  it("shows exactly nine default watchlist stocks per desktop row", () => {
    const registry = readFileSync(new URL("../lib/company-registry.ts", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    const defaults = registry.match(/export const DEFAULT_WATCHLIST[\s\S]*?\n];/)?.[0] ?? "";
    expect(defaults.match(/\n {2}us\(\{/g)).toHaveLength(27);
    expect(css).toContain(".quick-grid { margin-top: calc(var(--u) * 3); grid-template-columns: repeat(9, minmax(0, 1fr)); }");
  });

  it("lets every available TTM metric replace and then restore the price chart", () => {
    const company = readFileSync(new URL("../components/io/Company.tsx", import.meta.url), "utf8");
    const multiples = readFileSync(new URL("../components/io/Multiples.tsx", import.meta.url), "utf8");
    const price = readFileSync(new URL("../components/io/PriceSection.tsx", import.meta.url), "utf8");
    // Up to three measures at once now, on at most two scales.
    expect(company).toContain("metricKeys={selectedMetrics}");
    expect(company).toContain("onSelect={selectMetric}");
    // The request carries the shape *and* the version the figures were built
    // under, so a reader's own cache cannot answer a corrected deployment with
    // the company it was shown yesterday.
    expect(company).toContain("?view=${IO_VIEW}");
    const version = readFileSync(new URL("../lib/io/view-version.ts", import.meta.url), "utf8");
    expect(version).toMatch(/const VIEW_SHAPE = "iov\d+"/);
    expect(version).toContain("${VIEW_SHAPE}.${KEY_VERSION}");
    expect(multiples).toContain("view.trailing");
    expect(multiples).toContain("Show first 8");
    expect(multiples).toContain("Show all ${panels.length}");
    expect(price).toContain("× Back to price");
    expect(price).toContain("{delta(cagr)} CAGR");
    // One range for the whole page: the chart and the figures under it are
    // driven by the same control rather than each keeping its own.
    expect(company).toContain("range={range}");
    expect(company).toContain("frequency={frequency}");
    expect(price).not.toContain("useState<MetricRange>");
    // A row of the statements is a way into the chart, and the label is the
    // control rather than a second thing to click beside it.
    const statements = readFileSync(new URL("../components/io/Statements.tsx", import.meta.url), "utf8");
    const io = readFileSync(new URL("../app/io.css", import.meta.url), "utf8");
    expect(statements).toContain('className="key-open"');
    expect(statements).toContain("onSelect(key)");
    expect(company).toContain("chart.scrollIntoView");
    // One voice for the table: the row labels are set in the same face as the
    // figures they key, not in the interface face.
    expect(io).toContain("text-align: left; font-family: var(--mono); font-size: var(--fs-xs); color: var(--ink-2);");
    expect(io).toContain("min-height: 190px");
    expect(io).toContain("height: 97px; margin-top: 10px");
  });

  it("puts every destination in the bar, where a reader can find it", () => {
    /*
     * The bug this exists for. Compare and the screener were built, deployed
     * and reachable by URL, and nothing on the site linked to either: an edit
     * to the bar had silently matched nothing, and the pages existed for
     * anybody who already knew they existed.
     */
    const shell = readFileSync(new URL("../components/io/Shell.tsx", import.meta.url), "utf8");
    expect(shell).toContain(">Compare</a>");
    expect(shell).toContain('href="/screener"');
    // Document navigation, like every other link here: it works with or
    // without hydration and every destination is prerendered.
    expect(shell).not.toContain('from "next/link"');
  });

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

  it("uses filed annuals for long overview ranges and reserves TTM detail for 4Y", () => {
    const grid = readFileSync(new URL("../components/CompanyKpiGrid.tsx", import.meta.url), "utf8");
    expect(grid).toContain('range === "4Y" && recentTtm.length >= 4 && continuousOverview(recentTtm)');
    expect(grid).toContain('frequency === "ttm" ? "Quarterly TTM" : "Annual"');
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

  /*
   * The portfolio view is gone from the interface, not from the repository.
   *
   * It was parked out of the navigation and stayed there as 543 lines nobody
   * could reach, which is the definition of a feature that exists only in the
   * codebase. The arithmetic behind it — `lib/portfolio.ts`, `lib/transactions.ts`
   * and their tests — is kept: it is proven, it costs nothing while unimported,
   * and it is what a portfolio would be rebuilt on.
   */

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
