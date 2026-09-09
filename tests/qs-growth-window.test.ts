import { describe, expect, it } from "vitest";
import { screen } from "../lib/qs/screener";

/**
 * A rebound is not a growth rate.
 *
 * Booking compounded revenue at 31.7% a year over five years and 11.3% over
 * ten, and its net income at 146.8% over five and 7.8% over ten, because its
 * 2020 is a hole rather than a base. Scored on five years alone it read as the
 * fastest-growing company on the list. The whole travel, energy and airline
 * complex reads the same way, and memory reads it every cycle.
 *
 * So both windows are scored. Neither is the truer one — five years notices a
 * business that has genuinely changed and ten years does not — and a company
 * has to hold up on both to be called a grower.
 */

const HEADERS = [
  "Ticker", "Sector",
  "Revenue 5Y CAGR", "FCF 5Y CAGR", "Net Income 5Y CAGR",
  "Revenue Per Share 5Y CAGR", "FCF Per Share 5Y CAGR",
  "Revenue 10Y CAGR", "FCF 10Y CAGR", "Net Income 10Y CAGR",
  "Revenue Per Share 10Y CAGR", "FCF Per Share 10Y CAGR",
];

/** Five years at one rate, ten at another, and nothing else stated. */
const row = (ticker: string, fast: number, slow: number) =>
  [ticker, "Travel", fast, fast, fast, fast, fast, slow, slow, slow, slow, slow].join(",");

const table = (...rows: string[]) => [HEADERS.join(","), ...rows].join("\n");
const growthOf = (text: string, ticker: string) =>
  screen(text).all.find((company) => company.Ticker === ticker)!.piliers.Growth!;

describe("the window growth is measured over", () => {
  it("scores the decade below the rebound that ends it", () => {
    // 30% a year since the trough, 8% a year since before it.
    const rebound = growthOf(table(row("AAA", 30, 8)), "AAA");
    const steady = growthOf(table(row("BBB", 12, 12)), "BBB");
    expect(rebound).toBeLessThan(100);
    // The company that never stopped compounding is not far behind the one that
    // tripled its rate off a crater, which is the whole correction.
    expect(rebound - steady).toBeLessThan(20);
  });

  it("marks the same company down once the decade is on the table", () => {
    /*
     * The five-year columns are unchanged between these two tables. What
     * changes is that the second states the decade as well — and a table that
     * carries no 10-year column at all, as a pasted one does not, puts those
     * measures out of the universe's reach and renormalises around them
     * exactly as before.
     */
    const shortWindow = [
      HEADERS.slice(0, 7).join(","),
      ["AAA", "Travel", 30, 30, 30, 30, 30].join(","),
    ].join("\n");
    expect(growthOf(shortWindow, "AAA")).toBe(100);
    expect(growthOf(table(row("AAA", 30, 8)), "AAA")).toBeLessThan(100);
  });

  it("does not punish a company for having no decade behind it", () => {
    // A filer that listed four years ago has no ten-year figure and never will
    // until it does. The measures go missing, as any unfiled measure does; the
    // coverage rule decides whether what is left is enough to grade.
    const young = screen(table(
      ["AAA", "Travel", 20, 20, 20, 20, 20, "", "", "", "", ""].join(","),
      row("BBB", 20, 20),
    )).all.find((company) => company.Ticker === "AAA")!;
    const same = screen([
      HEADERS.slice(0, 7).join(","),
      ["AAA", "Travel", 20, 20, 20, 20, 20].join(","),
    ].join("\n")).all[0];
    // The pillar reads exactly as it would if the decade had never been asked
    // for: what is missing is renormalised away, not scored as nought.
    expect(young.piliers.Growth).toBeCloseTo(same.piliers.Growth!, 10);
    // It is the coverage figure that carries the absence, where it belongs.
    expect(young.couverture).toBeLessThan(same.couverture);
  });
});
