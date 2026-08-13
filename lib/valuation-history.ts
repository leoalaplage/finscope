import { derivedValue, safeDivide, valueOf } from "./finance";
import type { FinancialPeriod, PricePoint } from "./types";

export type ValuationMetric = "priceToEarnings"|"priceToSales"|"priceToFreeCashFlow"|"priceToOperatingCashFlow"|"enterpriseToSales"|"enterpriseToEbit"|"enterpriseToEbitda"|"enterpriseToFreeCashFlow"|"earningsYield"|"freeCashFlowYield"|"operatingCashFlowYield"|"buybackYield";
export const VALUATION_DEFINITIONS:Record<ValuationMetric,{label:string;short:string;yield:boolean}>={
  priceToEarnings:{label:"Price / Earnings",short:"P/E",yield:false}, priceToSales:{label:"Price / Sales",short:"P/S",yield:false},
  priceToFreeCashFlow:{label:"Price / Free cash flow",short:"P/FCF",yield:false}, priceToOperatingCashFlow:{label:"Price / Operating cash flow",short:"P/OCF",yield:false},
  enterpriseToSales:{label:"Enterprise value / Sales",short:"EV/Sales",yield:false}, enterpriseToEbit:{label:"Enterprise value / EBIT",short:"EV/EBIT",yield:false},
  enterpriseToEbitda:{label:"Enterprise value / EBITDA",short:"EV/EBITDA",yield:false}, enterpriseToFreeCashFlow:{label:"Enterprise value / FCF",short:"EV/FCF",yield:false},
  earningsYield:{label:"Earnings yield",short:"Earnings yield",yield:true}, freeCashFlowYield:{label:"Free cash flow yield",short:"FCF yield",yield:true},
  operatingCashFlowYield:{label:"Operating cash flow yield",short:"OCF yield",yield:true}, buybackYield:{label:"Net buyback yield",short:"Buyback yield",yield:true},
};
export interface ValuationSnapshot { date:string; filingDate:string; periodEnd:string; price:number; shares:number; marketCap:number; enterpriseValue:number; metrics:Record<ValuationMetric,number|null> }

function positiveMultiple(numerator:number|null,denominator:number|null){return numerator!=null&&denominator!=null&&numerator>0&&denominator>0?numerator/denominator:null}
export function valuationSnapshot(period:FinancialPeriod,point:PricePoint):ValuationSnapshot|null{
  const shares=derivedValue(period,"dilutedShares")??derivedValue(period,"sharesOutstanding"); const price=point.priceClose??point.close;
  if(shares==null||shares<=0||price<=0)return null;const marketCap=price*shares;const debt=valueOf(period,"totalDebt")??0;const cash=valueOf(period,"cashAndEquivalents")??0;const enterpriseValue=marketCap+debt-cash;
  const revenue=derivedValue(period,"revenue");const earnings=derivedValue(period,"netIncome");const ocf=derivedValue(period,"operatingCashFlow");const fcf=derivedValue(period,"freeCashFlow");const ebit=derivedValue(period,"operatingIncome");const da=derivedValue(period,"depreciationAndAmortization");const ebitda=ebit!=null&&da!=null?ebit+da:null;const buybacks=derivedValue(period,"netShareRepurchases");
  const metrics:Record<ValuationMetric,number|null>={priceToEarnings:positiveMultiple(marketCap,earnings),priceToSales:positiveMultiple(marketCap,revenue),priceToFreeCashFlow:positiveMultiple(marketCap,fcf),priceToOperatingCashFlow:positiveMultiple(marketCap,ocf),enterpriseToSales:positiveMultiple(enterpriseValue,revenue),enterpriseToEbit:positiveMultiple(enterpriseValue,ebit),enterpriseToEbitda:positiveMultiple(enterpriseValue,ebitda),enterpriseToFreeCashFlow:positiveMultiple(enterpriseValue,fcf),earningsYield:earnings!=null&&earnings>0?safeDivide(earnings,marketCap):null,freeCashFlowYield:fcf!=null&&fcf>0?safeDivide(fcf,marketCap):null,operatingCashFlowYield:ocf!=null&&ocf>0?safeDivide(ocf,marketCap):null,buybackYield:buybacks!=null?safeDivide(buybacks,marketCap):null};
  return {date:point.date,filingDate:period.filingDate,periodEnd:period.periodEnd,price,shares,marketCap,enterpriseValue,metrics};
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
export function valuationAssessment(stats:ValuationStatistics,isYield:boolean,threshold=.1){if(stats.current==null||stats.average==null)return"Insufficient comparable history";const delta=isYield?stats.current-stats.average:stats.current/stats.average-1;if(Math.abs(delta)<=threshold)return"Near its five-year average";if(isYield)return delta>0?"Yield above its five-year average":"Yield below its five-year average";return delta>0?"Above its five-year average":"Below its five-year average"}
