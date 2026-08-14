import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("UI regressions", () => {
  it("keeps the internal series frequency as the select option value", () => {
    const source = readFileSync(new URL("../components/MultiStockComparison.tsx", import.meta.url), "utf8");
    expect(source).toContain("<option key={frequency} value={frequency}>{frequencyLabel(frequency)}</option>");
  });

  it("uses shared theme tokens for sidebar and chart tooltips", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain(".sidebar { position: fixed; inset: 0 auto 0 0; width: 232px; background: var(--surface)");
    expect(css).toContain(".recharts-default-tooltip { color: var(--text)");
  });
});
