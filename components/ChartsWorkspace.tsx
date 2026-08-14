"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, Brush, CartesianGrid, ComposedChart, LabelList, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createAutoChartPlan, familyLabel, formatChartValue, indexToHundred, unitFamily, validateSeries, type AutoSeriesPlan, type UnitFamily } from "@/lib/auto-chart";
import { chartDomain, niceTicks, type ThemeName } from "@/lib/charting";
import { derivedValue, safeDivide } from "@/lib/finance";
import { recessionBands, snapToAxis, splitMarks } from "@/lib/chart-annotations";
import { addMetric, applyPreset, CHART_PRESETS, setCompanies, chartMetrics, chartTickers, chartTitle, createWorkspaceChart, createWorkspaceSeries, deserializeWorkspace, duplicateChart, focusCompany, hasOverrides, moveItem, patchSeries, RANGE_OPTIONS, removeSeries, resetSeries, serializeWorkspace, SERIES_COLORS, toggleSeries, type LayoutMode, type RangePreset, type ScaleMode, type SeriesAxis, type SeriesStyle, type ValueMode, type WorkspaceChart, type WorkspaceSeries } from "@/lib/chart-workspace";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { alignMixedSeries, frequencyLabel, frequencyOptions, fundamentalObservations, marketObservations, providerMarketFrequency } from "@/lib/mixed-series";
import { CHART_METRIC_GROUPS as METRIC_GROUPS, METRICS, VALUATION_METRICS } from "@/lib/metrics";
import { analyzeVisibleSeries } from "@/lib/series-analysis";
import type { CompanyDataset, MarketBar, PricePoint, SeriesFrequency, SeriesObservation } from "@/lib/types";

const DEFAULT_METRICS = ["stockPrice", "freeCashFlowPerShare"];
const STORAGE_KEY = "finscope.chartWorkspace.v3";
const today = () => new Date().toISOString().slice(0, 10);

type SeriesStatus = "Loading" | "Ready" | "Partial" | "No data" | "Failed";
type ResolvedPlan = AutoSeriesPlan & { style: SeriesStyle };
type Bundle = { series: WorkspaceSeries; plan: ResolvedPlan; observations: SeriesObservation[]; status: SeriesStatus; currency: string; warning?: string; error?: string };

/**
 * A valuation multiple on each fiscal date, using the price of that date.
 *
 * Every ratio here is refused when its denominator is zero or negative: a
 * company that burned cash is not cheap, and a negative multiple sorts as
 * though it were. The series shows nothing for those periods instead.
 */
function valuationObservations(dataset: CompanyDataset, metric: string, frequency: SeriesFrequency, prices: Record<string, PricePoint | null>): SeriesObservation[] {
  return dataset.periods
    .filter((period) => period.periodicity === frequency)
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
    .flatMap((period) => {
      const point = prices[`${dataset.company.ticker}|${period.periodEnd}`];
      const close = point?.priceClose ?? point?.close ?? null;
      const shares = derivedValue(period, "sharesOutstanding") ?? derivedValue(period, "dilutedShares");
      if (close == null || shares == null) return [];
      const marketCap = close * shares;
      const positive = (value: number | null) => value != null && value > 0 ? value : null;
      const denominator = metric === "priceToEarnings" ? positive(derivedValue(period, "netIncome"))
        : metric === "priceToSales" ? positive(derivedValue(period, "revenue"))
        : positive(derivedValue(period, "freeCashFlow"));
      if (denominator == null) return [];
      const value = metric === "freeCashFlowYield" ? safeDivide(denominator, marketCap) : safeDivide(marketCap, denominator);
      if (value == null || !Number.isFinite(value)) return [];
      return [{
        date: period.periodEnd, value, fiscalPeriodEnd: period.periodEnd, filingDate: period.filingDate,
        frequency, currency: period.currency, unit: METRICS[metric]?.kind ?? "ratio",
        source: "SEC + Yahoo Finance", status: "Calculated and verified" as const, rawObservation: true as const,
      }];
    });
}

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

