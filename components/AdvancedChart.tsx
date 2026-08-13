"use client";

import { useMemo, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Download, Eye, EyeOff, ImageDown, Plus, Settings2, X } from "lucide-react";
import { cagrBetweenDates, convertUnit, derivedValue } from "@/lib/finance";
import { METRICS } from "@/lib/metrics";
import type { FinancialPeriod, MetricKey } from "@/lib/types";

export type Unit = "unit" | "thousand" | "million" | "billion";
export type ChartMode = "absolute" | "perShare" | "margins" | "growth" | "cagr";
type ChartType = "line" | "bar" | "area";
type Axis = "left" | "right";
interface SeriesConfig { metric: string; type: ChartType; axis: Axis; color: string; visible: boolean }

function suffix(unit: Unit) { return unit === "unit" ? "" : unit === "thousand" ? "K" : unit === "million" ? "M" : "B"; }
function isPercent(metric: string, mode: ChartMode) { return METRICS[metric]?.kind === "percent" || mode === "growth" || mode === "cagr"; }
function initialSeries(metrics: string[], mode: ChartMode): SeriesConfig[] {
  const primaryKind = mode === "growth" || mode === "cagr" ? "percent" : METRICS[metrics[0]]?.kind;
  return metrics.slice(0, 6).map((metric, index) => ({
    metric, visible: index < 5, color: METRICS[metric]?.color ?? "#53d39c",
    axis: (mode === "growth" || mode === "cagr" || METRICS[metric]?.kind === primaryKind) ? "left" : "right",
    type: isPercent(metric, mode) ? "line" : index === 0 ? "area" : "bar",
  }));
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export function AdvancedChart({ periods, metrics, unit, currency, mode, title }: { periods: FinancialPeriod[]; metrics: string[]; unit: Unit; currency: string; mode: ChartMode; title: string }) {
  const [series, setSeries] = useState<SeriesConfig[]>(() => initialSeries(metrics, mode));
  const [logScale, setLogScale] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(Math.min(12, periods.length));
  const chartRef = useRef<HTMLDivElement>(null);

  const effectiveVisibleCount = Math.min(visibleCount, periods.length);
  const visiblePeriods = periods.slice(-effectiveVisibleCount);
  const data = useMemo(() => visiblePeriods.map((period, periodIndex) => {
    const values: Record<string, unknown> = { label: period.fiscalQuarter ? `${period.fiscalQuarter} '${String(period.fiscalYear).slice(-2)}` : String(period.fiscalYear), period };
    for (const item of series) {
      let value = derivedValue(period, item.metric);
      if (item.metric === "shareCountChange") {
        const prior = visiblePeriods[periodIndex - 1];
        const currentShares = derivedValue(period, "dilutedShares"); const priorShares = prior ? derivedValue(prior, "dilutedShares") : null;
        value = currentShares != null && priorShares ? currentShares / priorShares - 1 : null;
      }
      if (mode === "growth") {
        const prior = visiblePeriods[periodIndex - 1]; const priorValue = prior ? derivedValue(prior, item.metric) : null;
        value = value != null && priorValue ? value / priorValue - 1 : null;
      }
      if (mode === "cagr") {
        const first = visiblePeriods[0];
        value = periodIndex && first ? cagrBetweenDates(derivedValue(first, item.metric), value, first.periodEnd, period.periodEnd).value : null;
      }
      values[item.metric] = value == null ? null : isPercent(item.metric, mode) ? value * 100 : METRICS[item.metric]?.kind === "perShare" ? value : convertUnit(value, unit);
    }
    return values;
  }), [visiblePeriods, series, unit, mode]);

  const visible = series.filter((item) => item.visible);
  const values = data.flatMap((row) => visible.map((item) => row[item.metric] as number | null)).filter((value): value is number => value != null);
  const logAllowed = values.length > 0 && values.every((value) => value > 0);
  const effectiveLogScale = logScale && logAllowed;
  const hasRight = visible.some((item) => item.axis === "right") && visible.length > 1;
  const effectiveSeries = visible.map((item) => hasRight ? item : { ...item, axis: "left" as const });

  function axisFormatter(axis: Axis) {
    const axisSeries = effectiveSeries.filter((item) => item.axis === axis);
    const percentOnly = axisSeries.length > 0 && axisSeries.every((item) => isPercent(item.metric, mode));
    const perShareOnly = axisSeries.length > 0 && axisSeries.every((item) => METRICS[item.metric]?.kind === "perShare");
    return (value: number) => percentOnly ? `${value.toFixed(0)}%` : perShareOnly ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 1 }).format(value) : `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}${suffix(unit)}`;
  }

  function update(index: number, patch: Partial<SeriesConfig>) { setSeries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  function addMetric(metric: string) { if (!series.some((item) => item.metric === metric)) setSeries((current) => [...current, ...initialSeries([metric], mode)]); }

  function exportSvg() {
    const svg = chartRef.current?.querySelector("svg.recharts-surface"); if (!svg) return;
    const clone = svg.cloneNode(true) as SVGElement; clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    download(`${title.toLowerCase().replaceAll(" ", "-")}.svg`, new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }));
  }
  function exportPng() {
    const svg = chartRef.current?.querySelector("svg.recharts-surface"); if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg); const image = new Image();
    image.onload = () => { const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 900; const context = canvas.getContext("2d"); if (!context) return; context.fillStyle = "#0b0e13"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); canvas.toBlob((blob) => blob && download(`${title.toLowerCase().replaceAll(" ", "-")}.png`, blob), "image/png"); };
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
  }

  return <article className="panel advanced-chart-panel">
    <div className="panel-head chart-head"><div><span className="panel-kicker">INTERACTIVE ANALYSIS</span><h2>{title}</h2></div><div className="chart-actions">
      <label>Window <select value={effectiveVisibleCount} onChange={(event) => setVisibleCount(Number(event.target.value))}>{[5, 8, 12, 20, periods.length].filter((value, index, all) => value <= periods.length && all.indexOf(value) === index).map((value) => <option value={value} key={value}>{value === periods.length ? "Max" : value}</option>)}</select></label>
      <button className={`button ghost ${effectiveLogScale ? "active" : ""}`} disabled={!logAllowed} onClick={() => setLogScale((value) => !value)} title={!logAllowed ? "Log scale requires strictly positive visible values" : "Toggle logarithmic scale"}>LOG</button>
      <button className="icon-button" onClick={exportSvg} title="Download SVG"><Download size={15} /></button>
      <button className="icon-button" onClick={exportPng} title="Download PNG"><ImageDown size={15} /></button>
      <button className={`icon-button ${configOpen ? "active" : ""}`} onClick={() => setConfigOpen((value) => !value)} title="Configure series"><Settings2 size={15} /></button>
    </div></div>
    <div className="interactive-legend">{series.map((item, index) => <button key={item.metric} className={item.visible ? "active" : ""} onClick={() => update(index, { visible: !item.visible })}><i style={{ background: item.color }} />{METRICS[item.metric]?.short ?? item.metric}{item.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>)}</div>
    {configOpen && <div className="series-config">
      {series.map((item, index) => <div key={item.metric}>
        <button className="series-eye" onClick={() => update(index, { visible: !item.visible })}>{item.visible ? <Check size={13} /> : <EyeOff size={13} />}</button>
        <span>{METRICS[item.metric]?.label}</span>
        <select value={item.type} onChange={(event) => update(index, { type: event.target.value as ChartType })}><option value="line">Line</option><option value="bar">Bar</option><option value="area">Area</option></select>
        <select value={item.axis} onChange={(event) => update(index, { axis: event.target.value as Axis })}><option value="left">Left axis</option><option value="right">Right axis</option></select>
        <input type="color" value={item.color} onChange={(event) => update(index, { color: event.target.value })} aria-label={`${item.metric} color`} />
        <button onClick={() => setSeries((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={13} /></button>
      </div>)}
      <label className="add-series"><Plus size={13} /> Add metric <select defaultValue="" onChange={(event) => { addMetric(event.target.value); event.currentTarget.value = ""; }}><option value="" disabled>Select…</option>{Object.entries(METRICS).filter(([metric]) => !series.some((item) => item.metric === metric)).map(([metric, definition]) => <option value={metric} key={metric}>{definition.label}</option>)}</select></label>
    </div>}
    <div className="chart advanced-chart" ref={chartRef}>
      {data.length === 0 || visible.length === 0 ? <div className="chart-empty">No reliable periods or visible series for this selection.</div> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 12, right: hasRight ? 22 : 8, left: 4, bottom: 8 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} />
        <YAxis yAxisId="left" scale={effectiveLogScale ? "log" : "linear"} domain={["auto", "auto"]} tickFormatter={axisFormatter("left")} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} />
        {hasRight && <YAxis yAxisId="right" orientation="right" scale={effectiveLogScale ? "log" : "linear"} domain={["auto", "auto"]} tickFormatter={axisFormatter("right")} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} />}
        {!effectiveLogScale && <ReferenceLine yAxisId="left" y={0} stroke="var(--border-strong)" strokeWidth={1.2} />}
        <Tooltip content={<DetailedTooltip series={effectiveSeries} unit={unit} currency={currency} mode={mode} />} />
        {effectiveSeries.map((item) => item.type === "bar" ? <Bar key={item.metric} yAxisId={item.axis} dataKey={item.metric} fill={item.color} radius={[3, 3, 0, 0]} opacity={.82} /> : item.type === "area" ? <Area key={item.metric} yAxisId={item.axis} type="monotone" dataKey={item.metric} stroke={item.color} fill={item.color} fillOpacity={.13} strokeWidth={2} connectNulls={false} /> : <Line key={item.metric} yAxisId={item.axis} type="monotone" dataKey={item.metric} stroke={item.color} strokeWidth={2} dot={false} connectNulls={false} />)}
      </ComposedChart></ResponsiveContainer>}
    </div>
    <div className="panel-foot"><span>Units: {unit} · Left/right axes are independent · Missing facts remain gaps</span><span>{effectiveLogScale ? "Logarithmic" : "Linear"} scale</span></div>
  </article>;
}

function DetailedTooltip({ active, payload, label, series, unit, currency, mode }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; payload: { period: FinancialPeriod } }>; label?: string; series: SeriesConfig[]; unit: Unit; currency: string; mode: ChartMode }) {
  if (!active || !payload?.length) return null;
  const period = payload[0].payload.period;
  return <div className="chart-tooltip detailed"><b>{label} · {period.periodEnd}</b>{payload.map((entry) => {
    const definition = METRICS[entry.dataKey]; const config = series.find((item) => item.metric === entry.dataKey); const fact = period.facts[entry.dataKey as MetricKey];
    const formatted = isPercent(entry.dataKey, mode) ? `${entry.value.toFixed(1)}%` : definition?.kind === "perShare" ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(entry.value) : `${entry.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix(unit)}`;
    return <span key={entry.dataKey}><i style={{ background: config?.color }} /><span>{definition?.label}<small>{fact?.provenance.provider ?? "Calculated"} · {fact?.provenance.status ?? "formula"}<br />{fact?.provenance.formula ?? definition?.formula ?? fact?.provenance.concept}</small></span><strong>{formatted}</strong></span>;
  })}</div>;
}
