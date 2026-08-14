import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chargerTableau, parserTableau, toFloat } from "../public/qs/js/qs-parse.js";
import { analyser } from "../public/qs/js/qs-engine.js";

const pasted = `Ticker\tSector\tReturn on Invested Capital\tROIC 5Yr Avg\tOperating Margin\tFCF Margin 5Yr Avg\tFCF / Net Income\tGross Margin 5Yr Avg\tShares Out Growth 5Y (CAGR)\tStock-based Comp to Revenue\tNet Debt / EBITDA\tEBIT / Interest Expense\tCurrent Ratio\tLong-term Debt to Assets\tCapex Coverage\tRevenue 5Y CAGR\tRevenue Forward 3Y CAGR\tLevered Free Cash Flow 5Y CAGR\tNet Income 5Y CAGR\tEV/EBIT\tEV/FCF\tForward P/FCF\tFCF Yield
AAA\tSoftware\t30%\t28%\t40%\t32%\t105%\t70%\t-2%\t3%\t0.2\t30\t1.5\t0.1\t8\t15%\t12%\t18%\t16%\t18\t20\t19\t5%
BBB\tSoftware\t10%\t11%\t15%\t8%\t70%\t35%\t4%\t10%\t3.1\t2\t0.8\t0.5\t1.5\t3%\t2%\t1%\t2%\t42\t55\t48\t1%`;

describe("embedded QS screener", () => {
  it("parses direct spreadsheet paste and financial number formats", () => {
    expect(parserTableau(pasted)[0][0]).toBe("Ticker");
    expect(toFloat("($1.25B)")).toBe(-1.25);
    const loaded = chargerTableau(pasted);
    expect(loaded.titres).toHaveLength(2);
    expect((loaded.titres[0].brut as Record<string, number | null>).RevPS5).toBeCloseTo(17.35, 1);
  });

  it("produces dashboard rankings and methodology weights from pasted data", () => {
    const { titres } = chargerTableau(pasted);
    const result = analyser(titres, { classerPar: "total", winsoriser: true });
    expect(result.retenus).toHaveLength(2);
    expect(result.retenus[0].Ticker).toBe("AAA");
    expect(result.retenus[0].total).toBeGreaterThan(result.retenus[1].total);
    expect(result.poids).toEqual({ Quality: 45, Health: 20, Growth: 15, Value: 20 });
  });

  it("sizes the embedded page to its own content and keeps a direct fallback", () => {
    const component = readFileSync(new URL("../components/QsScreener.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const embed = readFileSync(new URL("../public/qs/js/qs-embed.js", import.meta.url), "utf8");
    expect(component).toContain('event.data?.type === "qs-ready"');
    expect(component).toContain('event.data?.type === "qs-height"');
    expect(component).toContain('href="/qs/"');
    expect(css).toContain(".qs-frame");
    expect(embed).toContain('type: "qs-ready"');
    expect(embed).toContain('type: "qs-height"');
    expect(embed).toContain("ResizeObserver");
  });

  it("gives the QS Screener its own page next to DCF", () => {
    const app = readFileSync(new URL("../components/FinanceApp.tsx", import.meta.url), "utf8");
    expect(app).toContain('{ key: "qs", label: "QS Screener" }');
    expect(app).toContain('view === "qs"');
    // The screener no longer hides in the footer's secondary-tools menu.
    expect(app).not.toContain('setSecondary("qs")');
  });

  it("does not link the screener to pages that were never shipped", () => {
    const html = readFileSync(new URL("../public/qs/index.html", import.meta.url), "utf8");
    for (const orphan of ["sp500.html", "chart.html", "fcf.html", "portfolio.html", "filings.html"]) {
      expect(html).not.toContain(orphan);
    }
  });
});
