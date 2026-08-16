"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, Brush, CartesianGrid, ComposedChart, LabelList, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AreaChart as AreaIcon, BarChart3, Brush as BrushIcon, CandlestickChart, Eye, EyeOff, LineChart as LineIcon, Palette, X } from "lucide-react";
import { createAutoChartPlan, familyLabel, formatChartValue, indexToZero, periodChange, unitFamily, validateSeries, type AutoSeriesPlan, type UnitFamily } from "@/lib/auto-chart";
import { chartDomain, logTicks, niceTicks, type ThemeName } from "@/lib/charting";
import { derivedValue, safeDivide } from "@/lib/finance";
import { recessionBands, snapToAxis, splitMarks } from "@/lib/chart-annotations";
import { addCompany, addMetric, applyPreset, CHART_PRESETS, removeCompany, chartMetrics, chartTickers, chartTitle, createWorkspaceChart, createWorkspaceSeries, deserializeWorkspace, focusCompany, hasOverrides, patchSeries, RANGE_OPTIONS, removeSeries, resetSeries, serializeWorkspace, SERIES_COLORS, toggleSeries, type LayoutMode, type RangePreset, type ScaleMode, type SeriesAxis, type SeriesStyle, type WorkspaceChart, type WorkspaceSeries } from "@/lib/chart-workspace";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { validateSeries as validateChartSeries } from "@/lib/chart-spec";
import { alignMixedSeries, frequencyLabel, frequencyOptions, fundamentalObservations, marketObservations, movingAverage, providerMarketFrequency, MARKET_SERIES_METRICS, MOVING_AVERAGES } from "@/lib/mixed-series";
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

  return <div className="charts-page">
    <header className="page-heading"><div><h1>Charts</h1><p>Pick companies and metrics. Each unit gets its own panel on a shared date axis. Frequency, series type, colours and scales are chosen from the metrics themselves — open <b>Chart settings</b> to override any of them.</p></div></header>
    {/* One chart. Adding, duplicating, reordering and removing them were seven
        buttons of workspace management above a page whose job is to draw a
        line; companies and metrics are added to the chart that is already
        here. A workspace stored with several is collapsed to the first. */}
    <div className="workspace-charts">{charts.slice(0, 1).map((chart) => <ChartEditor
      key={chart.id} chart={chart} datasets={datasets} companyErrors={companyErrors} fallbackTicker={initialData.company.ticker} theme={theme}
      onChange={(update) => updateChart(chart.id, update)} onRetryCompany={retryCompany}
    />)}</div>
  </div>;
}

