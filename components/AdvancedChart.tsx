"use client";

import { useEffect, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Eye, EyeOff, GripVertical, ImageDown, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { cagrBetweenDates, convertUnit, safeDivide } from "@/lib/finance";
import { analyzeVisibleSeries, formatVisibleAnalysis } from "@/lib/series-analysis";
import { CHART_DEFAULTS, CHART_PALETTE, CHART_PRESETS, METRIC_CATEGORIES, chartDomain, rechartsCurve, robustValues, type AnomalyMode, type CurveStyle, type ScaleMode } from "@/lib/charting";
import { validatedDerivedValue, validationForMetric } from "@/lib/data-quality";
import { METRICS } from "@/lib/metrics";
import type { FinancialPeriod, MarketBar, MarketFrequency, MetricKey, PricePoint } from "@/lib/types";

export type Unit = "unit" | "thousand" | "million" | "billion";
export type ChartMode = "absolute" | "perShare" | "margins" | "growth" | "cagr";
type ChartType = "line" | "bar" | "area";
type Axis = "left" | "right";
interface SeriesConfig { metric: string; type: ChartType; axis: Axis; color: string; visible: boolean }
const MARKET_METRICS = new Set(["stockPrice", "stockTotalReturn", "marketCapitalization", "priceToSales", "priceToEarnings", "priceToFreeCashFlow", "freeCashFlowYield"]);

function suffix(unit: Unit) { return unit === "unit" ? "" : unit === "thousand" ? "K" : unit === "million" ? "M" : "B"; }
function isPercent(metric: string, mode: ChartMode) { return METRICS[metric]?.kind === "percent" || mode === "growth" || mode === "cagr" || metric.endsWith("Growth") || metric.endsWith("Cagr"); }
function savedColor(metric: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(localStorage.getItem("finscope.metricColors") ?? "{}")[metric] ?? fallback; } catch { return fallback; }
}
function initialSeries(metrics: string[], mode: ChartMode): SeriesConfig[] {
  const primaryKind = mode === "growth" || mode === "cagr" ? "percent" : METRICS[metrics[0]]?.kind;
  return metrics.slice(0, 8).map((metric, index) => ({ metric, visible: index < 5, color: savedColor(metric, METRICS[metric]?.color ?? CHART_PALETTE[index % CHART_PALETTE.length].value), axis: (mode === "growth" || mode === "cagr" || METRICS[metric]?.kind === primaryKind) ? "left" : "right", type: isPercent(metric, mode) ? "line" : index === 0 ? "area" : "bar" }));
}
function download(filename: string, blob: Blob) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }

function absoluteSeriesValue(period: FinancialPeriod, metric: string, price: PricePoint | null, anomalyMode: AnomalyMode) {
  const value = (key: string) => validatedDerivedValue(period, key, anomalyMode);
  if (!MARKET_METRICS.has(metric)) return value(metric);
  const shares = value("dilutedShares") ?? value("sharesOutstanding");
  const priceClose = price?.priceClose ?? price?.close ?? null;
  const marketCap = priceClose != null && shares != null ? priceClose * shares : null;
  if (metric === "stockPrice") return priceClose;
  if (metric === "stockTotalReturn") return price?.totalReturnClose ?? price?.adjustedClose ?? null;
  if (metric === "marketCapitalization") return marketCap;
  if (metric === "priceToSales") return safeDivide(marketCap, value("revenue"));
  if (metric === "priceToEarnings") return safeDivide(marketCap, value("netIncome"));
  if (metric === "priceToFreeCashFlow") return safeDivide(marketCap, value("freeCashFlow"));
  return safeDivide(value("freeCashFlow"), marketCap);
}

