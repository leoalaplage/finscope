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
});
