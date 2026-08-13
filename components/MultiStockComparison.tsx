"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Eye, EyeOff, Info, Loader2, Plus, Search, X } from "lucide-react";
import { CHART_PALETTE, chartDomain, indexedTo100, rechartsCurve, type CurveStyle, type ScaleMode } from "@/lib/charting";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { validatedDerivedValue } from "@/lib/data-quality";
import { safeDivide } from "@/lib/finance";
import { METRICS } from "@/lib/metrics";
import { analyzeVisibleSeries, formatVisibleAnalysis } from "@/lib/series-analysis";
import type { CompanyDataset, FinancialPeriod, MarketBar, MarketFrequency, Periodicity } from "@/lib/types";

const METRIC_GROUPS: Record<string,string[]> = {
  Market: ["stockPrice","stockTotalReturn","marketCapitalization","priceToSales","priceToEarnings","priceToFreeCashFlow","freeCashFlowYield"],
  Financials: ["revenue","grossProfit","operatingIncome","netIncome","operatingCashFlow","freeCashFlow","stockBasedCompensation"],
  "Per share": ["revenuePerShare","netIncomePerShare","freeCashFlowPerShare","dilutedShares","sharesOutstanding"],
  Margins: ["grossMargin","operatingMargin","netMargin","freeCashFlowMargin","cashConversion"],
};
const PRICE_METRICS = new Set(METRIC_GROUPS.Market);
const DIRECT_MARKET_METRICS = new Set(["stockPrice","stockTotalReturn"]);
const MARKET_FREQUENCIES = new Set(["daily","weekly","monthly","quarterly-market","annual-market"]);
type Frequency = Periodicity | "daily" | "weekly" | "monthly" | "quarterly-market" | "annual-market";
type Axis="left"|"right"; type ChartType="line"|"bar"|"area"; type Transform="raw"|"growth"|"indexed";
interface SeriesConfig { visible:boolean; axis:Axis; type:ChartType; curve:CurveStyle; color:string; transform:Transform; showCagr:boolean }

function selectedPeriods(dataset:CompanyDataset, frequency:Frequency, range:number){
  if(MARKET_FREQUENCIES.has(frequency)) return [];
  const all=dataset.periods.filter((period)=>period.periodicity===frequency).sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd));
  return range===999?all:all.slice(-range);
}
function valueAt(periods:FinancialPeriod[],index:number,metric:string,price:number|null){
  const period=periods[index]; const value=(key:string)=>validatedDerivedValue(period,key,"validated");
  const shares=value("dilutedShares")??value("sharesOutstanding"); const marketCap=price!=null&&shares!=null?price*shares:null;
  if(metric==="stockPrice") return price;
  if(metric==="marketCapitalization") return marketCap;
  if(metric==="priceToSales") return value("revenue")!>0?safeDivide(marketCap,value("revenue")):null;
  if(metric==="priceToEarnings") return value("netIncome")!>0?safeDivide(marketCap,value("netIncome")):null;
  if(metric==="priceToFreeCashFlow") return value("freeCashFlow")!>0?safeDivide(marketCap,value("freeCashFlow")):null;
  if(metric==="freeCashFlowYield") return marketCap!>0?safeDivide(value("freeCashFlow"),marketCap):null;
  return value(metric);
}
function seriesKey(ticker:string,metric:string){return `${ticker}:${metric}`}
function autoAxis(metric:string,metrics:string[]):Axis{
  const kinds=metrics.map((key)=>METRICS[key]?.kind); const kind=METRICS[metric]?.kind;
  if(kind==="percent"||kind==="ratio") return kinds.some((item)=>item!=="percent"&&item!=="ratio")?"right":"left";
  if(kind==="perShare") return kinds.some((item)=>item==="currency"||item==="shares")?"right":"left";
  return "left";
}

