import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("UI regressions", () => {
  it("keeps the primary navigation intentionally limited", () => {
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    // The key stays "companies" on purpose: it is in every saved link.
    expect(source).toContain('{ key: "companies", label: "Watchlist" }, { key: "market", label: "Market" }, { key: "portfolio", label: "Portfolio" }, { key: "stats", label: "Statistics" }, { key: "charts", label: "Charts" }, { key: "dcf", label: "DCF" }, { key: "qs", label: "QS Screener" }');
    expect(source).not.toContain('label: "Data Quality"');
    expect(source).not.toContain('label: "Formula Audit"');
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

  it("leads the Charts page with the chart, not with seven rows of controls", () => {
    const source = readFileSync(new URL("../components/ChartsWorkspace.tsx", import.meta.url), "utf8");
    const chart = source.indexOf('className={`chart-stack');
    // Presets, panels, scale, layout, the checkboxes and the per-series grid
    // all sat above the first plot. They are settings; they belong under it.
    for (const control of ['className="chart-presets"', 'className="chart-appearance"', 'className="series-options"']) {
      expect(source.indexOf(control)).toBeGreaterThan(chart);
    }
    expect(source).toContain('className="chart-settings"');
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

  it("uses a white, system-font interface and shared chart tooltip tokens", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("--background: #ffffff");
    expect(css).toContain('font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif');
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

  it("states the portfolio's value and its return as separate answers", () => {
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

  it("gives the market page a window, and the panels nothing but their chart", () => {
    const source = readFileSync(new URL("../components/MarketPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("MARKET_RANGES");
    expect(source).toContain('/api/indices?range=');
    // The relative-volume gauge and its footnote are gone.
    expect(source).not.toContain("relativeVolume");
    expect(source).not.toContain("index-gauge");
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

  it("gives every one-of-N control the same track and thumb", () => {
    // Segmented groups, the time range, the period switch and the header's
    // destinations were four different treatments of the same choice.
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    for (const control of [".site-header nav button.active", ".segmented button.active", ".range-buttons button.active", ".period-buttons button.active"]) {
      expect(css).toContain(`${control} { background: var(--surface); color: var(--text); font-weight: 650; box-shadow: var(--shadow); }`);
    }
  });
});
