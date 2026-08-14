import { describe,expect,it } from "vitest";
import { validateCompanyDataset, validatedDerivedValue, validationForMetric } from "../lib/data-quality";
import { APPLE_DATASET } from "../lib/demo-data";
import type { CompanyDataset, FinancialPeriod, MetricKey, NormalizedFact } from "../lib/types";

function period(year:number,shares=100):FinancialPeriod{const make=(metric:MetricKey,value:number):NormalizedFact=>({metric,value,currency:"USD",unit:metric.includes("Shares")||metric==="dilutedShares"?"shares":"currency",periodEnd:`${year}-12-31`,periodicity:"annual",fiscalYear:year,provenance:{provider:"SEC",sourceUrl:"https://sec.test",retrievedAt:"2026-08-13",concept:metric,status:"reported"}});return {label:`FY ${year}`,fiscalYear:year,periodStart:`${year}-01-01`,periodEnd:`${year}-12-31`,periodicity:"annual",filingDate:`${year+1}-02-01`,accession:"a",currency:"USD",facts:{revenue:make("revenue",1000),operatingCashFlow:make("operatingCashFlow",200),capitalExpenditures:make("capitalExpenditures",50),dilutedShares:make("dilutedShares",shares)}}}
function dataset(periods:FinancialPeriod[]):CompanyDataset{return {company:{name:"Test",ticker:"TEST",cik:"1",exchange:"X",currency:"USD",sector:"",description:""},periods,retrievedAt:"2026-08-13T00:00:00Z",warnings:[]}}

describe("central data validation",()=>{
  it("verifies formulas and preserves suspected share anomalies",()=>{const checked=validateCompanyDataset(dataset([period(2024,100),period(2025,100_000)]));expect(checked.periods[1].facts.dilutedShares?.validation?.status).toBe("Suspected anomaly");expect(validatedDerivedValue(checked.periods[1],"freeCashFlowPerShare")).toBeCloseTo(.0015);expect(checked.quality?.issues[0].action).toMatch(/retained/i)});
  it("creates a gap for confirmed invalid dependencies in validated mode but exposes raw mode",()=>{const item=period(2025);item.facts.dilutedShares!.validation={status:"Confirmed invalid",reason:"unit",rawValue:100,normalizedValue:null,checkedAt:"now"};expect(validatedDerivedValue(item,"freeCashFlowPerShare","validated")).toBeNull();expect(validatedDerivedValue(item,"freeCashFlowPerShare","raw")).toBe(1.5);expect(validationForMetric(item,"freeCashFlowPerShare").reason).toContain("dilutedShares")});
  it("reports missing dependencies exactly",()=>{const item=period(2025);delete item.facts.capitalExpenditures;expect(validationForMetric(item,"freeCashFlow").status).toBe("Missing");expect(validationForMetric(item,"freeCashFlow").reason).toContain("capitalExpenditures")});
});

describe("offline fixture identity", () => {
  it("labels the Apple fixture as Apple, not whichever company sits first in the watchlist", () => {
    expect(APPLE_DATASET.company.ticker).toBe("AAPL");
    expect(APPLE_DATASET.company.cik).toBe("0000320193");
    // The rows are Apple filings; the accession numbers must agree with the profile.
    const accessions = APPLE_DATASET.periods.map((period) => period.accession);
    expect(accessions.some((accession) => accession.startsWith("0000320193-"))).toBe(true);
  });
});
