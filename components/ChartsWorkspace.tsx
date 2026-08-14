"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, Brush, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createAutoChartPlan, familyLabel, formatChartValue, unitFamily, validateSeries, type AutoSeriesPlan, type UnitFamily } from "@/lib/auto-chart";
import { chartDomain } from "@/lib/charting";
import { addCompany, addMetric, chartMetrics, chartTickers, chartTitle, createWorkspaceChart, createWorkspaceSeries, deserializeWorkspace, duplicateChart, focusCompany, moveItem, removeSeries, RANGE_OPTIONS, serializeWorkspace, toggleSeries, type RangePreset, type WorkspaceChart, type WorkspaceSeries } from "@/lib/chart-workspace";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { alignMixedSeries, frequencyLabel, fundamentalObservations, marketObservations, providerMarketFrequency } from "@/lib/mixed-series";
import { METRICS } from "@/lib/metrics";
import { analyzeVisibleSeries } from "@/lib/series-analysis";
import type { CompanyDataset, MarketBar, SeriesObservation } from "@/lib/types";

const METRIC_GROUPS: Array<[string, string[]]> = [
  ["Market", ["stockPrice"]],
  ["Income statement", ["revenue", "grossProfit", "operatingIncome", "netIncome"]],
  ["Cash flow", ["operatingCashFlow", "capitalExpenditures", "freeCashFlow"]],
  ["Per share", ["revenuePerShare", "netIncomePerShare", "freeCashFlowPerShare"]],
  ["Margins", ["grossMargin", "operatingMargin", "netMargin", "freeCashFlowMargin"]],
  ["Shares and capital", ["dilutedShares", "sharesOutstanding", "shareRepurchases", "shareIssuance", "dividendsPaid", "stockBasedCompensation"]],
];
const DEFAULT_METRICS = ["stockPrice", "freeCashFlowPerShare"];
const STORAGE_KEY = "finscope.chartWorkspace.v3";
const today = () => new Date().toISOString().slice(0, 10);

type SeriesStatus = "Loading" | "Ready" | "Partial" | "No data" | "Failed";
type Bundle = { series: WorkspaceSeries; plan: AutoSeriesPlan; observations: SeriesObservation[]; status: SeriesStatus; currency: string; warning?: string; error?: string };

