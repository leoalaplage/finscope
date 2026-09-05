import { describe, expect, it } from "vitest";
import { screen, QS_METRICS } from "../lib/qs/screener";
import * as cfg from "../lib/qs/qs-config.js";

/**
 * The Quality Score is a measurement, not a rank.
 *
 * It used to be a percentile inside whatever table it was handed, so the same
 * filer graded differently in a different crowd and a valuation looked
 * attractive merely because its neighbours were dearer. These tests hold the
 * property that replaced it: a company's grade depends on the company alone.
 */

const HEADERS = [
  "Ticker", "Sector", "ROIC", "ROIC 5Yr Avg", "Operating Margin", "FCF Margin 5Yr Avg",
  "FCF / Net Income", "Gross Margin 5Yr Avg", "Shares Outstanding 5Y CAGR", "SBC to Revenue",
  "Net Debt / EBITDA", "EBIT / Interest Expense", "Current Ratio", "Long-term Debt to Assets",
  "OCF/Capex", "Revenue 5Y CAGR", "FCF 5Y CAGR", "Net Income 5Y CAGR",
  "Revenue Per Share 5Y CAGR", "FCF Per Share 5Y CAGR", "EV/EBIT", "EV/FCF", "FCF Yield",
];

/** A row whose every metric sits exactly on its own "50" anchor. */
const KEYS = ["ROIC", "ROIC5", "OpM", "FCFM5", "FCF_NI", "GM5", "ShOut5", "SBC",
  "NetDebtEBITDA", "EBITInt", "CurrentRatio", "LTDebtAssets", "OCF_Capex",
  "Rev5", "LevFCF5", "NI5", "RevPS5", "FCFPS5", "EV_EBIT", "EV_FCF", "FCFYield"];

function rowAt(ticker: string, point: 0 | 1 | 2): string {
  const cells = KEYS.map((key) => String((cfg.ANCRES_ABSOLUES as Record<string, number[]>)[key][point]));
  return [ticker, "Software", ...cells].join(",");
}

const table = (...rows: string[]) => [HEADERS.join(","), ...rows].join("\n");

describe("Quality Score on a fixed scale", () => {
  it("gives one company the same grade alone as in a crowd", () => {
    const subject = rowAt("AAA", 1);
    const alone = screen(table(subject)).all[0];
    const crowded = screen(table(subject, rowAt("BBB", 2), rowAt("CCC", 0), rowAt("DDD", 2))).all
      .find((row) => row.Ticker === "AAA")!;
    expect(alone.total).toBe(crowded.total);
    expect(alone.note).toBe(crowded.note);
    expect(alone.couverture).toBe(crowded.couverture);
    expect(alone.piliers).toEqual(crowded.piliers);
  });

  it("reads the three anchors as nought, fifty and a hundred", () => {
    const [worst, middling, best] = [0, 1, 2].map((point) =>
      screen(table(rowAt("AAA", point as 0 | 1 | 2))).all[0]);
    expect(worst.total).toBeCloseTo(0, 6);
    expect(middling.total).toBeCloseTo(50, 6);
    expect(best.total).toBeCloseTo(100, 6);
  });

  it("puts every scored metric on an anchor", () => {
    const orphans = QS_METRICS.filter((metric) => !(cfg.ANCRES_ABSOLUES as Record<string, unknown>)[metric.cle]);
    expect(orphans.map((metric) => metric.cle)).toEqual([]);
  });

  it("keeps each anchor monotone in the direction the metric is judged", () => {
    for (const metric of QS_METRICS) {
      const [low, mid, high] = (cfg.ANCRES_ABSOLUES as Record<string, number[]>)[metric.cle];
      const rising = metric.sens === "H";
      expect(`${metric.cle} ${rising ? mid > low && high > mid : mid < low && high < mid}`)
        .toBe(`${metric.cle} true`);
    }
  });

  it("counts a column the source omits as out of reach, and an empty cell as a gap", () => {
    // Forward-looking figures have no column at all: FinScope carries no
    // estimates, and a filer must not be marked incomplete for that.
    const full = screen(table(rowAt("AAA", 1))).all[0];
    expect(full.couverture).toBe(1);

    // The same table with one column blanked out is genuinely short of a
    // measure, and the coverage has to say so.
    const blanked = table(rowAt("AAA", 1).replace(/^AAA,Software,[^,]+/, "AAA,Software,"));
    expect(screen(blanked).all[0].couverture).toBeLessThan(1);
  });
});
