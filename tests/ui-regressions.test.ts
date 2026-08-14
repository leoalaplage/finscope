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

  it("renders straight chart lines and disables chart animation", () => {
    const source = readFileSync(new URL("../components/ChartsWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain('type="linear" isAnimationActive={false}');
    expect(source).not.toContain("<Area");
  });
});
