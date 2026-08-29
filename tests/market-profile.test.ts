import { describe, expect, it } from "vitest";
import { resolveMarketProfile, TICKER_PATTERN } from "../lib/market-profile";
import { companyByTicker } from "../lib/company-registry";

describe("resolving a company for market data", () => {
  it("prefers the registry, so a known company keeps its split history", () => {
    const apple = resolveMarketProfile("aapl");
    expect(apple).toBe(companyByTicker("AAPL"));
    expect(apple?.stockSplits?.length).toBeGreaterThan(0);
  });

  it("resolves a company the registry has never heard of", () => {
    /*
     * The bug this exists for. `/api/company/COST` returned a fully normalized
     * set of filings while `/api/price/COST` answered 404 "Ticker not
     * supported", because the price endpoints read the twenty-one-company
     * registry and the fundamentals endpoint read the SEC. So the first company
     * a reader added themselves loaded its financials and then showed no price,
     * no market capitalisation, no valuation multiple, no chart and no DCF.
     */
    const profile = resolveMarketProfile("COST");
    expect(profile?.ticker).toBe("COST");
    expect(profile?.yahooTicker).toBe("COST");
  });

  it("does not claim a split history it has not verified", () => {
    // A synthesised profile must never let a long per-share price series look
    // as vouched-for as a registry company's.
    const profile = resolveMarketProfile("COST");
    expect(profile?.stockSplits).toBeUndefined();
    expect(profile?.resolutionStatus).toBe("partial");
    expect(profile?.resolutionNote).toMatch(/split/i);
  });

  it("refuses anything that is not shaped like an exchange symbol", () => {
    // The symbol arrives in a path anyone may write, and is passed to an
    // upstream request.
    expect(resolveMarketProfile("<script>")).toBeNull();
    expect(resolveMarketProfile("")).toBeNull();
    expect(resolveMarketProfile("a very long symbol")).toBeNull();
  });

  it("keeps the dots and dashes real symbols carry", () => {
    expect(resolveMarketProfile("brk.b")?.ticker).toBe("BRK.B");
    expect(resolveMarketProfile("rds-a")?.ticker).toBe("RDS-A");
    expect(TICKER_PATTERN.test("BRK.B")).toBe(true);
  });
});