export function ChartsWorkspace({ initialData, seed, theme = "dark" }: { initialData: CompanyDataset; seed?: { ticker?: string; metric?: string; nonce: number; style?: SeriesStyle; frequency?: SeriesFrequency }; theme?: ThemeName }) {
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
    const presentation = seed.style || seed.frequency ? { style: seed.style, frequency: seed.frequency } : undefined;
    setCharts((current) => current.length ? current.map((chart, index) => index ? chart : focusCompany(chart, ticker, seed.metric, presentation)) : defaultCharts(ticker));
  }, [seed, initialData.company.ticker]);

  const retryCompany = useCallback((ticker: string) => setCompanyErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== ticker))), []);
  // Takes an updater, not a value: two edits landing in one render batch would
  // otherwise both start from the same stale chart and the later one would win.
  function updateChart(id: string, update: (chart: WorkspaceChart) => WorkspaceChart) { setCharts((current) => current.map((chart) => chart.id === id ? update(chart) : chart)); }
  function newChartId() { const id = `chart-${nextChartNumber}`; setNextChartNumber((value) => value + 1); return id; }
  function addChart() { const id = newChartId(); setCharts((current) => [...current, createWorkspaceChart(id, DEFAULT_METRICS.map((metric) => createWorkspaceSeries(id, initialData.company.ticker, metric)))]); }

  return <div className="charts-page">
    <header className="page-heading"><div><h1>Charts</h1><p>Pick companies and metrics. Each unit gets its own panel on a shared date axis. Frequency, series type, colors and scales are chosen from the metrics themselves — open <b>Series options</b> to override any of them, or to overlay two units on one plot area.</p></div><button onClick={addChart}>Add chart</button></header>
    <div className="workspace-charts">{charts.map((chart, index) => <ChartEditor
      key={chart.id} chart={chart} datasets={datasets} companyErrors={companyErrors} fallbackTicker={initialData.company.ticker} onlyChart={charts.length === 1} theme={theme}
      onChange={(update) => updateChart(chart.id, update)} onRetryCompany={retryCompany}
      onDuplicate={() => { const id = newChartId(); setCharts((current) => [...current.slice(0, index + 1), duplicateChart(chart, id), ...current.slice(index + 1)]); }}
      onMove={(direction) => setCharts((current) => moveItem(current, index, direction))}
      onRemove={() => setCharts((current) => current.filter((item) => item.id !== chart.id))}
      canMoveUp={index > 0} canMoveDown={index < charts.length - 1}
    />)}</div>
    {!charts.length && <p className="simple-state">No charts yet. <button className="text-button" onClick={addChart}>Add a chart</button> to start.</p>}
  </div>;
}

