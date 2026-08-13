"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Eye, EyeOff, GripVertical, ImageDown, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { cagrBetweenDates, convertUnit, derivedValue } from "@/lib/finance";
import { CHART_PALETTE, CHART_PRESETS, METRIC_CATEGORIES, chartDomain, type ScaleMode } from "@/lib/charting";
import { METRICS } from "@/lib/metrics";
import type { FinancialPeriod, MetricKey } from "@/lib/types";

export type Unit = "unit" | "thousand" | "million" | "billion";
export type ChartMode = "absolute" | "perShare" | "margins" | "growth" | "cagr";
type ChartType = "line" | "bar" | "area";
type Axis = "left" | "right";
interface SeriesConfig { metric: string; type: ChartType; axis: Axis; color: string; visible: boolean }

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

function rawSeriesValue(periods: FinancialPeriod[], index: number, metric: string, mode: ChartMode) {
  const period = periods[index]; const baseMetric = metric === "revenueGrowth" || metric === "revenueCagr" ? "revenue" : metric === "freeCashFlowGrowth" || metric === "freeCashFlowCagr" ? "freeCashFlow" : metric === "freeCashFlowPerShareGrowth" || metric === "freeCashFlowPerShareCagr" ? "freeCashFlowPerShare" : metric;
  let value = derivedValue(period, baseMetric);
  const growthMetric = metric.endsWith("Growth") || mode === "growth";
  const cagrMetric = metric.endsWith("Cagr") || mode === "cagr";
  if (metric === "shareCountChange") { const prior = periods[index - 1]; const priorValue = prior ? derivedValue(prior, "dilutedShares") : null; value = value != null && priorValue ? value / priorValue - 1 : null; }
  if (growthMetric) { const prior = periods[index - 1]; const priorValue = prior ? derivedValue(prior, baseMetric) : null; value = value != null && priorValue ? value / priorValue - 1 : null; }
  if (cagrMetric) value = index ? cagrBetweenDates(derivedValue(periods[0], baseMetric), value, periods[0].periodEnd, period.periodEnd).value : null;
  return value;
}

