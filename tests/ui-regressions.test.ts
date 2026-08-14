import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("UI regressions", () => {
  it("keeps the internal series frequency as the select option value", () => {
    const source = readFileSync(new URL("../components/MultiStockComparison.tsx", import.meta.url), "utf8");
    expect(source).toContain("<option key={frequency} value={frequency}>{frequencyLabel(frequency)}</option>");
  });

  it("keeps the primary navigation intentionally limited", () => {
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    expect(source).toContain('{ key: "companies", label: "Companies" }, { key: "charts", label: "Charts" }, { key: "dcf", label: "DCF" }');
    expect(source).not.toContain('label: "Data Quality"');
    expect(source).not.toContain('label: "Formula Audit"');
  });

  it("uses a white, system-font interface and shared chart tooltip tokens", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("--background: #ffffff");
    expect(css).toContain('font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif');
    expect(css).toContain(".recharts-default-tooltip { color: var(--text)");
  });

  it("keeps straight lines as the default while supporting advanced chart types", () => {
    const source = readFileSync(new URL("../components/ChartsWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain('type="linear" isAnimationActive={false}');
    expect(source).toContain("<Area");
    expect(source).toContain("<Scatter");
    expect(source).toContain('const connectReportPoints = series.missingData === "report-points"');
    expect(source).toContain("connectNulls={connectReportPoints}");
  });

  it("keeps the Companies ranking columns focused on financial metrics", () => {
    const source = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    const header = source.match(/<table className="watchlist-table ranking-table">[\s\S]*?<\/thead>/)?.[0] ?? "";
    expect(header).not.toContain(">Company<");
    expect(header).not.toContain(">Price<");
    expect(header).toContain("Market Cap");
    expect(header).toContain("Rank");
    expect(source).toContain('localStorage.setItem("finscope.companySort"');
    expect(source).toContain('"Load all"');
  });
});
