import { describe, expect, it } from "vitest";
import { screen, type ScoredCompany } from "../lib/qs/screener";

/*
 * FinScope's own model, against the reference one.
 *
 * A pasted table — a Fiscal.ai export — is the reference and must score exactly
 * as it always has. Only the application's own rows ask for the FinScope model.
 */
const HEAD = "Ticker,Sector,ROIC,ROIC 5Yr Avg,Operating Margin,FCF Margin 5Yr Avg,Net Debt / EBITDA,EBIT / Interest Expense,Revenue 5Y CAGR,EV/EBIT,FCF Yield";

const table = (...rows: string[]) => [HEAD, ...rows].join("\n");
const company = (result: { all: ScoredCompany[] }, ticker: string) => result.all.find((row) => row.Ticker === ticker)!;

describe("the FinScope quality model", () => {
  it("lets a disastrous quality measure cost points rather than merely add none", () => {
    // ROIC of −40% sits far below the anchor that scores nought.
    const text = table("BAD,Tech,-40,20,25,15,1,20,10,20,4", "WEAK,Tech,5,20,25,15,1,20,10,20,4");
    const reference = screen(text, {});
    const finscope = screen(text, { modele: "finscope" });

    // The reference cannot tell a −40% return on capital from a 5% one.
    expect(company(reference, "BAD").piliers.Quality).toBeCloseTo(company(reference, "WEAK").piliers.Quality!, 6);
    expect(company(finscope, "BAD").piliers.Quality!).toBeLessThan(company(finscope, "WEAK").piliers.Quality!);
    expect(company(finscope, "BAD").score_metrique.ROIC).toBeLessThan(0);
    expect(company(finscope, "BAD").piliers.Quality!).toBeGreaterThanOrEqual(0);
  });

  it("does not let a cheap price lift a weak business more than five points", () => {
    const text = table("CHEAP,Autos,3,4,2,1,1,20,1,6,12");
    const scored = company(screen(text, { modele: "finscope" }), "CHEAP");
    const { Quality, Health, Growth } = scored.piliers;
    const business = (Quality! * 45 + Health! * 20 + Growth! * 15) / 80;
    expect(scored.piliers.Value).toBe(100);
    expect(scored.total!).toBeLessThanOrEqual(business + 5 + 1e-9);
    expect(company(screen(text, {}), "CHEAP").total!).toBeGreaterThan(business + 5);
  });

  it("scores a pasted table exactly as the reference model does", () => {
    const text = table("AAA,Tech,-40,20,25,15,1,20,10,20,4", "BBB,Autos,3,4,2,1,1,20,1,6,12");
    const once = screen(text, {});
    const again = screen(text, { preset: "defaut" });
    expect(once.all.map((row) => row.total)).toEqual(again.all.map((row) => row.total));
    expect(Object.values(company(once, "AAA").score_metrique).every((score) => score == null || score >= 0)).toBe(true);
  });
});