export function AdvancedChart({ periods, metrics, unit, currency, mode, title, company = "Current company" }: { periods: FinancialPeriod[]; metrics: string[]; unit: Unit; currency: string; mode: ChartMode; title: string; company?: string }) {
  const [series, setSeries] = useState<SeriesConfig[]>(() => initialSeries(metrics, mode));
  const [scaleMode, setScaleMode] = useState<ScaleMode>(() => typeof window === "undefined" ? "zero" : (localStorage.getItem("finscope.chartScale") as ScaleMode) || "zero");
  const [customRange, setCustomRange] = useState({ min: 0, max: 100 });
  const [configOpen, setConfigOpen] = useState(false); const [metricSearch, setMetricSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(Math.min(12, periods.length)); const [dragged, setDragged] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => { localStorage.setItem("finscope.chartScale", scaleMode); }, [scaleMode]);

  const effectiveVisibleCount = Math.min(visibleCount, periods.length); const visiblePeriods = periods.slice(-effectiveVisibleCount);
  const data = useMemo(() => visiblePeriods.map((period, periodIndex) => {
    const values: Record<string, unknown> = { label: period.fiscalQuarter ? `${period.fiscalQuarter} '${String(period.fiscalYear).slice(-2)}` : String(period.fiscalYear), period };
    for (const item of series) { const raw = rawSeriesValue(visiblePeriods, periodIndex, item.metric, mode); values[item.metric] = raw == null ? null : isPercent(item.metric, mode) ? raw * 100 : METRICS[item.metric]?.kind === "perShare" ? raw : convertUnit(raw, unit); }
    return values;
  }), [visiblePeriods, series, unit, mode]);
  const visible = series.filter((item) => item.visible); const allValues = data.flatMap((row) => visible.map((item) => row[item.metric] as number | null)).filter((value): value is number => value != null);
  const logAllowed = allValues.length > 0 && allValues.every((value) => value > 0); const effectiveScale = scaleMode === "log" && !logAllowed ? "auto" : scaleMode;
  const hasRight = visible.some((item) => item.axis === "right") && visible.length > 1; const effectiveSeries = visible.map((item) => hasRight ? item : { ...item, axis: "left" as const });
  const axisValues = (axis: Axis) => data.flatMap((row) => effectiveSeries.filter((item) => item.axis === axis).map((item) => row[item.metric] as number | null));
  const leftDomain = chartDomain(axisValues("left"), effectiveScale, customRange); const rightDomain = chartDomain(axisValues("right"), effectiveScale, customRange);

  function axisFormatter(axis: Axis) { const axisSeries = effectiveSeries.filter((item) => item.axis === axis); const percentOnly = axisSeries.length > 0 && axisSeries.every((item) => isPercent(item.metric, mode)); const perShareOnly = axisSeries.length > 0 && axisSeries.every((item) => METRICS[item.metric]?.kind === "perShare"); return (value: number) => percentOnly ? `${value.toFixed(0)}%` : perShareOnly ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 1 }).format(value) : `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}${suffix(unit)}`; }
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
      <label>Window <select value={effectiveVisibleCount} onChange={(event) => setVisibleCount(Number(event.target.value))}>{[5,8,12,20,periods.length].filter((value,index,all)=>value<=periods.length&&all.indexOf(value)===index).map((value)=><option value={value} key={value}>{value===periods.length?"Max":value}</option>)}</select></label>
      <label>Scale <select value={scaleMode} onChange={(event)=>setScaleMode(event.target.value as ScaleMode)}><option value="zero">Start at zero</option><option value="auto">Auto scale</option><option value="custom">Custom range</option><option value="log" disabled={!logAllowed}>Logarithmic</option></select></label>
      {scaleMode === "custom" && <span className="custom-range"><input aria-label="Axis minimum" type="number" value={customRange.min} onChange={(event)=>setCustomRange({...customRange,min:Number(event.target.value)})}/><input aria-label="Axis maximum" type="number" value={customRange.max} onChange={(event)=>setCustomRange({...customRange,max:Number(event.target.value)})}/></span>}
      <button className="button secondary add-metric-button" onClick={()=>setConfigOpen(true)}><Plus size={14}/> Add metric</button><button className="icon-button" onClick={exportSvg} title="Download SVG"><Download size={15}/></button><button className="icon-button" onClick={exportPng} title="Download PNG"><ImageDown size={15}/></button><button className={`icon-button ${configOpen?"active":""}`} onClick={()=>setConfigOpen((value)=>!value)} title="Configure series"><Settings2 size={15}/></button>
    </div></div>
    {scaleMode === "log" && !logAllowed && <div className="chart-warning">Logarithmic scale is unavailable because at least one visible value is zero or negative.</div>}
    {series.length > 6 && <div className="chart-warning">{series.length} series selected. The chart remains available, but reducing the selection will improve readability.</div>}
    <div className="interactive-legend">{series.map((item,index)=><button key={item.metric} className={item.visible?"active":""} onClick={()=>update(index,{visible:!item.visible})}><i style={{background:item.color}}/>{METRICS[item.metric]?.short??item.metric}{item.visible?<Eye size={12}/>:<EyeOff size={12}/>}</button>)}</div>
    {configOpen && <div className="metric-selector"><div className="selector-head"><div><span className="panel-kicker">METRIC SELECTOR</span><h3>Add, remove and configure series</h3></div><button className="icon-button" onClick={()=>setConfigOpen(false)}><X size={15}/></button></div>
      <div className="preset-row">{Object.keys(CHART_PRESETS).map((name)=><button key={name} onClick={()=>applyPreset(name)}>{name}</button>)}</div>
      <div className="selector-layout"><div className="metric-library"><label className="metric-search"><Search size={13}/><input value={metricSearch} onChange={(event)=>setMetricSearch(event.target.value)} placeholder="Search metrics…"/></label>{filteredCategories.map(([category,categoryMetrics])=><section key={category}><b>{category}</b>{categoryMetrics.map((metric)=><label key={metric}><input type="checkbox" checked={series.some((item)=>item.metric===metric)} onChange={(event)=>event.target.checked?addMetric(metric):setSeries((current)=>current.filter((item)=>item.metric!==metric))}/>{METRICS[metric].label}</label>)}</section>)}</div>
        <div className="selected-metrics"><div className="selected-head"><b>Selected metrics · {series.length}</b><button onClick={()=>setSeries([])}><Trash2 size={12}/> Clear all</button></div>{series.map((item,index)=><div className="series-row" key={item.metric} draggable onDragStart={()=>setDragged(index)} onDragOver={(event)=>event.preventDefault()} onDrop={()=>reorder(index)}><GripVertical size={14}/><div className="series-identity"><b>{METRICS[item.metric]?.label}</b><small>{company}</small></div><div className="palette" aria-label={`${item.metric} preset color`}>{CHART_PALETTE.map((color)=><button key={color.value} aria-label={color.name} title={color.name} className={item.color===color.value?"active":""} style={{background:color.value}} onClick={()=>setColor(index,color.value)}/>)}</div><select aria-label={`${item.metric} type`} value={item.type} onChange={(event)=>update(index,{type:event.target.value as ChartType})}><option value="line">Line</option><option value="bar">Bar</option><option value="area">Area</option></select><select aria-label={`${item.metric} axis`} value={item.axis} onChange={(event)=>update(index,{axis:event.target.value as Axis})}><option value="left">Left</option><option value="right">Right</option></select><button className={item.visible?"series-eye active":"series-eye"} onClick={()=>update(index,{visible:!item.visible})}>{item.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button><button onClick={()=>setSeries((current)=>current.filter((_,itemIndex)=>itemIndex!==index))} aria-label={`Remove ${METRICS[item.metric]?.label}`}><X size={13}/></button></div>)}</div></div>
    </div>}
    <div className="chart advanced-chart" ref={chartRef}>{data.length===0||visible.length===0?<div className="chart-empty">No reliable periods or visible series for this selection.</div>:<ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{top:12,right:hasRight?22:8,left:4,bottom:8}}><CartesianGrid stroke="var(--grid)" vertical={false}/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{fill:"var(--muted)",fontSize:10}}/><YAxis yAxisId="left" scale={effectiveScale==="log"?"log":"linear"} domain={leftDomain.domain} tickFormatter={axisFormatter("left")} tickLine={false} axisLine={false} tick={{fill:"var(--muted)",fontSize:10}}/>{hasRight&&<YAxis yAxisId="right" orientation="right" scale={effectiveScale==="log"?"log":"linear"} domain={rightDomain.domain} tickFormatter={axisFormatter("right")} tickLine={false} axisLine={false} tick={{fill:"var(--muted)",fontSize:10}}/>}{effectiveScale!=="log"&&<><ReferenceLine yAxisId="left" y={0} stroke="var(--border-strong)" strokeWidth={1.4}/>{hasRight&&<ReferenceLine yAxisId="right" y={0} stroke="var(--border-strong)" strokeWidth={1.4}/>}</>}<Tooltip content={<DetailedTooltip series={effectiveSeries} unit={unit} currency={currency} mode={mode}/>}/>{effectiveSeries.map((item)=>item.type==="bar"?<Bar key={item.metric} yAxisId={item.axis} dataKey={item.metric} fill={item.color} radius={[3,3,0,0]} opacity={.82}/>:item.type==="area"?<Area key={item.metric} yAxisId={item.axis} type="monotone" dataKey={item.metric} stroke={item.color} fill={item.color} fillOpacity={.13} strokeWidth={2} connectNulls={false}/>:<Line key={item.metric} yAxisId={item.axis} type="monotone" dataKey={item.metric} stroke={item.color} strokeWidth={2} dot={false} connectNulls={false}/>)}</ComposedChart></ResponsiveContainer>}</div>
    <div className="panel-foot"><span>Units: {unit} · Independent axes · Missing facts remain gaps</span><span>{scaleMode === "zero" ? "Starts at zero" : scaleMode === "auto" ? "Auto scale" : scaleMode === "custom" ? `${customRange.min} to ${customRange.max}` : "Logarithmic"}</span></div>
  </article>;
}

function DetailedTooltip({active,payload,label,series,unit,currency,mode}:{active?:boolean;payload?:Array<{dataKey:string;value:number;payload:{period:FinancialPeriod}}>;label?:string;series:SeriesConfig[];unit:Unit;currency:string;mode:ChartMode}) { if(!active||!payload?.length)return null; const period=payload[0].payload.period; return <div className="chart-tooltip detailed"><b>{label} · {period.periodEnd}</b>{payload.map((entry)=>{const definition=METRICS[entry.dataKey];const config=series.find((item)=>item.metric===entry.dataKey);const fact=period.facts[entry.dataKey as MetricKey];const formatted=isPercent(entry.dataKey,mode)?`${entry.value.toFixed(1)}%`:definition?.kind==="perShare"?new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:2}).format(entry.value):`${entry.value.toLocaleString(undefined,{maximumFractionDigits:2})}${suffix(unit)}`;return <span key={entry.dataKey}><i style={{background:config?.color}}/><span>{definition?.label}<small>{fact?.provenance.provider??"Calculated"} · {fact?.provenance.status??"formula"}<br/>{fact?.provenance.formula??definition?.formula??fact?.provenance.concept}</small></span><strong>{formatted}</strong></span>})}</div>; }
