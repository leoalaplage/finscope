import { describe, expect, it } from "vitest";
import { exposureBy, nameKey, parseNport, parseProspectus, type EtfHolding } from "../lib/adapters/etf";

const NPORT = `<edgarSubmission><formData><genInfo><seriesName>VANGUARD 500 INDEX FUND</seriesName><seriesId>S000002839</seriesId><repPdDate>2026-06-30</repPdDate></genInfo>
<fundInfo><totAssets>1000</totAssets><netAssets>1000</netAssets><returnInfo><monthlyTotReturns><monthlyTotReturn classId="C1" rtn1="1.5" rtn2="-2" rtn3="0.5"/></monthlyTotReturns></returnInfo></fundInfo>
<invstOrSecs>
<invstOrSec><name>Apple Inc</name><cusip>037833100</cusip><identifiers><isin value="US0378331005"/></identifiers><valUSD>66</valUSD><pctVal>6.6</pctVal><assetCat>EC</assetCat><issuerCat>CORP</issuerCat><invCountry>US</invCountry><curCd>USD</curCd></invstOrSec>
<invstOrSec><name>NVIDIA Corp</name><cusip>67066G104</cusip><identifiers><isin value="US67066G1040"/></identifiers><valUSD>75</valUSD><pctVal>7.5</pctVal><assetCat>EC</assetCat><issuerCat>CORP</issuerCat><invCountry>US</invCountry><curCd>USD</curCd></invstOrSec>
<invstOrSec><name>Treasury Bill</name><cusip>912797AA1</cusip><valUSD>3</valUSD><pctVal>0.3</pctVal><assetCat>DBT</assetCat><issuerCat>UST</issuerCat><invCountry>US</invCountry><curCd>USD</curCd></invstOrSec>
</invstOrSecs></formData></edgarSubmission>`;