function rawSeriesValue(periods: FinancialPeriod[], index: number, metric: string, mode: ChartMode, anomalyMode: AnomalyMode, prices: Record<string, PricePoint | null>) {
  const period = periods[index]; const baseMetric = metric === "revenueGrowth" || metric === "revenueCagr" ? "revenue" : metric === "freeCashFlowGrowth" || metric === "freeCashFlowCagr" ? "freeCashFlow" : metric === "freeCashFlowPerShareGrowth" || metric === "freeCashFlowPerShareCagr" ? "freeCashFlowPerShare" : metric;
  let value = absoluteSeriesValue(period, baseMetric, prices[period.periodEnd] ?? null, anomalyMode);
  const growthMetric = metric.endsWith("Growth") || mode === "growth";
  const cagrMetric = metric.endsWith("Cagr") || mode === "cagr";
  if (metric === "shareCountChange") { const prior = periods[index - 1]; const priorValue = prior ? validatedDerivedValue(prior, "dilutedShares", anomalyMode) : null; value = value != null && priorValue ? value / priorValue - 1 : null; }
  if (growthMetric) { const prior = periods[index - 1]; const priorValue = prior ? absoluteSeriesValue(prior, baseMetric, prices[prior.periodEnd] ?? null, anomalyMode) : null; value = value != null && priorValue ? value / priorValue - 1 : null; }
  if (cagrMetric) value = index ? cagrBetweenDates(absoluteSeriesValue(periods[0], baseMetric, prices[periods[0].periodEnd] ?? null, anomalyMode), value, periods[0].periodEnd, period.periodEnd).value : null;
  return value;
}