export function MultiStockComparison({initialData}:{initialData:CompanyDataset}){
  const [datasets,setDatasets]=useState<Record<string,CompanyDataset>>({[initialData.company.ticker]:initialData});
  const [companies,setCompanies]=useState([initialData.company.ticker]); const [metrics,setMetrics]=useState(["stockPrice","freeCashFlowPerShare"]); const [configs,setConfigs]=useState<Record<string,SeriesConfig>>({});
  const [frequency,setFrequency]=useState<Frequency>("annual"); const [range,setRange]=useState(10); const [scale,setScale]=useState<ScaleMode>("zero");
  const [loading,setLoading]=useState(""); const [search,setSearch]=useState(""); const [prices,setPrices]=useState<Record<string,number|null>>({}); const [totalReturns,setTotalReturns]=useState<Record<string,number|null>>({});
  const [bars,setBars]=useState<Record<string,MarketBar[]>>({}); const [marketLoading,setMarketLoading]=useState(false); const [marketError,setMarketError]=useState("");

  const crossProduct=useMemo(()=>companies.flatMap((ticker)=>metrics.map((metric)=>({ticker,metric,key:seriesKey(ticker,metric)}))),[companies,metrics]);
  useEffect(()=>{queueMicrotask(()=>setConfigs((current)=>{const next={...current};crossProduct.forEach((item,index)=>{next[item.key]??={visible:true,axis:autoAxis(item.metric,metrics),type:"line",curve:"straight",color:CHART_PALETTE[index%CHART_PALETTE.length].value,transform:"raw",showCagr:true}});return next}))},[crossProduct,metrics]);
  async function addCompany(ticker:string){if(companies.includes(ticker))return;setLoading(ticker);try{const response=await fetch(`/api/company/${ticker}`,{cache:"no-store"});const payload=await response.json() as CompanyDataset&{error?:string};if(!response.ok)throw new Error(payload.error);setDatasets((value)=>({...value,[ticker]:payload}));setCompanies((value)=>[...value,ticker])}finally{setLoading("")}}
  function toggleMetric(metric:string){setMetrics((value)=>value.includes(metric)?value.filter((item)=>item!==metric):[...value,metric])}
  function update(key:string,patch:Partial<SeriesConfig>){setConfigs((value)=>({...value,[key]:{...value[key],...patch}}))}

  const needsPrice=metrics.some((metric)=>PRICE_METRICS.has(metric)); const isMarketFrequency=MARKET_FREQUENCIES.has(frequency);
  useEffect(()=>{
    if(!needsPrice||isMarketFrequency)return;
    let active=true; const requests=companies.map(async(ticker)=>{const dataset=datasets[ticker];if(!dataset)return;const dates=selectedPeriods(dataset,frequency,range).map((period)=>period.periodEnd);if(!dates.length)return;const response=await fetch(`/api/prices/${ticker}?dates=${dates.join(",")}`);const payload=await response.json() as {points?:Array<{requestedDate:string;point?:{close:number;priceClose?:number;adjustedClose:number|null;totalReturnClose?:number|null}}>;error?:string};if(!response.ok)throw new Error(payload.error);if(!active)return;setPrices((current)=>({...current,...Object.fromEntries((payload.points??[]).map((item)=>[`${ticker}:${item.requestedDate}`,item.point?.priceClose??item.point?.close??null]))}));setTotalReturns((current)=>({...current,...Object.fromEntries((payload.points??[]).map((item)=>[`${ticker}:${item.requestedDate}`,item.point?.totalReturnClose??item.point?.adjustedClose??null]))}))});
    queueMicrotask(()=>{setMarketLoading(true);setMarketError("")});Promise.all(requests).catch((error)=>active&&setMarketError(error instanceof Error?error.message:"Market data unavailable")).finally(()=>active&&setMarketLoading(false));return()=>{active=false};
  },[companies,datasets,frequency,range,needsPrice,isMarketFrequency]);
  useEffect(()=>{
    if(!isMarketFrequency)return;let active=true;const end=new Date().toISOString().slice(0,10);const years=range===999?20:Math.max(1,range);const start=`${Number(end.slice(0,4))-years}${end.slice(4)}`;const providerFrequency=(frequency==="quarterly-market"?"quarterly":frequency==="annual-market"?"annual":frequency) as MarketFrequency;
    queueMicrotask(()=>{setMarketLoading(true);setMarketError("")});Promise.all(companies.map(async(ticker)=>{const response=await fetch(`/api/market/${ticker}?start=${start}&end=${end}&frequency=${providerFrequency}`);const payload=await response.json() as {bars?:MarketBar[];error?:string};if(!response.ok)throw new Error(`${ticker}: ${payload.error}`);if(active)setBars((current)=>({...current,[ticker]:payload.bars??[]}))})).catch((error)=>active&&setMarketError(error instanceof Error?error.message:"Market history unavailable")).finally(()=>active&&setMarketLoading(false));return()=>{active=false};
  },[companies,frequency,range,isMarketFrequency]);

  const rows=useMemo(()=>{
    const dates=isMarketFrequency?[...new Set(companies.flatMap((ticker)=>(bars[ticker]??[]).map((bar)=>bar.date)))].sort():[...new Set(companies.flatMap((ticker)=>{const dataset=datasets[ticker];return dataset?selectedPeriods(dataset,frequency,range).map((period)=>period.periodEnd):[]}))].sort();
    const raw=dates.map((date)=>{const row:Record<string,string|number|null>={date};for(const item of crossProduct){let value:number|null=null;if(isMarketFrequency){const bar=(bars[item.ticker]??[]).find((entry)=>entry.date===date);if(item.metric==="stockPrice")value=bar?.close??null;else if(item.metric==="stockTotalReturn")value=bar?.adjustedClose??null;}else{const dataset=datasets[item.ticker];const periods=dataset?selectedPeriods(dataset,frequency,range):[];const index=periods.findIndex((period)=>period.periodEnd===date);if(index>=0)value=item.metric==="stockTotalReturn"?totalReturns[`${item.ticker}:${date}`]??null:valueAt(periods,index,item.metric,prices[`${item.ticker}:${date}`]??null); }row[item.key]=value;}return row});
    for(const item of crossProduct){const config=configs[item.key];const values=raw.map((row)=>row[item.key] as number|null);const transformed=config?.transform==="indexed"?indexedTo100(values):config?.transform==="growth"?values.map((value,index)=>index&&value!=null&&values[index-1]!=null&&values[index-1]!==0?value/values[index-1]!-1:null):values;raw.forEach((row,index)=>row[item.key]=transformed[index]);}
    return raw;
  },[isMarketFrequency,companies,bars,datasets,frequency,range,crossProduct,configs,prices,totalReturns]);
  const active=crossProduct.filter((item)=>configs[item.key]?.visible);const leftValues=rows.flatMap((row)=>active.filter((item)=>configs[item.key].axis==="left").map((item)=>row[item.key] as number|null));const rightValues=rows.flatMap((row)=>active.filter((item)=>configs[item.key].axis==="right").map((item)=>row[item.key] as number|null));
  const logAllowed=[...leftValues,...rightValues].filter((value):value is number=>value!=null).every((value)=>value>0);const effectiveScale=scale==="log"&&!logAllowed?"auto":scale;const leftDomain=chartDomain(leftValues,effectiveScale);const rightDomain=chartDomain(rightValues,effectiveScale);const hasRight=active.some((item)=>configs[item.key].axis==="right");
  const analyses=Object.fromEntries(active.map((item)=>{const margin=METRICS[item.metric]?.kind==="percent"&&configs[item.key].transform==="raw";return[item.key,analyzeVisibleSeries(rows.map((row)=>({date:String(row.date),value:row[item.key] as number|null})),margin?"margin":"cagr")]}));
  const unsupported=isMarketFrequency&&metrics.some((metric)=>!DIRECT_MARKET_METRICS.has(metric)); const tooMany=crossProduct.length>12;
  const presets:Record<string,string[]>={"Price + FCF/share":["stockPrice","freeCashFlowPerShare"],"Quality":["revenuePerShare","freeCashFlowPerShare","operatingMargin"],"Valuation":["priceToSales","priceToEarnings","priceToFreeCashFlow","freeCashFlowYield"]};

  return <div className="comparison-page"><section className="view-title"><div><span className="panel-kicker">MULTI-STOCK · MULTI-METRIC</span><h2>Comparison workspace</h2><p>Every company × metric pair is an independent, auditable series.</p></div></section>
    <section className="panel comparison-controls"><div className="company-chips">{companies.map((ticker)=><span key={ticker}>{ticker}<button aria-label={`Remove ${ticker}`} onClick={()=>setCompanies((value)=>value.filter((item)=>item!==ticker))}><X size={11}/></button></span>)}<label><Plus size={12}/><select value="" onChange={(event)=>addCompany(event.target.value)}><option value="">Add company…</option>{DEFAULT_WATCHLIST.filter((item)=>!companies.includes(item.ticker)&&item.resolutionStatus!=="unresolved").map((item)=><option key={item.ticker} value={item.ticker}>{item.ticker} · {item.name}</option>)}</select>{loading&&<Loader2 className="spin" size={12}/>}</label></div>
      <div className="preset-row">{Object.entries(presets).map(([name,value])=><button key={name} onClick={()=>setMetrics(value)}>{name}</button>)}</div><label className="metric-search"><Search size={13}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search metrics…"/></label>
      <div className="metric-check-grid">{Object.entries(METRIC_GROUPS).map(([group,items])=><fieldset key={group}><legend>{group}</legend>{items.filter((metric)=>METRICS[metric].label.toLowerCase().includes(search.toLowerCase())).map((metric)=><label key={metric}><input type="checkbox" checked={metrics.includes(metric)} onChange={()=>toggleMetric(metric)}/>{METRICS[metric].label}</label>)}</fieldset>)}</div>
      <div className="comparison-options"><label>Frequency<select value={frequency} onChange={(event)=>setFrequency(event.target.value as Frequency)}><option value="annual">Financial · annual</option><option value="quarterly">Financial · quarterly</option><option value="ttm">Financial · TTM</option><option value="daily">Market · daily</option><option value="weekly">Market · weekly</option><option value="monthly">Market · monthly</option><option value="quarterly-market">Market · quarterly</option><option value="annual-market">Market · annual</option></select></label><label>History<select value={range} onChange={(event)=>setRange(Number(event.target.value))}><option value="5">5Y / periods</option><option value="10">10Y / periods</option><option value="20">20Y / periods</option><option value="999">Max</option></select></label><label>Scale<select value={scale} onChange={(event)=>setScale(event.target.value as ScaleMode)}><option value="zero">Start at zero</option><option value="auto">Auto per axis</option><option value="log" disabled={!logAllowed}>Logarithmic</option></select></label></div>
    </section>
    {marketLoading&&<div className="notice"><Loader2 className="spin" size={16}/><div><b>Loading market series</b><p>Prices are matched once per company and frequency.</p></div></div>}{marketError&&<div className="notice"><Info size={16}/><div><b>Market data unavailable</b><p>{marketError}</p></div></div>}{unsupported&&<div className="notice"><Info size={16}/><div><b>Market frequency applies to prices</b><p>Financial and valuation series remain gaps at daily/weekly/monthly frequency; select a financial frequency for those metrics.</p></div></div>}{tooMany&&<div className="chart-warning">{crossProduct.length} series selected. Reduce the selection for a more readable chart.</div>}{scale==="log"&&!logAllowed&&<div className="chart-warning">Log scale disabled: a visible series contains zero or negative values.</div>}
    <section className="panel comparison-chart"><div className="panel-head"><div><span className="panel-kicker">{frequency.toUpperCase()}</span><h2>{companies.length} companies × {metrics.length} metrics</h2></div><span className="verified">{active.length} visible series</span></div>
      <div className="interactive-legend detailed">{crossProduct.map((item)=>{const config=configs[item.key];if(!config)return null;const analysis=analyses[item.key];return <button key={item.key} className={config.visible?"active":""} onClick={()=>update(item.key,{visible:!config.visible})}><i style={{background:config.color}}/><span>{item.ticker} · {METRICS[item.metric].short}<small>{config.showCagr&&analysis?formatVisibleAnalysis(analysis):config.transform}</small></span>{config.visible?<Eye size={12}/>:<EyeOff size={12}/>}</button>})}</div>
      <div className="advanced-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows}><CartesianGrid stroke="var(--grid)" vertical={false}/><XAxis dataKey="date" tickFormatter={(value)=>String(value).slice(0,7)} tick={{fill:"var(--muted)",fontSize:10}}/><YAxis yAxisId="left" domain={leftDomain.domain} scale={effectiveScale==="log"?"log":"linear"} tickFormatter={(value)=>new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(value)}/>{hasRight&&<YAxis yAxisId="right" orientation="right" domain={rightDomain.domain} scale={effectiveScale==="log"?"log":"linear"} tickFormatter={(value)=>new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(value)}/>} {effectiveScale!=="log"&&<><ReferenceLine yAxisId="left" y={0} stroke="var(--border-strong)"/>{hasRight&&<ReferenceLine yAxisId="right" y={0} stroke="var(--border-strong)"/>}</>}<Tooltip formatter={(value,name)=>[Number(value).toLocaleString(undefined,{maximumFractionDigits:2}),String(name).replace(":"," · ")]}/>{active.map((item)=>{const config=configs[item.key];const props={key:item.key,dataKey:item.key,yAxisId:config.axis};return config.type==="bar"?<Bar {...props} fill={config.color}/>:config.type==="area"?<Area {...props} type={rechartsCurve(config.curve)} stroke={config.color} fill={config.color} fillOpacity={.1} connectNulls={false}/>:<Line {...props} type={rechartsCurve(config.curve)} stroke={config.color} strokeWidth={2} dot={false} connectNulls={false}/>})}</ComposedChart></ResponsiveContainer></div>
      <div className="panel-foot"><span>Independent left/right domains · no interpolation across missing facts</span><span>Price = split-adjusted close · Total return = adjusted close</span></div></section>
    <section className="panel selected-metrics"><div className="panel-head"><div><span className="panel-kicker">SERIES CONFIGURATION</span><h2>Per-series controls</h2></div></div>{crossProduct.map((item)=>{const config=configs[item.key];if(!config)return null;return <div className="series-row" key={item.key}><i style={{background:config.color,width:10,height:10,borderRadius:10}}/><div className="series-identity"><b>{item.ticker} · {METRICS[item.metric].label}</b><small>{METRICS[item.metric].kind}</small></div><input aria-label={`${item.key} color`} type="color" value={config.color} onChange={(event)=>update(item.key,{color:event.target.value})}/><select aria-label={`${item.key} type`} value={config.type} onChange={(event)=>update(item.key,{type:event.target.value as ChartType})}><option value="line">Line</option><option value="bar">Bar</option><option value="area">Area</option></select><select aria-label={`${item.key} curve`} value={config.curve} onChange={(event)=>update(item.key,{curve:event.target.value as CurveStyle})}><option value="straight">Straight</option><option value="curved">Curved</option><option value="step">Step</option></select><select aria-label={`${item.key} axis`} value={config.axis} onChange={(event)=>update(item.key,{axis:event.target.value as Axis})}><option value="left">Left axis</option><option value="right">Right axis</option></select><select aria-label={`${item.key} transformation`} value={config.transform} onChange={(event)=>update(item.key,{transform:event.target.value as Transform})}><option value="raw">Raw</option><option value="growth">Growth</option><option value="indexed">Indexed 100</option></select><label><input type="checkbox" checked={config.showCagr} onChange={(event)=>update(item.key,{showCagr:event.target.checked})}/> CAGR / Δ</label></div>})}</section>
  </div>;
}