function ChartEditor({ chart, datasets, companyErrors, fallbackTicker, onlyChart, theme, onChange, onRetryCompany, onDuplicate, onMove, onRemove, canMoveUp, canMoveDown }: {
  chart: WorkspaceChart; datasets: Record<string, CompanyDataset>; companyErrors: Record<string, string>; fallbackTicker: string; onlyChart: boolean; theme: ThemeName;
  onChange: (update: (chart: WorkspaceChart) => WorkspaceChart) => void; onRetryCompany: (ticker: string) => void; onDuplicate: () => void; onMove: (direction: -1 | 1) => void; onRemove: () => void; canMoveUp: boolean; canMoveDown: boolean;
}) {
  const [bars, setBars] = useState<Record<string, MarketBar[]>>({});
  const [marketErrors, setMarketErrors] = useState<Record<string, string>>({});
  const [periodPrices, setPeriodPrices] = useState<Record<string, PricePoint | null>>({});
  const [marketLoading, setMarketLoading] = useState<Record<string, boolean>>({});
  const [retryNonce, setRetryNonce] = useState(0);
  const surface = useRef<HTMLDivElement>(null);

  const tickers = chartTickers(chart);
  const metrics = chartMetrics(chart);
  const { earliest, from, to } = useMemo(() => {
    const first = chartTickers(chart).flatMap((ticker) => datasets[ticker]?.periods.map((period) => period.periodEnd) ?? []).sort()[0] ?? `${Number(today().slice(0, 4)) - 10}${today().slice(4)}`;
    return { earliest: first, from: startDate(chart.range, first), to: today() };
  }, [chart, datasets]);

  const plans = useMemo(() => {
    const automatic = createAutoChartPlan(chart.series.map((series) => ({ id: series.uid, ticker: series.ticker, metric: series.metric, dataset: datasets[series.ticker], frequency: series.frequency })), theme);
    // Assigning an axis by hand only means something inside one plot area, so
    // the first manual axis collapses the automatic panel split. Left and right
    // then refer to the two axes the reader can actually see.
    // Overlaying is a request, never a default: either the reader asked for it
    // outright, or they assigned an axis by hand, which means the same thing.
    const overlay = (chart.overlay || chart.series.some((series) => series.axis !== undefined)) && chart.values !== "indexed";
    const families = [...new Set(automatic.map((plan) => plan.family))];
    return automatic.map((plan, index) => {
      const series = chart.series[index];
      // Rebased series are all percentages of their own base, so a second axis
      // with its own range would defeat the comparison the mode exists for.
      const axis = chart.values === "indexed" ? "left" as const
        : series.axis ?? (overlay && families.indexOf(plan.family) === 1 ? "right" as const : plan.axis);
      return { ...plan, style: (series.style ?? plan.type) as SeriesStyle, axis, color: series.color ?? plan.color, panel: overlay ? 0 : plan.panel };
    });
  }, [chart.series, chart.values, chart.overlay, datasets, theme]);

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

  // A valuation series needs the share price on each fiscal date, not today's.
  // Pairing a current price with an old fundamental would invent a multiple
  // that never existed.
  const valuationKey = useMemo(() => {
    const wanted = new Set<string>();
    for (const [index, series] of chart.series.entries()) {
      if (!VALUATION_METRICS.has(series.metric)) continue;
      const dataset = datasets[series.ticker]; if (!dataset) continue;
      for (const period of dataset.periods) {
        if (period.periodicity !== plans[index].frequency) continue;
        if (period.periodEnd >= from && period.periodEnd <= to) wanted.add(`${series.ticker}|${period.periodEnd}`);
      }
    }
    return [...wanted].sort().join(",");
  }, [chart.series, plans, datasets, from, to]);

  useEffect(() => {
    if (!valuationKey) return;
    let active = true;
    const byTicker = new Map<string, string[]>();
    for (const entry of valuationKey.split(",")) {
      const [ticker, date] = entry.split("|");
      byTicker.set(ticker, [...(byTicker.get(ticker) ?? []), date]);
    }
    for (const [ticker, dates] of byTicker) {
      fetch(`/api/prices/${encodeURIComponent(ticker)}?dates=${dates.join(",")}`).then(async (response) => {
        const payload = await response.json() as { points?: Array<{ requestedDate: string; point?: PricePoint }>; error?: string };
        if (!response.ok) throw new Error(payload.error || "Valuation prices unavailable");
        if (active) setPeriodPrices((current) => ({ ...current, ...Object.fromEntries((payload.points ?? []).map((item) => [`${ticker}|${item.requestedDate}`, item.point ?? null])) }));
      }).catch(() => { /* The series reports no data rather than a wrong multiple. */ });
    }
    return () => { active = false; };
  }, [valuationKey]);

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
      : VALUATION_METRICS.has(series.metric)
        ? valuationObservations(dataset, series.metric, plan.frequency, periodPrices)
        : fundamentalObservations(dataset, series.metric, plan.frequency, "fiscal-period");
    const windowed = raw.filter((item) => item.date >= from && item.date <= to);
    // Rebasing happens after windowing, so 100 is the first point actually on
    // screen rather than the first the provider ever published.
    const shaped = chart.values === "indexed" ? indexToHundred(windowed) : windowed;
    const validation = validateSeries(shaped, plan.frequency, dataset.company.resolutionStatus !== "unresolved");
    return {
      series, plan, currency, observations: validation.observations,
      status: validation.valid ? validation.invalidCount ? "Partial" : "Ready" : "No data",
      warning: validation.valid ? validation.reason : windowed.length ? (chart.values === "indexed" && !shaped.length ? "Cannot rebase: the first value is zero or negative" : validation.reason) : undefined,
    };
  }), [chart.series, chart.values, plans, datasets, companyErrors, bars, marketErrors, marketLoading, periodPrices, from, to]);

  const drawn = useMemo(() => bundles.filter((bundle) => bundle.series.visible && bundle.observations.length), [bundles]);
  const rows = useMemo(() => {
    const aligned = alignMixedSeries(drawn.map((bundle) => ({ definition: { id: bundle.series.uid, ticker: bundle.series.ticker, metric: bundle.series.metric, frequency: bundle.plan.frequency, missingData: "report-points" as const }, observations: bundle.observations })));
    return aligned.map((row) => ({ date: row.date, ...Object.fromEntries(drawn.map((bundle) => [bundle.series.uid, row.cells[bundle.series.uid]?.value ?? null])) })) as Array<Record<string, unknown>>;
  }, [drawn]);
  // Indexed values are all percentages of their own base, so they belong on one
  // axis. Splitting by company answers "how did each of these do", where one
  // combined chart answers "how do these compare".
  const groups = useMemo<Array<{ key: string; label: string; bundles: Bundle[] }>>(() => {
    if (chart.layout === "grid") {
      // One plot per company and metric. The comparison is then read across the
      // grid rather than through an axis two series happen to share.
      return chartTickers(chart).flatMap((ticker) => chartMetrics(chart).map((metric) => ({
        key: `${ticker}:${metric}`, label: `${ticker} · ${METRICS[metric]?.short ?? metric}`,
        bundles: drawn.filter((bundle) => bundle.series.ticker === ticker && bundle.series.metric === metric),
      }))).filter((group) => group.bundles.length);
    }
    if (chart.layout !== "per-company") return [{ key: "all", label: "", bundles: drawn }];
    return chartTickers(chart)
      .map((ticker) => ({ key: ticker, label: ticker, bundles: drawn.filter((bundle) => bundle.series.ticker === ticker) }))
      .filter((group) => group.bundles.length);
  }, [chart, drawn]);
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
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--card").trim() || "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
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
        <button onClick={() => onChange((current) => ({ ...current, showDataTable: !current.showDataTable }))}>{chart.showDataTable ? "Hide data" : "Show data"}</button>
        <button onClick={exportCsv}>CSV</button><button onClick={exportPng}>PNG</button>
        <button disabled={!canMoveUp} onClick={() => onMove(-1)}>↑</button><button disabled={!canMoveDown} onClick={() => onMove(1)}>↓</button>
        <button onClick={onDuplicate}>Duplicate</button><button disabled={onlyChart} onClick={onRemove}>Remove</button>
      </div>
    </header>

    <div className="chart-presets" role="group" aria-label="Presets">
      <span>Presets</span>
      {CHART_PRESETS.map((preset) => <button key={preset.id} onClick={() => onChange((current) => applyPreset(current, preset, fallbackTicker))}>{preset.label}</button>)}
    </div>

    <details className="company-picker"><summary>Companies<small>{tickers.length} selected</small></summary>
      <div>{DEFAULT_WATCHLIST.filter((company) => company.resolutionStatus !== "unresolved").map((company) => <label key={company.ticker}>
        <input type="checkbox" checked={tickers.includes(company.ticker)} onChange={(event) => onChange((current) => setCompanies(current, event.target.checked ? [...chartTickers(current), company.ticker] : chartTickers(current).filter((item) => item !== company.ticker)))}/>
        {company.ticker}<small>{company.name}</small>
      </label>)}</div>
      <div className="company-picker-actions"><button onClick={() => onChange((current) => setCompanies(current, [fallbackTicker]))}>Just {fallbackTicker}</button><button onClick={() => onChange((current) => setCompanies(current, DEFAULT_WATCHLIST.filter((company) => company.resolutionStatus !== "unresolved").map((company) => company.ticker)))}>All</button></div>
    </details>

    <section className="chart-controls">
      <label>Add metric<select value="" onChange={(event) => { if (event.target.value) onChange((current) => addMetric(current, event.target.value, fallbackTicker)); }}>
        <option value="">Metric…</option>
        {METRIC_GROUPS.map(([group, items]) => { const available = items.filter((metric) => !metrics.includes(metric)); return available.length ? <optgroup key={group} label={group}>{available.map((metric) => <option key={metric} value={metric}>{METRICS[metric]?.label ?? metric}</option>)}</optgroup> : null; })}
      </select></label>
      <div className="range-buttons" role="group" aria-label="Time range">{RANGE_OPTIONS.map(([value, label]) => <button key={value} className={chart.range === value ? "active" : ""} onClick={() => onChange((current) => ({ ...current, range: value }))}>{label}</button>)}</div>
    </section>

    <section className="chart-appearance">
      <label>Values<select value={chart.values} onChange={(event) => onChange((current) => ({ ...current, values: event.target.value as ValueMode }))}>
        <option value="raw">Actual values</option><option value="indexed">Indexed to 100</option>
      </select></label>
      <label>Panels<select value={chart.overlay ? "overlay" : "split"} onChange={(event) => onChange((current) => ({ ...current, overlay: event.target.value === "overlay" }))} disabled={chart.values === "indexed"}>
        <option value="split">One per unit</option><option value="overlay">Overlay on two axes</option>
      </select>{chart.values === "indexed" && <small>Indexed values already share one axis</small>}</label>
      <label>Scale<select value={chart.scale} onChange={(event) => onChange((current) => ({ ...current, scale: event.target.value as ScaleMode }))}>
        <option value="auto">Auto</option><option value="zero">Start at zero</option><option value="fit">Fit to data</option>
      </select></label>
      <label>Layout<select value={chart.layout} onChange={(event) => onChange((current) => ({ ...current, layout: event.target.value as LayoutMode }))} disabled={tickers.length < 2}>
        <option value="combined">One chart</option><option value="per-company">One per company</option><option value="grid">Grid: company × metric</option>
      </select>{tickers.length < 2 && <small>Add a second company to split</small>}</label>
      <label className="chart-switch"><input type="checkbox" checked={chart.showGrid} onChange={(event) => onChange((current) => ({ ...current, showGrid: event.target.checked }))}/> Grid</label>
      <label className="chart-switch"><input type="checkbox" checked={chart.showPoints} onChange={(event) => onChange((current) => ({ ...current, showPoints: event.target.checked }))}/> Points</label>
      <label className="chart-switch"><input type="checkbox" checked={chart.showSplits} onChange={(event) => onChange((current) => ({ ...current, showSplits: event.target.checked }))}/> Splits</label>
      <label className="chart-switch"><input type="checkbox" checked={chart.showRecessions} onChange={(event) => onChange((current) => ({ ...current, showRecessions: event.target.checked }))}/> Recessions</label>
    </section>

    <section className="series-chips" aria-label="Series on this chart">{bundles.map((bundle) => {
      const family = unitFamily(bundle.series.metric);
      const latest = bundle.observations.at(-1);
      const analysis = bundle.observations.length > 1 ? analyzeVisibleSeries(bundle.observations, family === "percent" ? "margin" : "cagr") : null;
      return <div className={`series-chip${bundle.series.visible ? "" : " muted"}`} key={bundle.series.uid}>
        <button className="series-toggle" onClick={() => onChange((current) => toggleSeries(current, bundle.series.uid))} aria-pressed={bundle.series.visible} title={bundle.series.visible ? "Hide series" : "Show series"}>
          <i style={{ background: bundle.series.visible ? bundle.plan.color : "transparent", borderColor: bundle.plan.color }}/>
          <b>{bundle.series.ticker} · {METRICS[bundle.series.metric]?.short ?? bundle.series.metric}</b>
          <small>{frequencyLabel(bundle.plan.frequency)}{latest ? ` · ${formatChartValue(latest.value, family, bundle.currency)}` : ""}{analysis?.value != null ? ` · ${analysis.kind === "margin" ? `${analysis.value >= 0 ? "+" : ""}${(analysis.value * 100).toFixed(1)} pp` : `${analysis.value >= 0 ? "+" : ""}${(analysis.value * 100).toFixed(1)}% CAGR`}` : bundle.status === "Ready" ? "" : ` · ${bundle.status}`}</small>
        </button>
        {bundle.error && <small className="error-text">{bundle.error}<button className="text-button" onClick={() => { onRetryCompany(bundle.series.ticker); setRetryNonce((value) => value + 1); }}>Retry</button></small>}
        {!bundle.error && bundle.warning && <small className="warning-text">{bundle.warning}</small>}
        <button className="series-remove" aria-label={`Remove ${bundle.series.ticker} ${bundle.series.metric}`} onClick={() => onChange((current) => removeSeries(current, bundle.series.uid))}>×</button>
      </div>;
    })}</section>

    {chart.series.length > 0 && <details className="series-options">
      <summary>Series options<small>{chart.series.filter(hasOverrides).length ? `${chart.series.filter(hasOverrides).length} adjusted` : "all automatic"}</small></summary>
      <div className="series-options-grid">
        {bundles.map((bundle) => {
          const series = bundle.series;
          const set = (patch: Parameters<typeof patchSeries>[2]) => onChange((current) => patchSeries(current, series.uid, patch));
          return <div className="series-option-row" key={series.uid}>
            <span className="series-option-name"><i style={{ background: bundle.plan.color }}/>{series.ticker} · {METRICS[series.metric]?.short ?? series.metric}</span>
            <label>Frequency<select value={series.frequency ?? ""} onChange={(event) => set({ frequency: event.target.value ? event.target.value as WorkspaceSeries["frequency"] : undefined })}>
              <option value="">Auto · {frequencyLabel(bundle.plan.frequency)}</option>
              {frequencyOptions(series.metric).map((frequency) => <option key={frequency} value={frequency}>{frequencyLabel(frequency)}</option>)}
            </select></label>
            <label>Style<select value={series.style ?? ""} onChange={(event) => set({ style: event.target.value ? event.target.value as SeriesStyle : undefined })}>
              <option value="">Auto · {bundle.plan.type === "bar" ? "Bar" : "Line"}</option>
              <option value="line">Line</option><option value="bar">Bar</option><option value="area">Area</option>
            </select></label>
            <label>Axis<select value={series.axis ?? ""} onChange={(event) => set({ axis: event.target.value ? event.target.value as SeriesAxis : undefined })}>
              <option value="">Auto · {bundle.plan.axis === "right" ? "Right" : "Left"}</option>
              <option value="left">Left</option><option value="right">Right</option>
            </select></label>
            <div className="series-palette" role="group" aria-label={`Colour for ${series.ticker} ${series.metric}`}>
              {SERIES_COLORS.map((colour) => <button key={colour.value} type="button" title={colour.name} aria-label={colour.name} aria-pressed={bundle.plan.color === colour.value}
                className={bundle.plan.color === colour.value ? "active" : ""} style={{ background: colour.value }}
                onClick={() => set({ color: series.color === colour.value ? undefined : colour.value })}/>)}
            </div>
            <button disabled={!hasOverrides(series)} onClick={() => onChange((current) => resetSeries(current, series.uid))}>Reset</button>
          </div>;
        })}
      </div>
      <small className="series-options-note">Units get a panel each so nothing implies a relationship the data has not shown. Assigning an axis by hand overlays everything on one plot area instead — useful, but where the lines cross is then decided by the two ranges rather than by the data.</small>
    </details>}
    {!drawn.length && <p className="simple-state">{anyLoading ? "Loading data…" : chart.series.length ? "No observations in this window. Widen the time range or pick another metric." : "Add a company and a metric to draw this chart."}</p>}
    {drawn.length > 0 && <div className={`chart-stack${chart.layout === "grid" && groups.length > 1 ? " grid" : ""}`} ref={surface}>{groups.flatMap((group) => {
      const panels = chart.values === "indexed" || chart.overlay || chart.series.some((series) => series.axis !== undefined) ? [0] : [...new Set(group.bundles.map((bundle) => bundle.plan.panel))].sort((a, b) => a - b);
      return panels.map((panel) => {
        const bundles = panels.length === 1 ? group.bundles : group.bundles.filter((bundle) => bundle.plan.panel === panel);
        // In grid mode the group label already names the metric, so repeating
        // its unit family would only pad the heading.
        const family = chart.layout === "grid" ? "" : chart.values === "indexed" ? "Indexed to 100" : [...new Set(bundles.map((item) => familyLabel(unitFamily(item.series.metric))))].join(" · ");
        const heading = [group.label, family].filter(Boolean).join(" · ");
        return <ChartPanel key={`${group.key}-${panel}`} chart={chart} rows={rows} bundles={bundles} heading={heading} datasets={datasets}
          single={groups.length === 1 && panels.length === 1} compact={chart.layout === "grid" && groups.length > 1}
          showBrush={chart.layout !== "grid" && group.key === groups.at(-1)?.key && panel === panels.at(-1) && rows.length > 60}/>;
      });
    })}</div>}
    {chart.showDataTable && drawn.length > 0 && <DataTable bundles={drawn} rows={rows}/>}
  </article>;
}

