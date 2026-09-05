import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { companyView } from "../lib/io/view";

const XOM = {
  name: "Exxon Mobil Corporation", ticker: "XOM", yahooTicker: "XOM", cik: "0000034088",
  regulatoryId: "CIK 0000034088", exchange: "NYSE", currency: "USD", sector: "Energy",
  description: "Integrated energy and chemical operations.",
  businessType: "operating" as const, resolutionStatus: "verified" as const,
};

describe("a filer that publishes no operating income subtotal", () => {
  it("still has an EBIT, and everything that rests on it", () => {
    /*
     * The bug this exists for. Exxon tags no operating income at all, and six
     * measures rest on it — the operating margin, EBITDA, return on invested
     * capital and its five-year average, net debt to EBITDA, interest cover —
     * so it came out of the screener unrated on barely half its data, while the
     * two figures the subtotal is made of sat in the same filing.
     */
    const view = companyView(normalizeSecPayload(JSON.parse(readFileSync("/tmp/xom-facts.json", "utf8")), "XOM", new Date().toISOString(), XOM));
    const latest = view.ttm ?? view.annual.at(-1)!;
    const v = latest.values;
    expect(v.operatingIncome).not.toBeNull();
    // EBIT is pre-tax income plus interest expense: the definition, not an
    // approximation, and addition on two published facts in one period.
    expect(v.operatingIncome!).toBeCloseTo(v.incomeBeforeTax! + Math.abs(v.interestExpense!), -6);
    for (const key of ["operatingMargin", "ebitda", "roic", "interestCoverage"]) {
      expect(v[key]).not.toBeNull();
    }
    writeFileSync("/tmp/xom.out", [
      `EBIT ${(v.operatingIncome! / 1e9).toFixed(1)}B = pretax ${(v.incomeBeforeTax! / 1e9).toFixed(1)}B + interest ${(Math.abs(v.interestExpense!) / 1e9).toFixed(1)}B`,
      `marge operationnelle ${(v.operatingMargin! * 100).toFixed(1)}% | EBITDA ${(v.ebitda! / 1e9).toFixed(1)}B | ROIC ${(v.roic! * 100).toFixed(1)}%`,
    ].join("\n"));
  });
});
