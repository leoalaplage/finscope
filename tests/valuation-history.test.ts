import {describe,expect,it} from "vitest";
import {buildValuationHistory,valuationSnapshot,valuationStatistics} from "../lib/valuation-history";
import type {FinancialPeriod,PricePoint} from "../lib/types";
const fact=(metric:string,value:number)=>({metric,value,currency:"USD",unit:"currency",periodEnd:"2025-12-31",periodicity:"ttm",fiscalYear:2025,provenance:{provider:"SEC",sourceUrl:"x",retrievedAt:"x",concept:metric,status:"reported"}} as never);
const period={label:"TTM",fiscalYear:2025,periodEnd:"2025-12-31",periodicity:"ttm",filingDate:"2026-02-10",accession:"x",currency:"USD",facts:{revenue:fact("revenue",100),netIncome:fact("netIncome",-10),operatingIncome:fact("operatingIncome",20),operatingCashFlow:fact("operatingCashFlow",25),capitalExpenditures:fact("capitalExpenditures",-5),dilutedShares:fact("dilutedShares",10),cashAndEquivalents:fact("cashAndEquivalents",5),totalDebt:fact("totalDebt",15)}} as FinancialPeriod;
const point=(date:string):PricePoint=>({close:20,priceClose:20,totalReturnClose:19,adjustedClose:19,date,requestedDate:"2026-02-10",currency:"USD",ticker:"X",type:"split-adjusted close",fallback:"exact date",distanceDays:0,sourceUrl:"x"});
describe("point-in-time valuation",()=>{
 it("excludes negative denominators",()=>{const result=valuationSnapshot(period,point("2026-02-10"))!;expect(result.metrics.priceToEarnings).toBeNull();expect(result.metrics.priceToSales).toBe(2);expect(result.enterpriseValue).toBe(210)});
 it("never uses fundamentals before their filing date",()=>{expect(buildValuationHistory([period],{"2026-02-10":point("2026-02-09")})).toHaveLength(0);expect(buildValuationHistory([period],{"2026-02-10":point("2026-02-10")})).toHaveLength(1)});
 it("computes trailing statistics only from meaningful observations",()=>{const one=valuationSnapshot(period,point("2026-02-10"))!;const two={...one,date:"2027-02-10",metrics:{...one.metrics,priceToSales:4}};const stats=valuationStatistics([one,two],"priceToSales",3,5);expect(stats.average).toBe(3);expect(stats.median).toBe(3);expect(stats.percentile).toBe(.5)});
});