export function AdvancedChart({ periods, metrics, unit, currency, mode, title, company = "Current company", ticker }: { periods: FinancialPeriod[]; metrics: string[]; unit: Unit; currency: string; mode: ChartMode; title: string; company?: string; ticker?: string }) {
  const [series, setSeries] = useState<SeriesConfig[]>(() => initialSeries(metrics, mode));
  const [scaleMode, setScaleMode] = useState<ScaleMode>(() => typeof window === "undefined" ? "zero" : (localStorage.getItem("finscope.chartScale") as ScaleMode) || "zero");
  const [curveStyle, setCurveStyle] = useState<CurveStyle>(() => typeof window === "undefined" ? CHART_DEFAULTS.curve : (localStorage.getItem("finscope.curveStyle") as CurveStyle) || CHART_DEFAULTS.curve);
  const [anomalyMode, setAnomalyMode] = useState<AnomalyMode>(() => typeof window === "undefined" ? CHART_DEFAULTS.anomalyMode : (localStorage.getItem("finscope.anomalyMode") as AnomalyMode) || CHART_DEFAULTS.anomalyMode);
  const [robustScale, setRobustScale] = useState(() => typeof window === "undefined" ? false : localStorage.getItem("finscope.robustScale") === "true");
  const [customRange, setCustomRange] = useState({ min: 0, max: 100 });
  const [configOpen, setConfigOpen] = useState(false); const [metricSearch, setMetricSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState<number | "max">(() => typeof window === "undefined" ? "max" : (localStorage.getItem("finscope.chartWindow") === "max" ? "max" : Number(localStorage.getItem("finscope.chartWindow"))) || "max"); const [dragged, setDragged] = useState<number | null>(null);
  const [prices, setPrices] = useState<Record<string, PricePoint | null>>({}); const [priceLoading, setPriceLoading] = useState(false); const [priceError, setPriceError] = useState("");
  const [showCagr, setShowCagr] = useState(() => typeof window === "undefined" ? true : localStorage.getItem("finscope.showCagr") !== "false");
  const [showLatest, setShowLatest] = useState(() => typeof window === "undefined" ? true : localStorage.getItem("finscope.showLatest") !== "false");
  const [legendMode, setLegendMode] = useState<"compact" | "detailed">(() => typeof window === "undefined" ? "detailed" : localStorage.getItem("finscope.legendMode") === "compact" ? "compact" : "detailed");
  const [marketFrequency,setMarketFrequency]=useState<"period-end"|MarketFrequency>("period-end"); const [marketBars,setMarketBars]=useState<MarketBar[]>([]);
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => { localStorage.setItem("finscope.chartScale", scaleMode); }, [scaleMode]);
  useEffect(() => { localStorage.setItem("finscope.curveStyle", curveStyle); }, [curveStyle]);
  useEffect(() => { localStorage.setItem("finscope.anomalyMode", anomalyMode); }, [anomalyMode]);
  useEffect(() => { localStorage.setItem("finscope.robustScale", String(robustScale)); }, [robustScale]);
  useEffect(() => { localStorage.setItem("finscope.chartWindow", String(visibleCount)); }, [visibleCount]);
  useEffect(() => { localStorage.setItem("finscope.showCagr", String(showCagr)); }, [showCagr]);
  useEffect(() => { localStorage.setItem("finscope.showLatest", String(showLatest)); }, [showLatest]);
  useEffect(() => { localStorage.setItem("finscope.legendMode", legendMode); }, [legendMode]);

  const effectiveVisibleCount = visibleCount === "max" ? periods.length : Math.min(visibleCount, periods.length); const visiblePeriods = periods.slice(-effectiveVisibleCount);
  const visible = series.filter((item) => item.visible); const priceOnly=visible.length>0&&visible.every((item)=>item.metric==="stockPrice"||item.metric==="stockTotalReturn"); const usesMarketBars=priceOnly&&marketFrequency!=="period-end";
  const marketStart=visiblePeriods[0]?.periodEnd??`${new Date().getUTCFullYear()-10}-01-01`;
  const needsPrices = series.some((item) => item.visible && MARKET_METRICS.has(item.metric))&&!usesMarketBars;
  const requestedDates = visiblePeriods.map((period) => period.periodEnd).join(",");
  useEffect(() => {
    if (!needsPrices || !ticker || !requestedDates) return;
    let active = true; queueMicrotask(() => { if (active) { setPriceLoading(true); setPriceError(""); setPrices({}); } });
    fetch(`/api/prices/${encodeURIComponent(ticker)}?dates=${requestedDates}`).then(async (response) => {
      const payload = await response.json() as { points?: Array<{ requestedDate: string; point?: PricePoint; error?: string }>; error?: string };
      if (!response.ok) throw new Error(payload.error || "Market price request failed.");
      if (!active) return; const entries = payload.points ?? [];
      setPrices(Object.fromEntries(entries.map((item) => [item.requestedDate, item.point ?? null])));
      if (!entries.some((item) => item.point)) setPriceError(entries.find((item) => item.error)?.error ?? "No matched market sessions were returned.");
    }).catch((error) => active && setPriceError(error instanceof Error ? error.message : "Market prices unavailable.")).finally(() => active && setPriceLoading(false));
    return () => { active = false; };
  }, [needsPrices, requestedDates, ticker]);
  useEffect(()=>{if(!usesMarketBars||!ticker)return;let active=true;const end=new Date().toISOString().slice(0,10);queueMicrotask(()=>{setPriceLoading(true);setPriceError("")});fetch(`/api/market/${encodeURIComponent(ticker)}?start=${marketStart}&end=${end}&frequency=${marketFrequency}`).then(async(response)=>{const payload=await response.json() as {bars?:MarketBar[];error?:string};if(!response.ok)throw new Error(payload.error);if(active)setMarketBars(payload.bars??[])}).catch((error)=>active&&setPriceError(error instanceof Error?error.message:"Market history unavailable")).finally(()=>active&&setPriceLoading(false));return()=>{active=false}},[usesMarketBars,ticker,marketFrequency,marketStart]);
  const data = usesMarketBars?marketBars.map((bar)=>({date:bar.date,price:null,period:null,stockPrice:bar.close,stockTotalReturn:bar.adjustedClose})):visiblePeriods.map((period, periodIndex) => {
    const values: Record<string, unknown> = { date: period.periodEnd, period, price: prices[period.periodEnd] ?? null };
    for (const item of series) { const raw = rawSeriesValue(visiblePeriods, periodIndex, item.metric, mode, anomalyMode, prices); values[item.metric] = raw == null ? null : isPercent(item.metric, mode) ? raw * 100 : METRICS[item.metric]?.kind === "perShare" || METRICS[item.metric]?.kind === "ratio" ? raw : convertUnit(raw, unit); }
    return values;
  });
  const allValues = data.flatMap((row) => visible.map((item) => (row as Record<string,unknown>)[item.metric] as number | null)).filter((value): value is number => value != null);
  const logAllowed = allValues.length > 0 && allValues.every((value) => value > 0); const effectiveScale = scaleMode === "log" && !logAllowed ? "auto" : scaleMode;
  const hasRight = visible.some((item) => item.axis === "right") && visible.length > 1; const effectiveSeries = visible.map((item) => hasRight ? item : { ...item, axis: "left" as const });
  const axisValues = (axis: Axis) => data.flatMap((row) => effectiveSeries.filter((item) => item.axis === axis).map((item) => (row as Record<string,unknown>)[item.metric] as number | null));
  const domainValues = (axis: Axis) => robustScale ? robustValues(axisValues(axis)) : axisValues(axis);
  const leftDomain = chartDomain(domainValues("left"), effectiveScale, customRange); const rightDomain = chartDomain(domainValues("right"), effectiveScale, customRange);
  const legendAnalyses = Object.fromEntries(series.map((item) => {
    const marginSeries = METRICS[item.metric]?.kind === "percent" && !item.metric.endsWith("Growth") && !item.metric.endsWith("Cagr") && mode !== "growth" && mode !== "cagr";
    const observations = usesMarketBars?marketBars.map((bar)=>({date:bar.date,value:item.metric==="stockPrice"?bar.close:bar.adjustedClose,valid:true})):visiblePeriods.map((period, index) => ({
      date: period.periodEnd,
      value: rawSeriesValue(visiblePeriods, index, item.metric, mode, anomalyMode, prices),
      valid: MARKET_METRICS.has(item.metric) || validationForMetric(period, item.metric).status !== "Confirmed invalid",
    }));
    return [item.metric, analyzeVisibleSeries(observations, marginSeries ? "margin" : "cagr")];
  }));

  function axisFormatter(axis: Axis) { const axisSeries = effectiveSeries.filter((item) => item.axis === axis); const percentOnly = axisSeries.length > 0 && axisSeries.every((item) => isPercent(item.metric, mode)); const perShareOnly = axisSeries.length > 0 && axisSeries.every((item) => METRICS[item.metric]?.kind === "perShare"); const ratioOnly = axisSeries.length > 0 && axisSeries.every((item) => METRICS[item.metric]?.kind === "ratio"); return (value: number) => percentOnly ? `${value.toFixed(0)}%` : perShareOnly ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 1 }).format(value) : ratioOnly ? `${value.toFixed(1)}×` : `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}${suffix(unit)}`; }
  function update(index: number, patch: Partial<SeriesConfig>) { setSeries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  function setColor(index: number, color: string) { update(index, { color }); const metric = series[index].metric; let stored: Record<string,string> = {}; try { stored = JSON.parse(localStorage.getItem("finscope.metricColors") ?? "{}"); } catch { stored = {}; } localStorage.setItem("finscope.metricColors", JSON.stringify({ ...stored, [metric]: color })); }
  function addMetric(metric: string) { if (!series.some((item) => item.metric === metric)) setSeries((current) => [...current, ...initialSeries([metric], mode)]); }
  function applyPreset(name: string) { setSeries(initialSeries(CHART_PRESETS[name], mode)); }
  function reorder(target: number) { if (dragged == null || dragged === target) return; setSeries((current) => { const next = [...current]; const [item] = next.splice(dragged, 1); next.splice(target, 0, item); return next; }); setDragged(null); }
  function exportSvg() { const svg = chartRef.current?.querySelector("svg.recharts-surface"); if (!svg) return; const clone = svg.cloneNode(true) as SVGElement; clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); download(`${title.toLowerCase().replaceAll(" ", "-")}.svg`, new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" })); }
  function exportPng() { const svg = chartRef.current?.querySelector("svg.recharts-surface"); if (!svg) return; const xml = new XMLSerializer().serializeToString(svg); const image = new Image(); image.onload = () => { const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 900; const context = canvas.getContext("2d"); if (!context) return; context.fillStyle = "#0b0e13"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); canvas.toBlob((blob) => blob && download(`${title.toLowerCase().replaceAll(" ", "-")}.png`, blob), "image/png"); }; image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`; }

  const filteredCategories = Object.entries(METRIC_CATEGORIES).map(([category, categoryMetrics]) => [category, categoryMetrics.filter((metric) => METRICS[metric] && METRICS[metric].label.toLowerCase().includes(metricSearch.toLowerCase()))] as const).filter(([, categoryMetrics]) => categoryMetrics.length);
  return <article className="panel advanced-chart-panel">
    <div className="panel-head chart-head"><div><span className="panel-kicker">INTERACTIVE ANALYSIS</span><h2>{title}</h2></div><div className="chart-actions">
      <label>Window <select value={visibleCount} onChange={(event) => setVisibleCount(event.target.value === "max" ? "max" : Number(event.target.value))}>{[5,8,12,20].filter((value)=>value<periods.length).map((value)=><option value={value} key={value}>{value}</option>)}<option value="max">Max</option></select></label>
      {priceOnly&&<label>Market frequency <select value={marketFrequency} onChange={(event)=>setMarketFrequency(event.target.value as "period-end"|MarketFrequency)}><option value="period-end">Financial period end</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>}
      <label title="Persisted across charts"><input type="checkbox" checked={showCagr} onChange={(event)=>setShowCagr(event.target.checked)}/> CAGR / Δ</label>
      <label title="Persisted across charts"><input type="checkbox" checked={showLatest} onChange={(event)=>setShowLatest(event.target.checked)}/> Latest</label>
      <label>Legend <select value={legendMode} onChange={(event)=>setLegendMode(event.target.value as "compact"|"detailed")}><option value="detailed">Detailed</option><option value="compact">Compact</option></select></label>
      <label>Curve <select value={curveStyle} onChange={(event)=>setCurveStyle(event.target.value as CurveStyle)}><option value="straight">Straight</option><option value="curved">Curved</option><option value="step">Step</option></select></label>
      <label>Data <select value={anomalyMode} onChange={(event)=>setAnomalyMode(event.target.value as AnomalyMode)}><option value="validated">Validated</option><option value="raw">Raw</option></select></label>
      <label title="Scale the axis from the central distribution without changing or deleting observations"><input type="checkbox" checked={robustScale} onChange={(event)=>setRobustScale(event.target.checked)}/> Robust scale</label>
      <label>Scale <select value={scaleMode} onChange={(event)=>setScaleMode(event.target.value as ScaleMode)}><option value="zero">Start at zero</option><option value="auto">Auto scale</option><option value="custom">Custom range</option><option value="log" disabled={!logAllowed}>Logarithmic</option></select></label>
      {scaleMode === "custom" && <span className="custom-range"><input aria-label="Axis minimum" type="number" value={customRange.min} onChange={(event)=>setCustomRange({...customRange,min:Number(event.target.value)})}/><input aria-label="Axis maximum" type="number" value={customRange.max} onChange={(event)=>setCustomRange({...customRange,max:Number(event.target.value)})}/></span>}
      <button className="button secondary add-metric-button" onClick={()=>setConfigOpen(true)}><Plus size={14}/> Add metric</button><button className="icon-button" onClick={exportSvg} title="Download SVG"><Download size={15}/></button><button className="icon-button" onClick={exportPng} title="Download PNG"><ImageDown size={15}/></button><button className={`icon-button ${configOpen?"active":""}`} onClick={()=>setConfigOpen((value)=>!value)} title="Configure series"><Settings2 size={15}/></button>
    </div></div>
    {scaleMode === "log" && !logAllowed && <div className="chart-warning">Logarithmic scale is unavailable because at least one visible value is zero or negative.</div>}
    {priceLoading && (needsPrices||usesMarketBars) && <div className="chart-warning">Loading historically matched market sessions…</div>}
    {priceError && (needsPrices||usesMarketBars) && <div className="chart-warning">Market prices unavailable: {priceError}</div>}
    {series.length > 6 && <div className="chart-warning">{series.length} series selected. The chart remains available, but reducing the selection will improve readability.</div>}
    <div className={`interactive-legend ${legendMode}`}>{series.map((item,index)=>{const analysis=legendAnalyses[item.metric]; const latest=analysis?.endValue; return <button key={item.metric} className={item.visible?"active":""} onClick={()=>update(index,{visible:!item.visible})} title={analysis?`${analysis.startDate} → ${analysis.endDate} · ${analysis.years.toFixed(2)} years${analysis.reason?` · ${analysis.reason}`:""}`:undefined}><i style={{background:item.color}}/><span>{METRICS[item.metric]?.short??item.metric}{legendMode==="detailed"&&<small>{showLatest&&latest!=null?`Latest ${isPercent(item.metric,mode)?`${(latest*100).toFixed(1)}%`:latest.toLocaleString(undefined,{maximumFractionDigits:2})}`:""}{showCagr&&analysis?`${showLatest&&latest!=null?" · ":""}${formatVisibleAnalysis(analysis)}`:""}</small>}</span>{item.visible?<Eye size={12}/>:<EyeOff size={12}/>}</button>})}</div>
    {configOpen && <div className="metric-selector"><div className="selector-head"><div><span className="panel-kicker">METRIC SELECTOR</span><h3>Add, remove and configure series</h3></div><button className="icon-button" onClick={()=>setConfigOpen(false)}><X size={15}/></button></div>
      <div className="preset-row">{Object.keys(CHART_PRESETS).map((name)=><button key={name} onClick={()=>applyPreset(name)}>{name}</button>)}</div>
      <div className="selector-layout"><div className="metric-library"><label className="metric-search"><Search size={13}/><input value={metricSearch} onChange={(event)=>setMetricSearch(event.target.value)} placeholder="Search metrics…"/></label>{filteredCategories.map(([category,categoryMetrics])=><section key={category}><b>{category}</b>{categoryMetrics.map((metric)=><label key={metric}><input type="checkbox" checked={series.some((item)=>item.metric===metric)} onChange={(event)=>event.target.checked?addMetric(metric):setSeries((current)=>current.filter((item)=>item.metric!==metric))}/>{METRICS[metric].label}</label>)}</section>)}</div>
        <div className="selected-metrics"><div className="selected-head"><b>Selected metrics · {series.length}</b><button onClick={()=>setSeries([])}><Trash2 size={12}/> Clear all</button></div>{series.map((item,index)=><div className="series-row" key={item.metric} draggable onDragStart={()=>setDragged(index)} onDragOver={(event)=>event.preventDefault()} onDrop={()=>reorder(index)}><GripVertical size={14}/><div className="series-identity"><b>{METRICS[item.metric]?.label}</b><small>{company}</small></div><div className="palette" aria-label={`${item.metric} preset color`}>{CHART_PALETTE.map((color)=><button key={color.value} aria-label={color.name} title={color.name} className={item.color===color.value?"active":""} style={{background:color.value}} onClick={()=>setColor(index,color.value)}/>)}</div><select aria-label={`${item.metric} type`} value={item.type} onChange={(event)=>update(index,{type:event.target.value as ChartType})}><option value="line">Line</option><option value="bar">Bar</option><option value="area">Area</option></select><select aria-label={`${item.metric} axis`} value={item.axis} onChange={(event)=>update(index,{axis:event.target.value as Axis})}><option value="left">Left</option><option value="right">Right</option></select><button className={item.visible?"series-eye active":"series-eye"} onClick={()=>update(index,{visible:!item.visible})}>{item.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button><button onClick={()=>setSeries((current)=>current.filter((_,itemIndex)=>itemIndex!==index))} aria-label={`Remove ${METRICS[item.metric]?.label}`}><X size={13}/></button></div>)}</div></div>
    </div>}
    <div className="chart advanced-chart" ref={chartRef}>{data.length===0||visible.length===0?<div className="chart-empty">No reliable periods or visible series for this selection.</div>:<ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{top:12,right:hasRight?22:8,left:4,bottom:8}}><CartesianGrid stroke="var(--grid)" vertical={false}/><XAxis dataKey="date" tickFormatter={(value)=>String(value).slice(0,7)} tickLine={false} axisLine={false} tick={{fill:"var(--muted)",fontSize:10}}/><YAxis yAxisId="left" scale={effectiveScale==="log"?"log":"linear"} domain={leftDomain.domain} tickFormatter={axisFormatter("left")} tickLine={false} axisLine={false} tick={{fill:"var(--muted)",fontSize:10}}/>{hasRight&&<YAxis yAxisId="right" orientation="right" scale={effectiveScale==="log"?"log":"linear"} domain={rightDomain.domain} tickFormatter={axisFormatter("right")} tickLine={false} axisLine={false} tick={{fill:"var(--muted)",fontSize:10}}/>}{effectiveScale!=="log"&&<><ReferenceLine yAxisId="left" y={0} stroke="var(--border-strong)" strokeWidth={1.4}/>{hasRight&&<ReferenceLine yAxisId="right" y={0} stroke="var(--border-strong)" strokeWidth={1.4}/>}</>}<Tooltip content={<DetailedTooltip series={effectiveSeries} unit={unit} currency={currency} mode={mode}/>}/>{effectiveSeries.map((item)=>item.type==="bar"?<Bar key={item.metric} yAxisId={item.axis} dataKey={item.metric} fill={item.color} radius={[3,3,0,0]} opacity={.82}/>:item.type==="area"?<Area key={item.metric} yAxisId={item.axis} type={rechartsCurve(curveStyle)} dataKey={item.metric} stroke={item.color} fill={item.color} fillOpacity={.13} strokeWidth={2} connectNulls={false}/>:<Line key={item.metric} yAxisId={item.axis} type={rechartsCurve(curveStyle)} dataKey={item.metric} stroke={item.color} strokeWidth={2} dot={(props: {payload?:{period?:FinancialPeriod};cx?:number;cy?:number})=>{const status=props.payload?.period?validationForMetric(props.payload.period,item.metric).status:"Verified";return status==="Suspected anomaly"||status==="Verified outlier"||status==="Source conflict"?<circle cx={props.cx} cy={props.cy} r={4} fill={item.color} stroke="#fff" strokeWidth={2}/>:<circle cx={props.cx} cy={props.cy} r={0}/>}} connectNulls={false}/>)}</ComposedChart></ResponsiveContainer>}</div>
    <div className="panel-foot"><span>Units: {unit} · Left axis: {scaleMode} · {hasRight ? `Right axis: ${scaleMode}` : "Single left axis"} · Missing/invalid facts remain gaps</span><span>{robustScale?"Robust axis range · observations unchanged":"Full-value axis range"} · {anomalyMode === "validated" ? "Validated data" : "Raw data"}</span></div>
  </article>;
}

function DetailedTooltip({active,payload,label,series,unit,currency,mode}:{active?:boolean;payload?:Array<{dataKey:string;value:number;payload:{period:FinancialPeriod|null;price:PricePoint|null}}>;label?:string;series:SeriesConfig[];unit:Unit;currency:string;mode:ChartMode}) { if(!active||!payload?.length)return null; const period=payload[0].payload.period; return <div className="chart-tooltip detailed"><b>{label}{period?` · ${period.periodEnd}`:""}</b>{payload.map((entry)=>{const definition=METRICS[entry.dataKey];const config=series.find((item)=>item.metric===entry.dataKey);const fact=period?.facts[entry.dataKey as MetricKey];const market=MARKET_METRICS.has(entry.dataKey);const price=entry.payload.price;const formatted=isPercent(entry.dataKey,mode)?`${entry.value.toFixed(1)}%`:definition?.kind==="perShare"?new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:2}).format(entry.value):definition?.kind==="ratio"?`${entry.value.toFixed(2)}×`:`${entry.value.toLocaleString(undefined,{maximumFractionDigits:2})}${suffix(unit)}`;return <span key={entry.dataKey}><i style={{background:config?.color}}/><span>{definition?.label}<small>{market?`Yahoo Finance · ${price?.type??(period?"price unavailable":"aggregated market bar")}`:`${fact?.provenance.provider??"Calculated"} · ${fact?.provenance.status??"formula"}`}<br/>{market&&price?`${price.date} · ${price.fallback}`:fact?.provenance.formula??definition?.formula??fact?.provenance.concept}</small></span><strong>{formatted}</strong></span>})}</div>; }
