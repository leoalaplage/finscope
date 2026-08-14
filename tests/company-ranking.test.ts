import { describe, expect, it } from "vitest";
import { DEFAULT_COMPANY_SORT, filterCompanyRows, preferredDirection, sortCompanyRows, type CompanyRankingRow } from "../lib/company-ranking";

const row = (ticker: string, values: Partial<CompanyRankingRow> = {}): CompanyRankingRow => ({
  ticker,
  marketCap: 100,
  fcfMargin: .1,
  fcfShareCagr: .08,
  revenueCagr10: .07,
  fcfCagr10: .09,
  fcfVsRevenue10: .02,
  fcfConsistency5: .9,
  fcfConsistency10: .85,
  fcfAfterSbcMargin: .08,
  roic: .2,
  roiic5: .25,
  ruleOfForty: .45,
  capitalIntensity: .05,
  fcfDrawdown: .12,
  revenueShareCagr: .06,
  operatingMargin: .12,
  dilution: .02,
  pfcf: 20,
  valuationVsAverage: .05,
  updated: "2026-01-01",
  ...values,
});

describe("Companies ranking", () => {
  it("defaults to Market Cap descending", () => expect(DEFAULT_COMPANY_SORT).toEqual({ key: "marketCap", direction: "desc" }));
  it("sorts FCF Margin descending from raw decimals", () => expect(sortCompanyRows([row("A", { fcfMargin: .185 }), row("B", { fcfMargin: .21 })], "fcfMargin", "desc").map((item) => item.ticker)).toEqual(["B", "A"]));
  it("sorts FCF Margin ascending on the second direction", () => expect(sortCompanyRows([row("A", { fcfMargin: .185 }), row("B", { fcfMargin: .21 })], "fcfMargin", "asc").map((item) => item.ticker)).toEqual(["A", "B"]));
  it("sorts billions and trillions numerically", () => expect(sortCompanyRows([row("BN", { marketCap: 900e9 }), row("TN", { marketCap: 1.2e12 })], "marketCap", "desc").map((item) => item.ticker)).toEqual(["TN", "BN"]));
  it("sorts CAGR descending", () => expect(sortCompanyRows([row("A", { fcfShareCagr: .05 }), row("B", { fcfShareCagr: .14 })], "fcfShareCagr", "desc")[0].ticker).toBe("B"));
  it("sorts dilution ascending", () => expect(sortCompanyRows([row("A", { dilution: .05 }), row("B", { dilution: -.02 })], "dilution", "asc")[0].ticker).toBe("B"));
  it("sorts P/FCF ascending", () => expect(sortCompanyRows([row("A", { pfcf: 31 }), row("B", { pfcf: 19 })], "pfcf", "asc")[0].ticker).toBe("B"));
  it("places missing values last when descending", () => expect(sortCompanyRows([row("A", { fcfMargin: null }), row("B", { fcfMargin: .1 })], "fcfMargin", "desc").map((item) => item.ticker)).toEqual(["B", "A"]));
  it("places missing values last when ascending", () => expect(sortCompanyRows([row("A", { pfcf: null }), row("B", { pfcf: 20 })], "pfcf", "asc").map((item) => item.ticker)).toEqual(["B", "A"]));
  it("places loading values last without treating them as zero", () => expect(sortCompanyRows([row("A", { marketCap: 1e12, loading: true }), row("B", { marketCap: 10 })], "marketCap", "desc")[0].ticker).toBe("B"));
  it("breaks metric ties by Market Cap descending", () => expect(sortCompanyRows([row("A", { marketCap: 20 }), row("B", { marketCap: 40 })], "fcfMargin", "desc")[0].ticker).toBe("B"));
  it("breaks remaining ties alphabetically", () => expect(sortCompanyRows([row("B"), row("A")], "fcfMargin", "desc").map((item) => item.ticker)).toEqual(["A", "B"]));
  it("filters by ticker only", () => expect(filterCompanyRows([row("AAPL"), row("MSFT")], { query: "aap", minimumMarketCap: null, minimumFcfMargin: null, minimumFcfShareCagr: null, maximumDilution: null }).map((item) => item.ticker)).toEqual(["AAPL"]));
  it("combines all numeric filters", () => expect(filterCompanyRows([row("PASS", { marketCap: 1e12, fcfMargin: .2, fcfShareCagr: .15, dilution: .01 }), row("FAIL", { marketCap: 2e9, fcfMargin: .01, fcfShareCagr: .01, dilution: .2 })], { query: "", minimumMarketCap: 100e9, minimumFcfMargin: .1, minimumFcfShareCagr: .1, maximumDilution: .05 }).map((item) => item.ticker)).toEqual(["PASS"]));
  it("combines filtering and ranking", () => { const filtered = filterCompanyRows([row("A", { marketCap: 200 }), row("B", { marketCap: 300 }), row("C", { marketCap: 20 })], { query: "", minimumMarketCap: 100, minimumFcfMargin: null, minimumFcfShareCagr: null, maximumDilution: null }); expect(sortCompanyRows(filtered, "marketCap", "desc").map((item) => item.ticker)).toEqual(["B", "A"]); });
  it("uses financially meaningful first-click directions", () => { expect(preferredDirection("fcfMargin")).toBe("desc"); expect(preferredDirection("dilution")).toBe("asc"); expect(preferredDirection("pfcf")).toBe("asc"); expect(preferredDirection("updated")).toBe("desc"); });
});