function startDate(range: RangePreset, earliest: string) {
  return range === "max" ? earliest : `${Number(today().slice(0, 4)) - Number(range)}${today().slice(4)}`;
}
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}
function downloadCsv(name: string, rows: string[][]) {
  downloadBlob(name, new Blob([rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
}
function defaultCharts(ticker: string): WorkspaceChart[] {
  return [createWorkspaceChart("chart-1", DEFAULT_METRICS.map((metric) => createWorkspaceSeries("chart-1", ticker, metric)))];
}
function parseStoredCharts(ticker: string): WorkspaceChart[] {
  if (typeof window === "undefined") return defaultCharts(ticker);
  try { return deserializeWorkspace(localStorage.getItem(STORAGE_KEY) ?? "[]"); }
  catch { return defaultCharts(ticker); }
}

export function ChartsWorkspace({ initialData, seed }: { initialData: CompanyDataset; seed?: { ticker?: string; metric?: string; nonce: number } }) {
  const [datasets, setDatasets] = useState<Record<string, CompanyDataset>>({ [initialData.company.ticker]: initialData });
  const [companyErrors, setCompanyErrors] = useState<Record<string, string>>({});
  const [charts, setCharts] = useState<WorkspaceChart[]>(() => parseStoredCharts(initialData.company.ticker));
  const [nextChartNumber, setNextChartNumber] = useState(() => charts.reduce((max, chart) => Math.max(max, Number(chart.id.replace(/\D/g, "")) || 0), 0) + 1);
  const pending = useRef(new Set<string>());
  const appliedSeed = useRef<number>(undefined);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, serializeWorkspace(charts)); }, [charts]);

  // Every ticker on any chart is loaded here. Without this a restored workspace,
  // or a company opened from the ranking table, stayed on "Loading" forever.
  const requiredTickers = [...new Set(charts.flatMap((chart) => chart.series.map((series) => series.ticker)))].sort().join("|");
  useEffect(() => {
    let active = true;
    for (const ticker of requiredTickers.split("|").filter(Boolean)) {
      if (datasets[ticker] || companyErrors[ticker] || pending.current.has(ticker)) continue;
      pending.current.add(ticker);
      fetch(`/api/company/${encodeURIComponent(ticker)}`, { cache: "no-store" }).then(async (response) => {
        const payload = await response.json() as CompanyDataset & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load company");
        if (active) setDatasets((current) => ({ ...current, [ticker]: payload }));
      }).catch((cause) => active && setCompanyErrors((current) => ({ ...current, [ticker]: cause instanceof Error ? cause.message : "Could not load company" })))
        .finally(() => pending.current.delete(ticker));
    }
    return () => { active = false; };
  }, [requiredTickers, datasets, companyErrors]);

  // Opening a company in Charts points the first chart at it, keeping the
  // metrics already on screen. It never appends yet another pair of series.
  useEffect(() => {
    if (!seed || seed.nonce === appliedSeed.current || (!seed.ticker && !seed.metric)) return;
    appliedSeed.current = seed.nonce;
    const ticker = seed.ticker ?? initialData.company.ticker;
    setCharts((current) => current.length ? current.map((chart, index) => index ? chart : focusCompany(chart, ticker, seed.metric)) : defaultCharts(ticker));
  }, [seed, initialData.company.ticker]);

  const retryCompany = useCallback((ticker: string) => setCompanyErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== ticker))), []);
  function updateChart(id: string, next: WorkspaceChart) { setCharts((current) => current.map((chart) => chart.id === id ? next : chart)); }
  function newChartId() { const id = `chart-${nextChartNumber}`; setNextChartNumber((value) => value + 1); return id; }
  function addChart() { const id = newChartId(); setCharts((current) => [...current, createWorkspaceChart(id, DEFAULT_METRICS.map((metric) => createWorkspaceSeries(id, initialData.company.ticker, metric)))]); }

  return <div className="charts-page">
    <header className="page-heading"><div><h1>Charts</h1><p>Pick companies and metrics. Frequency, axes, series type, colors and scales are chosen for you from the metrics themselves.</p></div><button onClick={addChart}>Add chart</button></header>
    <div className="workspace-charts">{charts.map((chart, index) => <ChartEditor
      key={chart.id} chart={chart} datasets={datasets} companyErrors={companyErrors} fallbackTicker={initialData.company.ticker} onlyChart={charts.length === 1}
      onChange={(next) => updateChart(chart.id, next)} onRetryCompany={retryCompany}
      onDuplicate={() => { const id = newChartId(); setCharts((current) => [...current.slice(0, index + 1), duplicateChart(chart, id), ...current.slice(index + 1)]); }}
      onMove={(direction) => setCharts((current) => moveItem(current, index, direction))}
      onRemove={() => setCharts((current) => current.filter((item) => item.id !== chart.id))}
      canMoveUp={index > 0} canMoveDown={index < charts.length - 1}
    />)}</div>
    {!charts.length && <p className="simple-state">No charts yet. <button className="text-button" onClick={addChart}>Add a chart</button> to start.</p>}
  </div>;
}

