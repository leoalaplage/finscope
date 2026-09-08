import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { companyView } from "../lib/io/view";

/*
 * The fixture is XOM's own SEC company-facts document, cut to the concepts
 * this adapter reads. Refresh it with:
 *
 *   SEC_USER_AGENT="you you@example.com" node scripts/fetch-fixture.mjs XOM 0000034088
 */

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
    const view = companyView(normalizeSecPayload(JSON.parse(readFileSync(new URL("./fixtures/xom-facts.json", import.meta.url), "utf8")), "XOM", new Date().toISOString(), XOM));
    const latest = view.ttm ?? view.annual.at(-1)!;
    const v = latest.values;
    expect(v.operatingIncome).not.toBeNull();
    // EBIT is pre-tax income plus interest expense: the definition, not an
    // approximation, and addition on two published facts in one period.
    expect(v.operatingIncome!).toBeCloseTo(v.incomeBeforeTax! + Math.abs(v.interestExpense!), -6);
    for (const key of ["operatingMargin", "ebitda", "roic", "interestCoverage"]) {
      expect(v[key]).not.toBeNull();
    }
    /*
     * The six measures that rest on the subtotal, checked as figures rather
     * than merely as present. This used to print them to a file in /tmp for a
     * human to read, which is a script and not a test: nothing failed when the
     * numbers moved, and the file it read was a download nobody else had, so
     * the assertions above ran on no machine but the one that wrote them.
     */
    expect(v.operatingMargin!).toBeGreaterThan(0);
    expect(v.operatingMargin!).toBeLessThan(0.35);
    expect(v.ebitda!).toBeGreaterThan(v.operatingIncome!);
    expect(v.roic!).toBeGreaterThan(0);
    expect(v.interestCoverage!).toBeGreaterThan(1);
  });
});
