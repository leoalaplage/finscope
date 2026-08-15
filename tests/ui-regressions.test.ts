import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("UI regressions", () => {
  it("keeps the primary navigation to four entries and no more", () => {
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    // Scoped to the NAV constant: a company tab may well be called Statistics,
    // and asserting over the whole file would forbid that too.
    const nav = source.match(/const NAV:[\s\S]*?\n\];/)?.[0] ?? "";
    expect(nav).toBeTruthy();
    expect([...nav.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]))
      .toEqual(["Watchlist", "Charts", "QS Screener", "DCF"]);
  });

  it("is navy, dark only, with no way to switch theme", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("--bg: #07111F");
    expect(css).toContain("--accent: #4DA3FF");
    expect(css).toContain("-apple-system");
    expect(css).toContain(".recharts-default-tooltip");

    // Six type steps and no more. Twelve sizes is what made it read as
    // sediment rather than a scale, so the count is the guarantee.
    const declared = [...css.matchAll(/--t-[a-z]+:/g)].length;
    expect(declared).toBe(6);
    const hardCoded = [...css.matchAll(/font-size:\s*\d+px/g)].map((match) => match[0]);
    expect(hardCoded, `hard-coded sizes outside the scale: ${hardCoded.join(", ")}`).toEqual([]);
    // One palette, one surface: no light set and no [data-theme] override to
    // keep in step with it.
    expect(css).not.toContain("#ffffff");
    expect(css).not.toContain("data-theme");

    const app = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    expect(app).not.toContain("theme-toggle");
    expect(app).not.toContain("ThemeName");
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
});

describe("the redesign", () => {
  it("lands on one search box, and searches beyond the watchlist", () => {
    const home = readFileSync(new URL("../components/HomePage.tsx", import.meta.url), "utf8");
    expect(home).toContain("Search a company or ticker");
    // A ticker that has never been imported is still one query away.
    expect(home).toContain("/api/resolve?q=");
    expect(home).toContain("onImport");
    // No product copy on the front door.
    expect(home).not.toMatch(/auditable financial-research|compare financial metrics/);
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
});