const ctx = (id: string, dims: Array<[string, string]>, start: string, end: string) =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier>1</xbrli:identifier><xbrli:segment>${dims.map(([axis, member]) => `<xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember>`).join("")}</xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period></xbrli:context>`;
const ETF: Array<[string, string]> = [["dei:DocumentInformationDocumentAxis", "index:ETFProspectusMember"], ["dei:LegalEntityAxis", "index:S000002839Member"], ["oef:ClassAxis", "index:C000092055Member"]];
const PROSPECTUS = `<xbrli:xbrl>
${ctx("fees", ETF, "2025-12-31", "2025-12-31")}
${ctx("y2024", ETF, "2024-01-01", "2024-12-31")}
${ctx("y2025", ETF, "2025-01-01", "2025-12-31")}
${ctx("avg1", [...ETF, ["oef:PerformanceMeasureAxis", "index:BasedonNAVMember"]], "2025-01-01", "2025-12-31")}
${ctx("avg5", [...ETF, ["oef:PerformanceMeasureAxis", "index:BasedonNAVMember"]], "2021-01-01", "2025-12-31")}
${ctx("idx1", [["dei:DocumentInformationDocumentAxis", "index:ETFProspectusMember"], ["oef:PerformanceMeasureAxis", "index:StandardandPoors500IndexMember"]], "2025-01-01", "2025-12-31")}
${ctx("idx5", [["dei:DocumentInformationDocumentAxis", "index:ETFProspectusMember"], ["oef:PerformanceMeasureAxis", "index:StandardandPoors500IndexMember"]], "2021-01-01", "2025-12-31")}
${ctx("other1", [["dei:DocumentInformationDocumentAxis", "index:ETFProspectusMember"], ["oef:PerformanceMeasureAxis", "index:TotalBondIndexMember"]], "2025-01-01", "2025-12-31")}
<oef:ExpensesOverAssets contextRef="fees">0.0003</oef:ExpensesOverAssets>
<oef:ManagementFeesOverAssets contextRef="fees">0.0002</oef:ManagementFeesOverAssets>
<oef:AnnlRtrPct contextRef="y2024">0.2498</oef:AnnlRtrPct>
<oef:AnnlRtrPct contextRef="y2025">0.1784</oef:AnnlRtrPct>
<oef:AvgAnnlRtrPct contextRef="avg1">0.1784</oef:AvgAnnlRtrPct>
<oef:AvgAnnlRtrPct contextRef="avg5">0.1438</oef:AvgAnnlRtrPct>
<oef:AvgAnnlRtrPct contextRef="idx1">0.1788</oef:AvgAnnlRtrPct>
<oef:AvgAnnlRtrPct contextRef="idx5">0.1442</oef:AvgAnnlRtrPct>
<oef:AvgAnnlRtrPct contextRef="other1">0.0730</oef:AvgAnnlRtrPct>
</xbrli:xbrl>`;

describe("a fund read from its own filings", () => {
  it("reads every position, its weight and class, and the three months of returns", () => {
    const portfolio = parseNport(NPORT, { filed: "2026-08-28", url: "u" });
    expect(portfolio).toMatchObject({ name: "VANGUARD 500 INDEX FUND", asOf: "2026-06-30", netAssets: 1000, holdingsCount: 3 });
    expect(portfolio.holdings.map((holding) => [holding.name, holding.weight])).toEqual([["NVIDIA Corp", 0.075], ["Apple Inc", 0.066], ["Treasury Bill", 0.003]]);
    expect(portfolio.holdings[2]).toMatchObject({ assetClass: "Debt", issuerType: "US Treasury" });
    expect(portfolio.monthlyReturns).toEqual([{ month: "2026-04", value: 0.015 }, { month: "2026-05", value: -0.02 }, { month: "2026-06", value: 0.005 }]);
  });

  it("reads the fees, the years and the index whose returns the fund's own track", () => {
    const prospectus = parseProspectus(PROSPECTUS, "S000002839", "C000092055", { filed: "2026-04-28", url: "u" })!;
    expect(prospectus).toMatchObject({ expenseRatio: 0.0003, managementFee: 0.0002 });
    expect(prospectus.returns.calendar).toEqual([{ year: 2024, fund: 0.2498 }, { year: 2025, fund: 0.1784 }]);
    // The bond index in the same prospectus is not this fund's: its return is ten points away.
    expect(prospectus.returns.indexName).toBe("S&P 500 Index");
    expect(prospectus.returns.average).toEqual([{ years: 1, fund: 0.1784, index: 0.1788 }, { years: 5, fund: 0.1438, index: 0.1442 }]);
  });

  it("matches names without their legal suffixes, and groups exposure with the rest as Other", () => {
    expect(nameKey("Apple Inc.")).toBe(nameKey("APPLE INC"));
    expect(nameKey("The Coca-Cola Company")).toBe(nameKey("Coca Cola Co"));
    const holdings = ["A", "B", "C"].map((country, index) => ({ weight: 0.5 - index * 0.2, country }) as EtfHolding);
    expect(exposureBy(holdings, (holding) => holding.country, 2).map((entry) => entry.label)).toEqual(["A", "Other"]);
  });
});

describe("a SPDR fund's daily files and a commodity trust", () => {
  it("reads the issuer's dated holdings and its NAV history, and makes flows of the shares", async () => {
    const { parseSsgaHoldings, parseSsgaNavHistory } = await import("../lib/adapters/ssga");
    const { flowSince, monthlyFlows } = await import("../lib/adapters/etf");
    const holdings = parseSsgaHoldings([
      ["Fund Name:", "SPDR S&P 500 ETF Trust"], ["Holdings:", "As of 12-Oct-2026"],
      ["Name", "Ticker", "Identifier", "SEDOL", "Weight", "Sector", "Shares Held", "Local Currency"],
      ["APPLE INC", "AAPL", "037833100", "2046251", "7.396685", "-", "1.78620809E8", "USD"],
      ["NVIDIA CORP", "NVDA", "67066G104", "2379504", "8.141004", "-", "2.96187117E8", "USD"],
    ], "u");
    expect(holdings).toMatchObject({ asOf: "2026-10-12", holdings: [{ ticker: "NVDA", weight: 0.08141004 }, { ticker: "AAPL", cusip: "037833100" }] });
    const history = parseSsgaNavHistory([
      ["Date", "NAV", "Shares Outstanding", "Total Net Assets"],
      ["13-Oct-2026", "777.86", "1.058332116E9", "8.2E11"], ["12-Oct-2026", "778.02", "1.055382116E9", "8.2E11"], ["30-Sep-2026", "770", "1.05E9", "8.1E11"],
    ]);
    expect(history.map((day) => day.date)).toEqual(["2026-09-30", "2026-10-12", "2026-10-13"]);
    // 2.95m shares created on the 13th at 777.86.
    expect(monthlyFlows(history).at(-1)!.flow).toBeCloseTo((1.055382116e9 - 1.05e9) * 778.02 + 2.95e6 * 777.86, 0);
    expect(flowSince(history, 1)).toBeCloseTo(2.95e6 * 777.86, 0);
  });

  it("reads a gold trust's portfolio, fees and quarterly creations under either family's names", async () => {
    const { parseCommodityTrust } = await import("../lib/adapters/etf");
    const fact = (end: string, val: number, start?: string) => ({ start, end, val, form: "10-Q", filed: "2026-08-01" });
    const trust = parseCommodityTrust({ "us-gaap": {
      InvestmentInPhysicalCommoditiesFairValueDisclosure: { units: { USD: [fact("2026-06-30", 60e9)] } },
      InvestmentOwnedAtFairValue: { units: { USD: [fact("2026-06-30", 60.1e9)] } },
      NetAssetValuePerShare: { units: { "USD/shares": [fact("2026-06-30", 75.72)] } },
      TemporaryEquitySharesOutstanding: { units: { shares: [fact("2026-06-30", 793.6e6)] } },
      InvestmentCompanyExpenseRatioBeforeIncentiveAllocation: { units: { pure: [fact("2026-06-30", 0.0025)] } },
      TemporaryEquityStockIssuedDuringPeriodValueNewIssues: { units: { USD: [fact("2026-06-30", 1.66e9, "2026-04-01")] } },
      StockRedeemedOrCalledDuringPeriodValue: { units: { USD: [fact("2026-06-30", 2.1e9, "2026-04-01")] } },
    } }, "ISHARES GOLD TRUST")!;
    expect(trust).toMatchObject({ commodity: "Gold", netAssets: 60.1e9, navPerShare: 75.72, shares: 793.6e6, expenseRatio: 0.0025 });
    expect(trust.flows).toEqual([{ end: "2026-06-30", created: 1.66e9, redeemed: 2.1e9 }]);
  });
});