function ChartEditor({ chart, datasets, companyErrors, fallbackTicker, onlyChart, onChange, onRetryCompany, onDuplicate, onMove, onRemove, canMoveUp, canMoveDown }: {
  chart: WorkspaceChart; datasets: Record<string, CompanyDataset>; companyErrors: Record<string, string>; fallbackTicker: string; onlyChart: boolean;
  onChange: (chart: WorkspaceChart) => void; onRetryCompany: (ticker: string) => void; onDuplicate: () => void; onMove: (direction: -1 | 1) => void; onRemove: () => void; canMoveUp: boolean; canMoveDown: boolean;
}) {
  const [bars, setBars] = useState<Record<string, MarketBar[]>>({});
  const [marketErrors, setMarketErrors] = useState<Record<string, string>>({});
  const [marketLoading, setMarketLoading] = useState<Record<string, boolean>>({});
  const [retryNonce, setRetryNonce] = useState(0);
  const surface = useRef<HTMLDivElement>(null);

  const tickers = chartTickers(chart);
  const metrics = chartMetrics(chart);
  const { earliest, from, to } = useMemo(() => {
    const first = chartTickers(chart).flatMap((ticker) => datasets[ticker]?.periods.map((period) => period.periodEnd) ?? []).sort()[0] ?? `${Number(today().slice(0, 4)) - 10}${today().slice(4)}`;
    return { earliest: first, from: startDate(chart.range, first), to: today() };
  }, [chart, datasets]);

  const plans = useMemo(() => createAutoChartPlan(chart.series.map((series) => ({ id: series.uid, ticker: series.ticker, metric: series.metric, dataset: datasets[series.ticker] }))), [chart.series, datasets]);

  const marketKey = plans.filter((plan) => providerMarketFrequency(plan.frequency)).map((plan) => `${plan.ticker}:${plan.frequency}`).sort().join("|");
  useEffect(() => {
    if (!marketKey) return;
    let active = true;
    for (const request of [...new Set(marketKey.split("|"))]) {
      const [ticker, frequency] = request.split(":");
      const provider = providerMarketFrequency(frequency as AutoSeriesPlan["frequency"]);
      if (!provider) continue;
      queueMicrotask(() => { setMarketLoading((current) => ({ ...current, [request]: true })); setMarketErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== request))); });
      fetch(`/api/market/${encodeURIComponent(ticker)}?start=${earliest}&end=${today()}&frequency=${provider}`, { cache: "no-store" }).then(async (response) => {
        const payload = await response.json() as { bars?: MarketBar[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load stock price");
        if (active) setBars((current) => ({ ...current, [request]: payload.bars ?? [] }));
      }).catch((cause) => active && setMarketErrors((current) => ({ ...current, [request]: cause instanceof Error ? cause.message : "Could not load stock price" })))
        .finally(() => active && setMarketLoading((current) => ({ ...current, [request]: false })));
    }
    return () => { active = false; };
  }, [marketKey, earliest, retryNonce]);

  const bundles = useMemo<Bundle[]>(() => chart.series.map((series, index) => {
    const plan = plans[index];
    const dataset = datasets[series.ticker];
    const currency = dataset?.company.currency ?? "USD";
    if (!dataset) return { series, plan, observations: [], currency, status: companyErrors[series.ticker] ? "Failed" : "Loading", error: companyErrors[series.ticker] };
    const marketRequest = `${series.ticker}:${plan.frequency}`;
    const isMarket = Boolean(providerMarketFrequency(plan.frequency));
    if (isMarket && marketLoading[marketRequest] && !bars[marketRequest]) return { series, plan, observations: [], currency, status: "Loading" };
    if (isMarket && marketErrors[marketRequest]) return { series, plan, observations: [], currency, status: "Failed", error: marketErrors[marketRequest] };
    const raw = isMarket
      ? marketObservations(bars[marketRequest] ?? [], series.metric, plan.frequency)
      : fundamentalObservations(dataset, series.metric, plan.frequency, "fiscal-period");
    const windowed = raw.filter((item) => item.date >= from && item.date <= to);
    const validation = validateSeries(windowed, plan.frequency, dataset.company.resolutionStatus !== "unresolved");
    return {
      series, plan, currency, observations: validation.observations,
      status: validation.valid ? validation.invalidCount ? "Partial" : "Ready" : "No data",
      warning: validation.valid ? validation.reason : windowed.length ? validation.reason : undefined,
    };
  }), [chart.series, plans, datasets, companyErrors, bars, marketErrors, marketLoading, from, to]);

  const drawn = useMemo(() => bundles.filter((bundle) => bundle.series.visible && bundle.observations.length), [bundles]);
  const rows = useMemo(() => {
    const aligned = alignMixedSeries(drawn.map((bundle) => ({ definition: { id: bundle.series.uid, ticker: bundle.series.ticker, metric: bundle.series.metric, frequency: bundle.plan.frequency, missingData: "report-points" as const }, observations: bundle.observations })));
    return aligned.map((row) => ({ date: row.date, ...Object.fromEntries(drawn.map((bundle) => [bundle.series.uid, row.cells[bundle.series.uid]?.value ?? null])) })) as Array<Record<string, unknown>>;
  }, [drawn]);
  const panels = [...new Set(drawn.map((bundle) => bundle.plan.panel))].sort((a, b) => a - b);
  const anyLoading = bundles.some((bundle) => bundle.status === "Loading");

  function exportCsv() {
    const csv = [["chart", "ticker", "metric", "date", "frequency", "value", "currency", "unit", "source", "status"]];
    for (const bundle of drawn) for (const item of bundle.observations) csv.push([chart.id, bundle.series.ticker, bundle.series.metric, item.date, bundle.plan.frequency, String(item.value ?? ""), item.currency, item.unit, item.source, String(item.status)]);
    downloadCsv(`${chart.id}.csv`, csv);
  }
  function exportPng() {
    const node = surface.current?.querySelector("svg.recharts-surface") as SVGSVGElement | null;
    if (!node) return;
    const width = node.clientWidth || 1200; const height = node.clientHeight || 400; const ratio = 2;
    const clone = node.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = width * ratio; canvas.height = height * ratio;
      const context = canvas.getContext("2d"); if (!context) return;
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => blob && downloadBlob(`${chart.id}.png`, blob), "image/png");
    };
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(clone))))}`;
  }

  const title = chartTitle(chart, (metric) => METRICS[metric]?.short ?? metric);
  return <article className="workspace-chart">
    <header className="workspace-chart-header">
      <div><span>{chart.id}</span><h2>{title}</h2></div>
      <div>
        <button onClick={() => onChange({ ...chart, showDataTable: !chart.showDataTable })}>{chart.showDataTable ? "Hide data" : "Show data"}</button>
        <button onClick={exportCsv}>CSV</button><button onClick={exportPng}>PNG</button>
        <button disabled={!canMoveUp} onClick={() => onMove(-1)}>↑</button><button disabled={!canMoveDown} onClick={() => onMove(1)}>↓</button>
        <button onClick={onDuplicate}>Duplicate</button><button disabled={onlyChart} onClick={onRemove}>Remove</button>
      </div>
    </header>

    <section className="chart-controls">
      <label>Add company<select value="" onChange={(event) => { if (event.target.value) onChange(addCompany(chart, event.target.value)); }}>
        <option value="">Company…</option>
        {DEFAULT_WATCHLIST.filter((company) => company.resolutionStatus !== "unresolved" && !tickers.includes(company.ticker)).map((company) => <option key={company.ticker} value={company.ticker}>{company.ticker} — {company.name}</option>)}
      </select></label>
      <label>Add metric<select value="" onChange={(event) => { if (event.target.value) onChange(addMetric(chart, event.target.value, fallbackTicker)); }}>
        <option value="">Metric…</option>
        {METRIC_GROUPS.map(([group, items]) => { const available = items.filter((metric) => !metrics.includes(metric)); return available.length ? <optgroup key={group} label={group}>{available.map((metric) => <option key={metric} value={metric}>{METRICS[metric]?.label ?? metric}</option>)}</optgroup> : null; })}
      </select></label>
      <div className="range-buttons" role="group" aria-label="Time range">{RANGE_OPTIONS.map(([value, label]) => <button key={value} className={chart.range === value ? "active" : ""} onClick={() => onChange({ ...chart, range: value })}>{label}</button>)}</div>
    </section>

    <section className="series-chips" aria-label="Series on this chart">{bundles.map((bundle) => {
      const family = unitFamily(bundle.series.metric);
      const latest = bundle.observations.at(-1);
      const analysis = bundle.observations.length > 1 ? analyzeVisibleSeries(bundle.observations, family === "percent" ? "margin" : "cagr") : null;
      return <div className={`series-chip${bundle.series.visible ? "" : " muted"}`} key={bundle.series.uid}>
        <button className="series-toggle" onClick={() => onChange(toggleSeries(chart, bundle.series.uid))} aria-pressed={bundle.series.visible} title={bundle.series.visible ? "Hide series" : "Show series"}>
          <i style={{ background: bundle.series.visible ? bundle.plan.color : "transparent", borderColor: bundle.plan.color }}/>
          <b>{bundle.series.ticker} · {METRICS[bundle.series.metric]?.short ?? bundle.series.metric}</b>
          <small>{frequencyLabel(bundle.plan.frequency)}{latest ? ` · ${formatChartValue(latest.value, family, bundle.currency)}` : ""}{analysis?.value != null ? ` · ${analysis.kind === "margin" ? `${analysis.value >= 0 ? "+" : ""}${(analysis.value * 100).toFixed(1)} pp` : `${analysis.value >= 0 ? "+" : ""}${(analysis.value * 100).toFixed(1)}% CAGR`}` : bundle.status === "Ready" ? "" : ` · ${bundle.status}`}</small>
        </button>
        {bundle.error && <small className="error-text">{bundle.error}<button className="text-button" onClick={() => { onRetryCompany(bundle.series.ticker); setRetryNonce((value) => value + 1); }}>Retry</button></small>}
        {!bundle.error && bundle.warning && <small className="warning-text">{bundle.warning}</small>}
        <button className="series-remove" aria-label={`Remove ${bundle.series.ticker} ${bundle.series.metric}`} onClick={() => onChange(removeSeries(chart, bundle.series.uid))}>×</button>
      </div>;
    })}</section>

    {!drawn.length && <p className="simple-state">{anyLoading ? "Loading data…" : chart.series.length ? "No observations in this window. Widen the time range or pick another metric." : "Add a company and a metric to draw this chart."}</p>}
    {drawn.length > 0 && <div className="chart-stack" ref={surface}>{panels.map((panel) => <ChartPanel key={panel} chart={chart} rows={rows} bundles={drawn.filter((bundle) => bundle.plan.panel === panel)} single={panels.length === 1} showBrush={panel === panels.at(-1) && rows.length > 60}/>)}</div>}
    {chart.showDataTable && drawn.length > 0 && <DataTable bundles={drawn} rows={rows}/>}
  </article>;
}

function ChartPanel({ chart, rows, bundles, single, showBrush }: { chart: WorkspaceChart; rows: Array<Record<string, unknown>>; bundles: Bundle[]; single: boolean; showBrush: boolean }) {
  const sides = ["left", "right"] as const;
  const axes = sides.map((side) => {
    const items = bundles.filter((bundle) => bundle.plan.axis === side);
    const values = rows.flatMap((row) => items.map((bundle) => typeof row[bundle.series.uid] === "number" ? row[bundle.series.uid] as number : null));
    const family: UnitFamily = items[0] ? unitFamily(items[0].series.metric) : "currency";
    return { side, items, family, currency: items[0]?.currency ?? "USD", domain: chartDomain(values, items.some((bundle) => bundle.plan.scale === "auto") ? "auto" : "zero").domain, hasNegative: values.some((value) => value != null && value < 0) };
  });
  const spanYears = rows.length ? (Date.parse(rows.at(-1)!.date as string) - Date.parse(rows[0].date as string)) / (365.2425 * 86_400_000) : 0;
  const tickDate = (value: unknown) => spanYears > 6 ? String(value).slice(0, 4) : String(value).slice(0, 7);
  const heading = [...new Set(bundles.map((bundle) => familyLabel(unitFamily(bundle.series.metric))))].join(" · ");

  return <div className="chart-panel">
    {!single && <div className="chart-panel-label">{heading}</div>}
    <div className={`chart-canvas${single ? "" : " compact"}`}><ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} syncId={chart.id} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} stroke="#ececec"/>
        <XAxis dataKey="date" tickFormatter={tickDate} minTickGap={44} tickLine={false} axisLine={{ stroke: "#d8d8d8" }}/>
        {axes.map((axis) => <YAxis key={axis.side} yAxisId={axis.side} orientation={axis.side} hide={!axis.items.length} width={64} tickLine={false} axisLine={false} domain={axis.domain} tickFormatter={(value) => formatChartValue(Number(value), axis.family, axis.currency)}/>)}
        {axes.filter((axis) => axis.items.length && axis.hasNegative).map((axis) => <ReferenceLine key={`${axis.side}-zero`} yAxisId={axis.side} y={0} stroke="#b4b4b4"/>)}
        <Tooltip content={<ChartTooltip bundles={bundles}/>} cursor={{ stroke: "#b4b4b4", strokeDasharray: "3 3" }}/>
        {bundles.map((bundle) => bundle.plan.type === "bar"
          ? <Bar key={bundle.series.uid} dataKey={bundle.series.uid} yAxisId={bundle.plan.axis} fill={bundle.plan.color} maxBarSize={34} isAnimationActive={false}/>
          : <Line key={bundle.series.uid} dataKey={bundle.series.uid} yAxisId={bundle.plan.axis} stroke={bundle.plan.color} strokeWidth={2} dot={false} type="linear" connectNulls isAnimationActive={false}/>)}
        {showBrush && <Brush dataKey="date" height={22} travellerWidth={8} stroke="#b4b4b4" tickFormatter={tickDate}/>}
      </ComposedChart>
    </ResponsiveContainer></div>
  </div>;
}

function ChartTooltip({ active, label, payload, bundles }: { active?: boolean; label?: string; payload?: Array<{ dataKey: string; value: number | null }>; bundles: Bundle[] }) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter((entry) => entry.value != null);
  if (!entries.length) return null;
  return <div className="chart-tooltip"><b>{label}</b>{entries.map((entry) => {
    const bundle = bundles.find((item) => item.series.uid === entry.dataKey); if (!bundle) return null;
    return <span key={entry.dataKey}><i style={{ background: bundle.plan.color }}/><span>{bundle.series.ticker} {METRICS[bundle.series.metric]?.short ?? bundle.series.metric}</span><strong>{formatChartValue(entry.value, unitFamily(bundle.series.metric), bundle.currency, false)}</strong></span>;
  })}</div>;
}

function DataTable({ bundles, rows }: { bundles: Bundle[]; rows: Array<Record<string, unknown>> }) {
  return <section className="plain-section"><h3>Data</h3><div className="table-scroll"><table><thead><tr><th>Date</th>{bundles.map((bundle) => <th key={bundle.series.uid}>{bundle.series.ticker}<small>{METRICS[bundle.series.metric]?.short ?? bundle.series.metric}</small></th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.date as string}><th>{row.date as string}</th>{bundles.map((bundle) => <td key={bundle.series.uid}>{typeof row[bundle.series.uid] === "number" ? formatChartValue(row[bundle.series.uid] as number, unitFamily(bundle.series.metric), bundle.currency, false) : "—"}</td>)}</tr>)}</tbody></table></div></section>;
}