function ChartEditor({ chart, datasets, companyErrors, fallbackTicker, theme, onChange, onRetryCompany }: {
  chart: WorkspaceChart; datasets: Record<string, CompanyDataset>; companyErrors: Record<string, string>; fallbackTicker: string; theme: ThemeName;
  onChange: (update: (chart: WorkspaceChart) => WorkspaceChart) => void; onRetryCompany: (ticker: string) => void;
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
    const automatic = createAutoChartPlan(chart.series.map((series) => ({ id: series.uid, ticker: series.ticker, metric: series.metric, dataset: datasets[series.ticker],
      // Per-series choice first, then the chart-wide one, then the metric decides.
      frequency: series.frequency ?? (chart.frequency && !MARKET_SERIES_METRICS.has(series.metric) ? chart.frequency : undefined) })), theme);
    // Assigning an axis by hand only means something inside one plot area, so
    // the first manual axis collapses the automatic panel split. Left and right
    // then refer to the two axes the reader can actually see.
    // Overlaying is a request, never a default: either the reader asked for it
    // outright, or they assigned an axis by hand, which means the same thing.
    const rebased = chart.values !== "raw";
    const overlay = (chart.overlay || chart.series.some((series) => series.axis !== undefined)) && !rebased;
    const families = [...new Set(automatic.map((plan) => plan.family))];
    return automatic.map((plan, index) => {
      const series = chart.series[index];
      // Rebased series are all percentages of their own base, so a second axis
      // with its own range would defeat the comparison the mode exists for.
      const axis = rebased ? "left" as const
        : series.axis ?? (overlay && families.indexOf(plan.family) === 1 ? "right" as const : plan.axis);
      return { ...plan, style: (series.style ?? plan.type) as SeriesStyle, axis, color: series.color ?? plan.color, panel: overlay ? 0 : plan.panel };
    });
  }, [chart.series, chart.values, chart.overlay, chart.frequency, datasets, theme]);

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
    const shaped = chart.values === "indexed" ? indexToZero(windowed) : chart.values === "change" ? periodChange(windowed) : windowed;
    const validation = validateSeries(shaped, plan.frequency, dataset.company.resolutionStatus !== "unresolved");
    // A second pass with the stricter rules: unusable dates, infinities from a
    // division upstream, two facts claiming one period, a frequency the metric
    // cannot have, a split the registry never recorded. It drops the points it
    // must and reports the rest, so one bad series costs its own points instead
    // of taking the chart down.
    const strict = validateChartSeries(
      { id: series.uid, ticker: series.ticker, metric: series.metric, frequency: plan.frequency,
        transformation: chart.values === "indexed" ? "indexed" : chart.values === "change" ? "percentChange" : "none" },
      validation.observations,
    );
    const problem = strict.problems[0]?.detail;
    return {
      series, plan, currency,
      observations: strict.usable ? strict.observations : [],
      status: !strict.usable ? "No data" : validation.valid ? (validation.invalidCount || strict.problems.length ? "Partial" : "Ready") : "No data",
      warning: !strict.usable
        ? strict.reason
        : (validation.valid ? validation.reason : undefined) ?? problem
          ?? (windowed.length && chart.values === "indexed" && !shaped.length ? "Cannot rebase: the first value is zero or negative" : undefined),
    };
  }), [chart.series, chart.values, plans, datasets, companyErrors, bars, marketErrors, marketLoading, periodPrices, from, to]);

  const drawn = useMemo(() => bundles
    // Indexing to a base or differencing turns four numbers into one, so a
    // candle has nothing left to be. It falls back to the line it describes
    // rather than drawing bodies around a value that is no longer a close.
    .map((bundle) => chart.values !== "raw" && bundle.plan.style === "candle"
      ? { ...bundle, plan: { ...bundle.plan, style: "line" as const } }
      : bundle)
    .filter((bundle) => bundle.series.visible && bundle.observations.length), [bundles, chart.values]);
  // A moving average belongs to the market series it smooths, computed over
  // that series' own sessions at the grain the reader chose — a 50 on a weekly
  // chart is fifty weeks. Nothing else gets one: averaging a quarterly margin
  // would smooth four filings into a number no company reports.
  const averages = useMemo(() => {
    const byDate = new Map<string, number>();
    if (!chart.movingAverages.length) return byDate;
    for (const bundle of drawn) {
      if (!MARKET_SERIES_METRICS.has(bundle.series.metric)) continue;
      for (const window of chart.movingAverages) {
        const line = movingAverage(bundle.observations, window);
        bundle.observations.forEach((item, index) => {
          const value = line[index];
          if (value != null) byDate.set(`${bundle.series.uid}~sma${window}|${item.date}`, value);
        });
      }
    }
    return byDate;
  }, [drawn, chart.movingAverages]);

  const rows = useMemo(() => {
    const aligned = alignMixedSeries(drawn.map((bundle) => ({ definition: { id: bundle.series.uid, ticker: bundle.series.ticker, metric: bundle.series.metric, frequency: bundle.plan.frequency, missingData: "report-points" as const }, observations: bundle.observations })));
    return aligned.map((row) => {
      const cells: Record<string, unknown> = { date: row.date };
      for (const bundle of drawn) {
        const cell = row.cells[bundle.series.uid];
        cells[bundle.series.uid] = cell?.value ?? null;
        // A candle needs four numbers where a line needs one, so the session's
        // range travels beside the close under keys of its own.
        if (bundle.plan.style === "candle") {
          const item = cell?.observation;
          const open = item?.open ?? null; const high = item?.high ?? null; const low = item?.low ?? null;
          const close = item?.value ?? null;
          const drawable = [open, high, low, close].every((value) => value != null && Number.isFinite(value));
          cells[`${bundle.series.uid}~range`] = drawable ? [Math.min(low!, open!, close!), Math.max(high!, open!, close!)] : null;
          cells[`${bundle.series.uid}~ohlc`] = drawable ? { open, high, low, close } : null;
        }
        if (MARKET_SERIES_METRICS.has(bundle.series.metric)) {
          for (const window of chart.movingAverages) {
            cells[`${bundle.series.uid}~sma${window}`] = averages.get(`${bundle.series.uid}~sma${window}|${row.date}`) ?? null;
          }
        }
      }
      return cells;
    }) as Array<Record<string, unknown>>;
  }, [drawn, chart.movingAverages, averages]);
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
      <div><h2>{title}</h2></div>
    </header>

    <div className="entity-row" aria-label="Companies on this chart">
      {tickers.map((ticker) => {
        const colour = bundles.find((bundle) => bundle.series.ticker === ticker)?.plan.color;
        const hidden = chart.series.filter((series) => series.ticker === ticker).every((series) => !series.visible);
        const paintAll = (value: string | undefined) => onChange((current) => current.series.filter((series) => series.ticker === ticker).reduce((chart, series) => patchSeries(chart, series.uid, { color: value }), current));
        return <span className={`entity-chip${hidden ? " muted" : ""}`} key={ticker}>
          <i style={{ background: colour }}/><b>{ticker}</b>
          <Swatches label={ticker} icon={<BrushIcon size={13}/>} current={colour} onPick={paintAll}/>
          <button aria-label={`${hidden ? "Show" : "Hide"} ${ticker}`} title={hidden ? "Show" : "Hide"} onClick={() => onChange((current) => ({ ...current, series: current.series.map((series) => series.ticker === ticker ? { ...series, visible: hidden } : series) }))}>{hidden ? <EyeOff size={13}/> : <Eye size={13}/>}</button>
          <button aria-label={`Remove ${ticker}`} title="Remove" onClick={() => onChange((current) => removeCompany(current, ticker))}><X size={13}/></button>
        </span>;
      })}
      <details className="add-chip"><summary>+ Company</summary>
        <div>{DEFAULT_WATCHLIST.filter((company) => company.resolutionStatus !== "unresolved" && !tickers.includes(company.ticker)).map((company) => <button key={company.ticker} onClick={() => onChange((current) => addCompany(current, company.ticker))}>{company.ticker}<small>{company.name}</small></button>)}</div>
      </details>
    </div>

    <div className="entity-row" aria-label="Metrics on this chart">
      {metrics.map((metric) => {
        const bundle = bundles.find((item) => item.series.metric === metric);
        const style = chart.series.find((series) => series.metric === metric)?.style ?? bundle?.plan.type ?? "line";
        const patchAll = (patch: Parameters<typeof patchSeries>[2]) => onChange((current) => current.series.filter((series) => series.metric === metric).reduce((chart, series) => patchSeries(chart, series.uid, patch), current));
        const hidden = chart.series.filter((series) => series.metric === metric).every((series) => !series.visible);
        // A candle is only meaningful where the provider reports a session's
        // range, which is the market series and nothing else.
        const market = MARKET_SERIES_METRICS.has(metric);
        const shapes = [
          ["line", "Line", <LineIcon key="l" size={13}/>] as const,
          ["bar", "Bars", <BarChart3 key="b" size={13}/>] as const,
          ["area", "Area", <AreaIcon key="a" size={13}/>] as const,
          ...(market ? [["candle", "Candles", <CandlestickChart key="c" size={13}/>] as const] : []),
        ];
        const grain = chart.series.find((series) => series.metric === metric)?.frequency ?? bundle?.plan.frequency;
        return <span className={`entity-chip${hidden ? " muted" : ""}`} key={metric}>
          <b>{METRICS[metric]?.short ?? metric}</b>
          <span className="chip-shapes" role="group" aria-label={`Shape for ${metric}`}>
            {shapes.map(([value, label, icon]) => <button key={value} className={style === value ? "active" : ""} aria-pressed={style === value} aria-label={`Draw as ${label.toLowerCase()}`} title={label} onClick={() => patchAll({ style: value })}>{icon}</button>)}
          </span>
          {market && <span className="chip-shapes" role="group" aria-label={`Session length for ${metric}`}>
            {([["daily", "D", "Daily sessions"], ["weekly", "W", "Weekly sessions"], ["monthly", "M", "Monthly sessions"]] as const).map(([value, short, label]) =>
              <button key={value} className={grain === value ? "active" : ""} aria-pressed={grain === value} title={label} onClick={() => patchAll({ frequency: value })}>{short}</button>)}
          </span>}
          <Swatches label={METRICS[metric]?.short ?? metric} icon={<Palette size={13}/>} current={bundle?.plan.color} onPick={(value) => patchAll({ color: value })}/>
          <button aria-label={`${hidden ? "Show" : "Hide"} ${metric}`} title={hidden ? "Show" : "Hide"} onClick={() => onChange((current) => ({ ...current, series: current.series.map((series) => series.metric === metric ? { ...series, visible: hidden } : series) }))}>{hidden ? <EyeOff size={13}/> : <Eye size={13}/>}</button>
          <button aria-label={`Remove ${metric}`} title="Remove" onClick={() => onChange((current) => ({ ...current, series: current.series.filter((series) => series.metric !== metric) }))}><X size={13}/></button>
        </span>;
      })}
      <details className="add-chip"><summary>+ Metric</summary>
        <div>{METRIC_GROUPS.map(([group, items]) => { const available = items.filter((metric) => !metrics.includes(metric)); return available.length ? <section key={group}><b>{group}</b>{available.map((metric) => <button key={metric} onClick={() => onChange((current) => addMetric(current, metric, fallbackTicker))}>{METRICS[metric]?.label ?? metric}</button>)}</section> : null; })}</div>
      </details>
    </div>

    <section className="chart-toolbar">
      <div className="segmented" role="group" aria-label="Frequency">
        {([["annual", "Annual"], ["quarterly", "Quarterly"], ["ttm", "Quarterly TTM"]] as const).map(([value, label]) =>
          <button key={value} className={chart.frequency === value ? "active" : ""} onClick={() => onChange((current) => ({ ...current, frequency: current.frequency === value ? undefined : value }))}>{label}</button>)}
      </div>
      <div className="segmented" role="group" aria-label="Time range">
        {RANGE_OPTIONS.map(([value, label]) => <button key={value} className={chart.range === value ? "active" : ""} onClick={() => onChange((current) => ({ ...current, range: value }))}>{label}</button>)}
      </div>
      <button className={`pill${chart.values === "indexed" ? " active" : ""}`} onClick={() => onChange((current) => ({ ...current, values: current.values === "indexed" ? "raw" : "indexed" }))}>Index to zero</button>
      <button className={`pill${chart.values === "change" ? " active" : ""}`} onClick={() => onChange((current) => ({ ...current, values: current.values === "change" ? "raw" : "change" }))}>% change</button>
      <button className={`pill${chart.scale === "log" ? " active" : ""}`} onClick={() => onChange((current) => ({ ...current, scale: current.scale === "log" ? "auto" : "log" }))}>Log</button>
      {chart.series.some((series) => MARKET_SERIES_METRICS.has(series.metric)) && <span className="segmented" role="group" aria-label="Moving averages">
        {MOVING_AVERAGES.map((window) => <button key={window} className={chart.movingAverages.includes(window) ? "active" : ""} aria-pressed={chart.movingAverages.includes(window)}
          title={`${window}-session simple moving average`}
          onClick={() => onChange((current) => ({ ...current, movingAverages: current.movingAverages.includes(window) ? current.movingAverages.filter((item) => item !== window) : [...current.movingAverages, window] }))}>SMA {window}</button>)}
      </span>}
    </section>

    {!drawn.length && <p className="simple-state">{anyLoading ? "Loading data…" : chart.series.length ? "No observations in this window. Widen the time range or pick another metric." : "Add a company and a metric to draw this chart."}</p>}
    {drawn.length > 0 && <div className={`chart-stack${chart.layout === "grid" && groups.length > 1 ? " grid" : ""}`} ref={surface}>{groups.flatMap((group) => {
      const panels = chart.values !== "raw" || chart.overlay || chart.series.some((series) => series.axis !== undefined) ? [0] : [...new Set(group.bundles.map((bundle) => bundle.plan.panel))].sort((a, b) => a - b);
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

    {/* Everything below the chart is a setting, not the subject. The page put
        presets, panels, scale, layout, four checkboxes and a per-series grid
        above the first plot, so a reader met seven rows of controls before a
        single line of the company they came to look at. */}
    <details className="chart-settings">
      <summary>Chart settings<small>{chart.series.filter(hasOverrides).length ? `${chart.series.filter(hasOverrides).length} adjusted` : "all automatic"}</small></summary>
      <div className="chart-settings-body">
        {/* Taking the drawn figures away with you is worth keeping; it was the
            company it kept that was the problem. */}
        <div className="chart-exports">
          <button onClick={() => onChange((current) => ({ ...current, showDataTable: !current.showDataTable }))}>{chart.showDataTable ? "Hide the numbers" : "Show the numbers"}</button>
          <button onClick={exportCsv}>Download CSV</button>
          <button onClick={exportPng}>Download PNG</button>
        </div>
    <div className="chart-presets" role="group" aria-label="Presets">
      <span>Presets</span>
      {CHART_PRESETS.map((preset) => <button key={preset.id} onClick={() => onChange((current) => applyPreset(current, preset, fallbackTicker))}>{preset.label}</button>)}
    </div>
    <section className="chart-appearance">
      <label>Panels<select value={chart.overlay ? "overlay" : "split"} onChange={(event) => onChange((current) => ({ ...current, overlay: event.target.value === "overlay" }))} disabled={chart.values !== "raw"}>
        <option value="split">One per unit</option><option value="overlay">Overlay on two axes</option>
      </select>{chart.values !== "raw" && <small>Rebased series already share one axis</small>}</label>
      <label>Scale<select value={chart.scale === "log" ? "auto" : chart.scale} onChange={(event) => onChange((current) => ({ ...current, scale: event.target.value as ScaleMode }))} disabled={chart.scale === "log"}>
        <option value="auto">Auto</option><option value="zero">Start at zero</option><option value="fit">Fit to data</option>
      </select>{chart.scale === "log" && <small>Log is on</small>}</label>
      <label>Layout<select value={chart.layout} onChange={(event) => onChange((current) => ({ ...current, layout: event.target.value as LayoutMode }))} disabled={tickers.length < 2}>
        <option value="combined">One chart</option><option value="per-company">One per company</option><option value="grid">Grid: company × metric</option>
      </select>{tickers.length < 2 && <small>Add a second company to split</small>}</label>
      <label className="chart-switch"><input type="checkbox" checked={chart.showGrid} onChange={(event) => onChange((current) => ({ ...current, showGrid: event.target.checked }))}/> Grid</label>
      <label className="chart-switch"><input type="checkbox" checked={chart.showPoints} onChange={(event) => onChange((current) => ({ ...current, showPoints: event.target.checked }))}/> Points</label>
      <label className="chart-switch"><input type="checkbox" checked={chart.showSplits} onChange={(event) => onChange((current) => ({ ...current, showSplits: event.target.checked }))}/> Splits</label>
      <label className="chart-switch"><input type="checkbox" checked={chart.showRecessions} onChange={(event) => onChange((current) => ({ ...current, showRecessions: event.target.checked }))}/> Recessions</label>
    </section>
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
      </div>
    </details>
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

/**
 * Colour picker as a small popover on a chip.
 *
 * "Automatic" is a real choice rather than a colour: it deletes the override so
 * the series follows the palette again, including when the theme changes or a
 * second company arrives and colour switches from meaning metric to meaning
 * company.
 */
function Swatches({ label, icon, current, onPick }: { label: string; icon: React.ReactNode; current?: string; onPick: (value: string | undefined) => void }) {
  return <details className="chip-swatches">
    <summary aria-label={`Colour for ${label}`} title="Colour">{icon}</summary>
    <div>
      {SERIES_COLORS.map((colour) => <button key={colour.value} className={current === colour.value ? "active" : ""} style={{ background: colour.value }} aria-label={colour.name} title={colour.name} onClick={() => onPick(colour.value)}/>)}
      <button className="swatch-auto" onClick={() => onPick(undefined)}>Automatic</button>
    </div>
  </details>;
}

/**
 * One hue per window, chosen from the validated palette and held apart from the
 * series colours so a moving average is never mistaken for a company.
 */
const SMA_COLORS: Record<number, string> = { 20: "var(--warning)", 50: "var(--accent)", 200: "var(--muted)" };

interface CandleShapeProps { x?: number; y?: number; width?: number; height?: number; payload?: Record<string, unknown> }

/**
 * A session drawn as its whole range: the high-to-low wick, with the body from
 * open to close inside it.
 *
 * The bar is laid out against low-to-high, so the pixels it already occupies
 * carry the scale and the body is placed by interpolating inside them — a
 * custom shape cannot reach the axis to ask.
 *
 * Hollow when the session closed up, solid when it closed down. That is the
 * convention every trading screen uses, and the reason it exists: green against
 * red separates at delta-E 6.5 under protanopia, which is a warning rather than
 * a pass, so direction is carried by fill as well as by hue.
 */
function SessionCandle({ x, y, width, height, payload, uid, up, down, log = false }: CandleShapeProps & { uid: string; up: string; down: string; log?: boolean }) {
  const ohlc = payload?.[`${uid}~ohlc`] as { open: number; high: number; low: number; close: number } | null | undefined;
  if (!ohlc || x == null || y == null || width == null || height == null) return null;
  // On a logarithmic axis equal pixel distances are equal ratios, so the body
  // is placed by the logarithm of each price. Interpolating linearly there put
  // the open and close in the wrong half of their own wick.
  const usable = log && ohlc.low > 0;
  const scale = (value: number) => usable ? Math.log(value) : value;
  const ceiling = scale(ohlc.high); const floor = scale(ohlc.low);
  const span = ceiling - floor;
  const at = (value: number) => span <= 0 ? y : y + ((ceiling - scale(value)) / span) * height;
  const rising = ohlc.close >= ohlc.open;
  const colour = rising ? up : down;
  const top = at(Math.max(ohlc.open, ohlc.close));
  const body = Math.max(1, at(Math.min(ohlc.open, ohlc.close)) - top);
  const thickness = Math.max(1, Math.min(width * .7, 11));
  const centre = x + width / 2;
  return <g>
    <line x1={centre} x2={centre} y1={y} y2={y + height} stroke={colour} strokeWidth={1}/>
    <rect x={centre - thickness / 2} y={top} width={thickness} height={body} fill={rising ? "var(--card)" : colour} stroke={colour} strokeWidth={1} rx={1}/>
  </g>;
}

function ChartPanel({ chart, rows, bundles, heading, datasets, single, compact, showBrush }: { chart: WorkspaceChart; rows: Array<Record<string, unknown>>; bundles: Bundle[]; heading: string; datasets: Record<string, CompanyDataset>; single: boolean; compact: boolean; showBrush: boolean }) {
  const sides = ["left", "right"] as const;
  const axes = sides.map((side) => {
    const items = bundles.filter((bundle) => bundle.plan.axis === side);
    const values = rows.flatMap((row) => items.flatMap((bundle) => {
      // A candle reaches above and below its close, and an axis that never saw
      // the wicks would clip them.
      const range = row[`${bundle.series.uid}~range`];
      if (bundle.plan.style === "candle" && Array.isArray(range)) return range as number[];
      return [typeof row[bundle.series.uid] === "number" ? row[bundle.series.uid] as number : null];
    }));
    const family: UnitFamily = chart.values !== "raw" ? "percent" : items[0] ? unitFamily(items[0].series.metric) : "currency";
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
    // The Log button only ever changed how the domain was computed, and the
    // axis element was never told, so it drew a linear scale with linear ticks
    // and pressing Log did nothing at all. It needs both.
    const log = mode === "log" && finite.length > 0 && finite.every((value) => value > 0);
    const ticks = bounds ? (log ? logTicks(bounds[0], bounds[1]) : niceTicks(bounds[0], bounds[1])) : [];
    const domain = ticks.length >= 2 ? [ticks[0], ticks.at(-1)!] as [number, number] : computed;
    return { side, items, family, log, currency: items[0]?.currency ?? "USD", domain, ticks: ticks.length >= 2 ? ticks : undefined, hasNegative: values.some((value) => value != null && value < 0) };
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
        {axes.map((axis) => <YAxis key={axis.side} yAxisId={axis.side} orientation={axis.side} hide={!axis.items.length} width={64} tickLine={false} axisLine={false}
          scale={axis.log ? "log" : "auto"} domain={axis.domain} ticks={axis.ticks}
          tickFormatter={(value) => formatChartValue(Number(value), axis.family, axis.currency)}/>)}
        {axes.filter((axis) => axis.items.length && axis.hasNegative).map((axis) => <ReferenceLine key={`${axis.side}-zero`} yAxisId={axis.side} y={0} stroke="#b4b4b4"/>)}
        {chart.values !== "raw" && axes.filter((axis) => axis.items.length).slice(0, 1).map((axis) => <ReferenceLine key="base" yAxisId={axis.side} y={0} stroke="var(--border-strong)" strokeDasharray="4 4"/>)}
        <Tooltip content={<ChartTooltip bundles={bundles}/>} cursor={{ stroke: "#b4b4b4", strokeDasharray: "3 3" }}/>
        {/* Moving averages first, so the price they smooth is drawn over them
            rather than under. Thin, dashed and unlabelled: they are a reading
            aid for the series beside them, not series in their own right. */}
        {chart.movingAverages.flatMap((window) => bundles
          .filter((bundle) => MARKET_SERIES_METRICS.has(bundle.series.metric))
          .map((bundle) => <Line key={`${bundle.series.uid}~sma${window}`} dataKey={`${bundle.series.uid}~sma${window}`} yAxisId={bundle.plan.axis}
            stroke={SMA_COLORS[window]} strokeWidth={1.5} strokeDasharray={window === 20 ? "4 3" : window === 50 ? "7 4" : undefined}
            dot={false} activeDot={false} type="linear" connectNulls isAnimationActive={false}/>))}
        {bundles.map((bundle) => {
          const family = chart.values !== "raw" ? "percent" as const : unitFamily(bundle.series.metric);
          // Past four series the labels collide more than they inform.
          const last = bundles.length > 4 ? -1 : lastIndexWithValue(bundle.series.uid);
          const analysis = bundle.observations.length > 1 ? analyzeVisibleSeries(bundle.observations, family === "percent" ? "margin" : "cagr") : null;
          const growth = analysis?.value == null ? undefined
            : analysis.kind === "margin" ? `${analysis.value >= 0 ? "+" : ""}${(analysis.value * 100).toFixed(1)} pp`
            : `${analysis.value >= 0 ? "+" : ""}${(analysis.value * 100).toFixed(1)}% CAGR`;
          const label = last < 0 ? null : <LabelList dataKey={bundle.series.uid} content={endLabel(bundle.series.uid, last, (value) => formatChartValue(value, family, bundle.currency), placedLabels, growth)}/>;
          const dot = chart.showPoints ? { r: 4, strokeWidth: 0, fill: bundle.plan.color } : false;
          if (bundle.plan.style === "candle") {
            const logAxis = axes.find((axis) => axis.side === bundle.plan.axis)?.log ?? false;
            return <Bar key={bundle.series.uid} dataKey={`${bundle.series.uid}~range`} yAxisId={bundle.plan.axis} isAnimationActive={false}
              shape={(props: object) => <SessionCandle {...props as CandleShapeProps} uid={bundle.series.uid} up={bundle.plan.color} down="var(--danger)" log={logAxis}/>}/>;
          }
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
