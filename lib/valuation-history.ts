import { derivedValue, safeDivide, valueOf } from "./finance";
import { marketBasis, multipleOf, type SharesBasis } from "./market-basis";
import { runMarketInvariants } from "./accounting-invariants";
import type { AccountingInvariantResult, FinancialPeriod, PricePoint } from "./types";

export type ValuationMetric = "priceToEarnings"|"priceToSales"|"priceToFreeCashFlow"|"priceToOperatingCashFlow"|"enterpriseToSales"|"enterpriseToEbit"|"enterpriseToEbitda"|"enterpriseToFreeCashFlow"|"earningsYield"|"freeCashFlowYield"|"operatingCashFlowYield"|"buybackYield"|"shareholderYield";
export interface ValuationSnapshot { date:string; filingDate:string; periodEnd:string; price:number; shares:number; sharesBasis:SharesBasis; marketCap:number; enterpriseValue:number|null; unavailable?:string; metrics:Record<ValuationMetric,number|null>; invariants:AccountingInvariantResult[] }

const positiveMultiple=multipleOf;
/**
 * A priced period, or nothing at all.
 *
 * The currency check, the share-count basis and the refusal to read a missing
 * debt balance as zero all live in `marketBasis`, so this snapshot and the
 * headline figure on the company page can no longer disagree about what a
 * market capitalisation is. Enterprise value is now nullable: a company whose
 * borrowings this adapter cannot read has no enterprise value, and every
 * multiple built on one goes with it.
 */
export function valuationSnapshot(period:FinancialPeriod,point:PricePoint):ValuationSnapshot|null{
  const {basis}=marketBasis(period,point);
  if(!basis)return null;
  const {price,shares,marketCap,enterpriseValue}=basis;
  const revenue=derivedValue(period,"revenue");const earnings=derivedValue(period,"netIncome");const ocf=derivedValue(period,"operatingCashFlow");const fcf=derivedValue(period,"freeCashFlow");const ebit=derivedValue(period,"operatingIncome");const da=derivedValue(period,"depreciationAndAmortization");const ebitda=ebit!=null&&da!=null?ebit+da:null;const buybacks=derivedValue(period,"netShareRepurchases");
  const dividends=derivedValue(period,"dividendsPaid");const metrics:Record<ValuationMetric,number|null>={priceToEarnings:positiveMultiple(marketCap,earnings),priceToSales:positiveMultiple(marketCap,revenue),priceToFreeCashFlow:positiveMultiple(marketCap,fcf),priceToOperatingCashFlow:positiveMultiple(marketCap,ocf),enterpriseToSales:positiveMultiple(enterpriseValue,revenue),enterpriseToEbit:positiveMultiple(enterpriseValue,ebit),enterpriseToEbitda:positiveMultiple(enterpriseValue,ebitda),enterpriseToFreeCashFlow:positiveMultiple(enterpriseValue,fcf),earningsYield:earnings!=null&&earnings>0?safeDivide(earnings,marketCap):null,freeCashFlowYield:fcf!=null&&fcf>0?safeDivide(fcf,marketCap):null,operatingCashFlowYield:ocf!=null&&ocf>0?safeDivide(ocf,marketCap):null,buybackYield:buybacks!=null?safeDivide(buybacks,marketCap):null,shareholderYield:buybacks!=null||dividends!=null?safeDivide((buybacks??0)+(dividends??0),marketCap):null};
  const fundamentalSources=Object.values(period.facts).flatMap((fact)=>fact?.provenance.sourceUrl?[fact.provenance.sourceUrl]:[]);const invariants=runMarketInvariants({ticker:point.ticker,date:point.date,price,shares,marketCap,debt:valueOf(period,"totalDebt"),cash:valueOf(period,"cashAndEquivalents"),otherAdjustments:0,enterpriseValue,freeCashFlow:fcf,priceToFreeCashFlow:metrics.priceToFreeCashFlow,freeCashFlowYield:metrics.freeCashFlowYield,priceToEarnings:metrics.priceToEarnings,earningsYield:metrics.earningsYield,priceSource:point.sourceUrl,fundamentalSources});
  return {date:point.date,filingDate:period.filingDate,periodEnd:period.periodEnd,price,shares,sharesBasis:basis.sharesBasis,marketCap,enterpriseValue,unavailable:basis.enterpriseValueReason,metrics,invariants};
}
export function buildValuationHistory(periods:FinancialPeriod[],points:Record<string,PricePoint|null>){
  return periods.filter((period)=>period.periodicity==="ttm").sort((a,b)=>a.filingDate.localeCompare(b.filingDate)).flatMap((period)=>{
    const point=points[period.filingDate]; if(!point||point.date<period.filingDate)return[];const snapshot=valuationSnapshot(period,point);return snapshot?[snapshot]:[];
  });
}
export interface ValuationStatistics {current:number|null;average:number|null;median:number|null;min:number|null;max:number|null;premiumToAverage:number|null;percentile:number|null;observations:number;startDate:string|null;endDate:string|null}
export function valuationStatistics(history:ValuationSnapshot[],metric:ValuationMetric,current:number|null,years=5):ValuationStatistics{
  const end=history.at(-1)?.date??null;const cutoff=end?new Date(`${end}T00:00:00Z`):null;if(cutoff)cutoff.setUTCFullYear(cutoff.getUTCFullYear()-years);
  const observations=history.filter((item)=>!cutoff||item.date>=cutoff.toISOString().slice(0,10)).map((item)=>({date:item.date,value:item.metrics[metric]})).filter((item):item is {date:string;value:number}=>item.value!=null&&Number.isFinite(item.value));const values=observations.map((item)=>item.value).sort((a,b)=>a-b);const average=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;const median=values.length?(values[Math.floor((values.length-1)/2)]+values[Math.ceil((values.length-1)/2)])/2:null;
  return {current,average,median,min:values[0]??null,max:values.at(-1)??null,premiumToAverage:current!=null&&average!=null&&average!==0?current/average-1:null,percentile:current!=null&&values.length?values.filter((value)=>value<=current).length/values.length:null,observations:values.length,startDate:observations[0]?.date??null,endDate:observations.at(-1)?.date??null};
}