/**
 * Value at the end of a series, drawn once.
 *
 * This is the secondary encoding the palette's contrast check requires, and it
 * answers the question a legend cannot: which line ended where. The text wears
 * the interface's ink rather than the series colour — position beside the line
 * already carries identity, and coloured text on white is the part of the
 * palette that reads worst. It is rendered through LabelList because Recharts
 * draws a `label` element once per point, not once per series.
 */
function endLabel(uid: string, lastIndex: number, formatter: (value: number) => string, placed: Map<string, number>, growth?: string) {
  return function EndLabel(props: { x?: string | number; y?: string | number; value?: unknown; index?: number }) {
    if (props.index !== lastIndex || typeof props.value !== "number") return <></>;
    // Series that finish at a similar height would print on top of each other,
    // so each label is nudged clear of the ones already placed. Keyed by series
    // so a repeated render settles on the same position instead of drifting.
    let y = placed.get(uid);
    if (y == null) {
      y = Number(props.y) - 9;
      const taken = [...placed.values()];
      while (taken.some((other) => Math.abs(other - y!) < 28)) y -= 28;
      placed.set(uid, y);
    }
    // The rate belongs beside the line it describes. Comparing a share price
    // against cash flow per share is a comparison of two growth rates, and
    // reading them off a legend above the plot means looking away from the
    // shapes being compared.
    return <g>
      <text x={Number(props.x) - 6} y={y} textAnchor="end" className="chart-end-label">{formatter(props.value)}</text>
      {growth && <text x={Number(props.x) - 6} y={y + 12} textAnchor="end" className="chart-end-growth">{growth}</text>}
    </g>;
  } as unknown as React.ComponentProps<typeof LabelList>["content"];
}

