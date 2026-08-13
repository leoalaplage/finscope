import { describe,expect,it } from "vitest";
import { DEFAULT_WATCHLIST,addCompanyUnique,companyByTicker } from "../lib/company-registry";
import { IMPORT_PIPELINE,nextImportState,resumeImportState } from "../lib/imports";

const requested=["NVDA","AAPL","GOOGL","MSFT","META","V","MA","ANET","HESA.F","BKNG","NOW","SPGI","ABNB","CME","PAYX","IBKR","MSCI","VEEV","ZTS","CBOE","CPRT","FDS"];
describe("default watchlist and import workflow",()=>{
  it("contains exactly the 22 requested tickers in order",()=>expect(DEFAULT_WATCHLIST.map((company)=>company.ticker)).toEqual(requested));
  it("does not retain old initial selections",()=>{expect(companyByTicker("AMZN")).toBeUndefined();expect(companyByTicker("TSLA")).toBeUndefined();expect(companyByTicker("PLTR")).toBeUndefined()});
  it("retains the exact unresolved international instrument",()=>{const hesa=companyByTicker("HESA.F")!;expect(hesa.yahooTicker).toBe("HESA.F");expect(hesa.currency).toBe("EUR");expect(hesa.resolutionStatus).toBe("unresolved");expect(hesa.resolutionNote).toMatch(/not substitute/)});
  it("prevents duplicate additions",()=>expect(addCompanyUnique(DEFAULT_WATCHLIST,DEFAULT_WATCHLIST[0])).toBe(DEFAULT_WATCHLIST));
  it("supports resumable, explicit background stages",()=>{expect(IMPORT_PIPELINE).toContain("Loading quarterly statements");expect(nextImportState("Queued")).toBe("Resolving company");expect(resumeImportState("Failed")).toBe("Queued");expect(resumeImportState("Complete")).toBe("Complete")});
});