function ChartPanel({ chart, rows, bundles, heading, datasets, single, compact, showBrush }: { chart: WorkspaceChart; rows: Array<Record<string, unknown>>; bundles: Bundle[]; heading: string; datasets: Record<string, CompanyDataset>; single: boolean; compact: boolean; showBrush: boolean }) {
  const sides = ["left", "right"] as const;
  const axes = sides.map((side) => {
    const items = bundles.filter((bundle) => bundle.plan.axis === side);
    const values = rows.flatMap((row) => items.map((bundle) => typeof row[bundle.series.uid] === "number" ? row[bundle.series.uid] as number : null));
    const family: UnitFamily = chart.values === "indexed" ? "indexed" : items[0] ? unitFamily(items[0].series.metric) : "currency";
    // "auto" defers to the metric, which floats a share price and anchors a
    // revenue line; the other two are the reader overruling that.
    const mode = chart.scale === "auto" ? (items.some((bundle) => bundle.plan.scale === "auto") ? "auto" : "zero") : chart.scale;
    const computed = chartDomain(values, mode).domain;
    // Every axis gets explicit ticks, including the floating one a share price
    // uses. Left to itself the library divides its own bounds and prints 0, 85,
    // 170, 255 — evenly spaced but on values nobody would have chosen.
    const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
    const bounds: [number, number] | null = typeof computed[0] === "number" && typeof computed[1] === "number"
      ? [computed[0], computed[1]]
      : finite.length ? [Math.min(...finite), Math.max(...finite)] : null;
    const ticks = bounds ? niceTicks(bounds[0], bounds[1]) : [];
    const domain = ticks.length >= 2 ? [ticks[0], ticks.at(-1)!] as [number, number] : computed;
    return { side, items, family, currency: items[0]?.currency ?? "USD", domain, ticks: ticks.length >= 2 ? ticks : undefined, hasNegative: values.some((value) => value != null && value < 0) };
  });
  const placedLabels = new Map<string, number>();
  const lastIndexWithValue = (uid: string) => {
    for (let index = rows.length - 1; index >= 0; index--) {
      const value = rows[index][uid];
      if (typeof value === "number" && Number.isFinite(value)) return index;
    }
    return -1;
  };
  const axisDates = rows.map((row) => row.date as string);
  const bands = chart.showRecessions && axisDates.length ? recessionBands(axisDates[0], axisDates.at(-1)!)
    .flatMap((band) => { const start = snapToAxis(axisDates, band.start), end = snapToAxis(axisDates, band.end); return start && end && start !== end ? [{ ...band, start, end }] : []; }) : [];
  const splits = chart.showSplits && axisDates.length
    ? splitMarks([...new Set(bundles.map((bundle) => bundle.series.ticker))].flatMap((ticker) => datasets[ticker] ? [datasets[ticker]] : []), axisDates[0], axisDates.at(-1)!)
      .flatMap((mark) => { const at = snapToAxis(axisDates, mark.date); return at ? [{ ...mark, at }] : []; })
    : [];
  const spanYears = rows.length ? (Date.parse(rows.at(-1)!.date as string) - Date.parse(rows[0].date as string)) / (365.2425 * 86_400_000) : 0;
  const tickDate = (value: unknown) => spanYears > 6 ? String(value).slice(0, 4) : String(value).slice(0, 7);
  return <div className="chart-panel">
    {!single && <div className="chart-panel-label">{heading}</div>}
    <div className={`chart-canvas${compact ? " tiny" : single ? "" : " compact"}`}><ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} syncId={chart.id} margin={{ top: 16, right: 16, bottom: 4, left: 4 }} barGap={2} barCategoryGap="18%">
        {chart.showGrid && <CartesianGrid vertical={false} stroke="var(--chart-grid)"/>}
        {bands.map((band) => <ReferenceArea key={band.label} x1={band.start} x2={band.end} yAxisId={axes.find((axis) => axis.items.length)?.side ?? "left"} fill="#111" fillOpacity={.05} strokeOpacity={0} label={compact ? undefined : { value: band.label, position: "insideTop", fontSize: 10, fill: "#7a7a7a" }}/>)}
        {splits.map((mark) => <ReferenceLine key={`${mark.ticker}-${mark.date}`} x={mark.at} yAxisId={axes.find((axis) => axis.items.length)?.side ?? "left"} stroke="#9a9a9a" strokeDasharray="3 3" label={compact ? undefined : { value: mark.label, position: "insideTopLeft", fontSize: 10, fill: "#7a7a7a" }}/>)}
        <XAxis dataKey="date" tickFormatter={tickDate} minTickGap={44} tickLine={false} axisLine={{ stroke: "var(--border)" }}/>
        {axes.map((axis) => <YAxis key={axis.side} yAxisId={axis.side} orientation={axis.side} hide={!axis.items.length} width={64} tickLine={false} axisLine={false} domain={axis.domain} ticks={axis.ticks} tickFormatter={(value) => formatChartValue(Number(value), axis.family, axis.currency)}/>)}
        {axes.filter((axis) => axis.items.length && axis.hasNegative).map((axis) => <ReferenceLine key={`${axis.side}-zero`} yAxisId={axis.side} y={0} stroke="#b4b4b4"/>)}
        {chart.values === "indexed" && axes.filter((axis) => axis.items.length).slice(0, 1).map((axis) => <ReferenceLine key="base" yAxisId={axis.side} y={100} stroke="#b4b4b4" strokeDasharray="4 4"/>)}
        <Tooltip content={<ChartTooltip bundles={bundles}/>} cursor={{ stroke: "#b4b4b4", strokeDasharray: "3 3" }}/>
        {bundles.map((bundle) => {
          const family = chart.values === "indexed" ? "indexed" as const : unitFamily(bundle.series.metric);
          // Past four series the labels collide more than they inform.
          const last = bundles.length > 4 ? -1 : lastIndexWithValue(bundle.series.uid);
          const analysis = bundle.observations.length > 1 ? analyzeVisibleSeries(bundle.observations, family === "percent" ? "margin" : "cagr") : null;
          const growth = analysis?.value == null ? undefined
            : analysis.kind === "margin" ? `${analysis.value >= 0 ? "+" : ""}${(analysis.value * 100).toFixed(1)} pp`
            : `${analysis.value >= 0 ? "+" : ""}${(analysis.value * 100).toFixed(1)}% CAGR`;
          const label = last < 0 ? null : <LabelList dataKey={bundle.series.uid} content={endLabel(bundle.series.uid, last, (value) => formatChartValue(value, family, bundle.currency), placedLabels, growth)}/>;
          const dot = chart.showPoints ? { r: 4, strokeWidth: 0, fill: bundle.plan.color } : false;
          if (bundle.plan.style === "bar") {
            // Rounded data-ends, and a surface gap so neighbouring bars read as
            // separate marks rather than one block.
            return <Bar key={bundle.series.uid} dataKey={bundle.series.uid} yAxisId={bundle.plan.axis} fill={bundle.plan.color} maxBarSize={34} radius={[4, 4, 0, 0]} isAnimationActive={false}/>;
          }
          if (bundle.plan.style === "area") {
            return <Area key={bundle.series.uid} dataKey={bundle.series.uid} yAxisId={bundle.plan.axis} stroke={bundle.plan.color} strokeWidth={2} fill={bundle.plan.color} fillOpacity={.14} dot={dot} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }} type="linear" connectNulls isAnimationActive={false}>{label}</Area>;
          }
          return <Line key={bundle.series.uid} dataKey={bundle.series.uid} yAxisId={bundle.plan.axis} stroke={bundle.plan.color} strokeWidth={2} dot={dot} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }} type="linear" connectNulls isAnimationActive={false}>{label}</Line>;
        })}
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
