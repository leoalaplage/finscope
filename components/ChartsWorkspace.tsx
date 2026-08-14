"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createAutoChartPlan, automaticDomain, validateSeries, type AutoSeriesPlan } from "@/lib/auto-chart";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { fundamentalObservations, indexObservationsTo100, marketObservations, alignMixedSeries, frequencyLabel, frequencyOptions, providerMarketFrequency } from "@/lib/mixed-series";
import { METRICS } from "@/lib/metrics";
import { analyzeVisibleSeries, formatVisibleAnalysis } from "@/lib/series-analysis";
import type { CompanyDataset, MarketBar, SeriesFrequency, SeriesObservation } from "@/lib/types";

const DEFAULT_METRICS = ["stockPrice", "freeCashFlowPerShare"];
const METRIC_OPTIONS = [
  "stockPrice", "revenue", "grossProfit", "operatingIncome", "netIncome", "operatingCashFlow", "freeCashFlow",
  "revenuePerShare", "netIncomePerShare", "freeCashFlowPerShare", "grossMargin", "operatingMargin", "netMargin",
  "freeCashFlowMargin", "dilutedShares", "sharesOutstanding", "shareRepurchases", "shareIssuance", "dividendsPaid",
];

type TimeRange = "5" | "10" | "20" | "max";
type SeriesBundle = { plan: AutoSeriesPlan; observations: SeriesObservation[]; warning?: string; error?: string };

const seriesId = (ticker: string, metric: string) => `${ticker}:${metric}`;
const today = () => new Date().toISOString().slice(0, 10);
const startForRange = (range: TimeRange, fallback: string) => range === "max" ? fallback : `${Number(today().slice(0, 4)) - Number(range)}${today().slice(4)}`;

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

function formatTick(value: number, family: string, currency = "USD") {
  if (!Number.isFinite(value)) return "—";
  if (family === "percent") return `${(value * 100).toFixed(0)}%`;
  if (family === "indexed") return value.toFixed(0);
  if (family === "currency" || family === "shares") return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  if (family === "perShare" || family === "price") return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  return value.toFixed(1);
}

export function ChartsWorkspace({ initialData, seed }: { initialData: CompanyDataset; seed?: { ticker?: string; metric?: string; nonce: number } }) {
  const [datasets, setDatasets] = useState<Record<string, CompanyDataset>>({ [initialData.company.ticker]: initialData });
  const [companies, setCompanies] = useState([initialData.company.ticker]);
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const [range, setRange] = useState<TimeRange>("max");
  const [frequencyOverrides, setFrequencyOverrides] = useState<Record<string, SeriesFrequency>>({});
  const [indexed, setIndexed] = useState(false);
  const [bars, setBars] = useState<Record<string, MarketBar[]>>({});
  const [seriesErrors, setSeriesErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [showTable, setShowTable] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (!seed) return;
    if (seed.metric) setMetrics((current) => current.includes(seed.metric!) ? current : [...current, seed.metric!]);
    const ticker = seed.ticker;
    if (!ticker) return;
    setCompanies((current) => current.includes(ticker) ? current : [...current, ticker]);
    if (datasets[ticker]) return;
    let active = true;
    setLoading((current) => ({ ...current, [ticker]: true }));
    fetch(`/api/company/${encodeURIComponent(ticker)}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as CompanyDataset & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load company");
      if (active) setDatasets((current) => ({ ...current, [ticker]: payload }));
    }).catch((cause) => active && setSeriesErrors((current) => ({ ...current, [ticker]: cause instanceof Error ? cause.message : "Could not load company" }))).finally(() => active && setLoading((current) => ({ ...current, [ticker]: false })));
    return () => { active = false; };
  }, [seed, datasets]);

  async function addCompany(ticker: string) {
    if (!ticker || companies.includes(ticker)) return;
    setCompanies((current) => [...current, ticker]);
    if (datasets[ticker]) return;
    setLoading((current) => ({ ...current, [ticker]: true }));
    try {
      const response = await fetch(`/api/company/${encodeURIComponent(ticker)}`, { cache: "no-store" });
      const payload = await response.json() as CompanyDataset & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load company");
      setDatasets((current) => ({ ...current, [ticker]: payload }));
      setSeriesErrors((current) => { const next = { ...current }; delete next[ticker]; return next; });
    } catch (cause) {
      setSeriesErrors((current) => ({ ...current, [ticker]: cause instanceof Error ? cause.message : "Could not load company" }));
    } finally { setLoading((current) => ({ ...current, [ticker]: false })); }
  }

  const inputs = useMemo(() => companies.flatMap((ticker) => metrics.map((metric) => ({
    id: seriesId(ticker, metric), ticker, metric, dataset: datasets[ticker], frequency: frequencyOverrides[seriesId(ticker, metric)], indexed,
  }))), [companies, metrics, datasets, frequencyOverrides, indexed]);
  const plan = useMemo(() => createAutoChartPlan(inputs), [inputs]);
  const earliestDate = useMemo(() => Object.values(datasets).flatMap((dataset) => dataset.periods.map((period) => period.periodEnd)).sort()[0] ?? "2000-01-01", [datasets]);
  const startDate = startForRange(range, earliestDate);

  const marketRequests = useMemo(() => plan.filter((item) => item.metric === "stockPrice" || item.metric === "stockTotalReturn").map((item) => `${item.ticker}:${item.frequency}`).sort().join("|"), [plan]);
  useEffect(() => {
    if (!marketRequests) return;
    let active = true;
    for (const request of marketRequests.split("|")) {
      const [ticker, frequency] = request.split(":") as [string, SeriesFrequency];
      const id = `${ticker}:${frequency}`;
      setLoading((current) => ({ ...current, [id]: true }));
      const providerFrequency = providerMarketFrequency(frequency);
      if (!providerFrequency) { setSeriesErrors((current) => ({ ...current, [seriesId(ticker, "stockPrice")]: "Frequency is not supported for market data" })); continue; }
      fetch(`/api/market/${encodeURIComponent(ticker)}?start=${earliestDate}&end=${today()}&frequency=${providerFrequency}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { bars?: MarketBar[]; error?: string };
          if (!response.ok) throw new Error(payload.error || "Could not load stock price");
          if (active) {
            setBars((current) => ({ ...current, [id]: payload.bars ?? [] }));
            setSeriesErrors((current) => { const next = { ...current }; delete next[seriesId(ticker, "stockPrice")]; delete next[seriesId(ticker, "stockTotalReturn")]; return next; });
          }
        })
        .catch((cause) => active && setSeriesErrors((current) => ({ ...current, [seriesId(ticker, "stockPrice")]: cause instanceof Error ? cause.message : "Could not load stock price" })))
        .finally(() => active && setLoading((current) => ({ ...current, [id]: false })));
    }
    return () => { active = false; };
  }, [marketRequests, earliestDate, retryVersion]);

  const bundles = useMemo<SeriesBundle[]>(() => plan.map((item) => {
    const dataset = datasets[item.ticker];
    if (!dataset) return { plan: item, observations: [], error: seriesErrors[item.ticker] || "Company data is loading" };
    let observations = item.metric === "stockPrice" || item.metric === "stockTotalReturn"
      ? marketObservations(bars[`${item.ticker}:${item.frequency}`] ?? [], item.metric, item.frequency)
      : fundamentalObservations(dataset, item.metric, item.frequency, "fiscal-period");
    if (indexed) observations = indexObservationsTo100(observations);
    observations = observations.filter((observation) => observation.date >= startDate && observation.date <= today());
    const validation = validateSeries(observations, item.frequency, dataset.company.resolutionStatus !== "unresolved");
    const requestIsLoading = loading[`${item.ticker}:${item.frequency}`] || loading[item.ticker];
    return {
      plan: item,
      observations: validation.observations,
      warning: validation.reason,
      error: seriesErrors[item.id] || (!validation.valid && !requestIsLoading ? validation.reason : undefined),
    };
  }), [plan, datasets, bars, indexed, startDate, loading, seriesErrors]);

  const validBundles = bundles.filter((bundle) => bundle.observations.length);
  const aligned = useMemo(() => alignMixedSeries(validBundles.map((bundle) => ({ definition: bundle.plan, observations: bundle.observations }))), [validBundles]);
  const rows: Array<Record<string, unknown>> = aligned.map((row) => ({ date: row.date, ...Object.fromEntries(plan.map((item) => [item.id, row.cells[item.id]?.value ?? null])) }));
  const panels = [...new Set(plan.map((item) => item.panel))];

  function reset() {
    setCompanies([initialData.company.ticker]); setMetrics(DEFAULT_METRICS); setRange("max"); setFrequencyOverrides({}); setIndexed(false); setShowTable(false);
  }
  function exportData() {
    const csv = [["company", "ticker", "metric", "date", "frequency", "value", "currency", "unit", "source", "status"]];
    for (const bundle of validBundles) for (const observation of bundle.observations) csv.push([
      datasets[bundle.plan.ticker]?.company.name ?? bundle.plan.ticker, bundle.plan.ticker, METRICS[bundle.plan.metric]?.label ?? bundle.plan.metric,
      observation.date, bundle.plan.frequency, String(observation.value ?? ""), observation.currency, observation.unit, observation.source, observation.status,
    ]);
    downloadCsv("finscope-chart-data.csv", csv);
  }

  return <div className="charts-page">
    <header className="page-heading"><div><h1>Charts</h1><p>Choose companies, metrics and a time range. Frequency, axes and scale are automatic.</p></div></header>
    <section className="chart-controls" aria-label="Chart selections">
      <label>Companies<select value="" onChange={(event) => addCompany(event.target.value)}><option value="">Add company…</option>{DEFAULT_WATCHLIST.filter((company) => !companies.includes(company.ticker) && company.resolutionStatus !== "unresolved").map((company) => <option key={company.ticker} value={company.ticker}>{company.ticker} — {company.name}</option>)}</select></label>
      <label>Metrics<select value="" onChange={(event) => { const metric = event.target.value; if (metric) setMetrics((current) => current.includes(metric) ? current : [...current, metric]); }}><option value="">Add metric…</option>{METRIC_OPTIONS.filter((metric) => !metrics.includes(metric)).map((metric) => <option value={metric} key={metric}>{METRICS[metric].label}</option>)}</select></label>
      <label>Time range<select value={range} onChange={(event) => setRange(event.target.value as TimeRange)}><option value="5">5 years</option><option value="10">10 years</option><option value="20">20 years</option><option value="max">Max</option></select></label>
    </section>
    <div className="chart-actions">
      <button onClick={reset}>Reset</button><button onClick={exportData} disabled={!validBundles.length}>Export</button><button onClick={() => setShowTable((value) => !value)}>{showTable ? "Hide data table" : "Show data table"}</button>
    </div>
    <section className="series-list" aria-label="Selected series">{plan.map((item) => {
      const bundle = bundles.find((entry) => entry.plan.id === item.id); const analysis = bundle?.observations.length ? analyzeVisibleSeries(bundle.observations, item.family === "percent" ? "margin" : "cagr") : null;
      return <div key={item.id} className="series-item"><i style={{ background: item.color }}/><span><b>{item.ticker} · {METRICS[item.metric]?.label}</b><small>{frequencyLabel(item.frequency)} · {item.family}{analysis && item.showCagr ? ` · ${formatVisibleAnalysis(analysis)}` : ""}</small>{bundle?.warning && !bundle.error ? <small className="warning-text">{bundle.warning}</small> : null}{bundle?.error ? <small className="error-text">{bundle.error}. Other series remain available.</small> : null}</span>{bundle?.error && <button onClick={() => setRetryVersion((value) => value + 1)}>Retry</button>}<button aria-label={`Remove ${item.ticker} ${METRICS[item.metric]?.label}`} onClick={() => {
        const sameMetric = companies.length === 1; if (sameMetric) setMetrics((current) => current.filter((metric) => metric !== item.metric)); else setCompanies((current) => current.filter((ticker) => ticker !== item.ticker));
      }}>Remove</button></div>;
    })}</section>
    {!validBundles.length && <p className="simple-state">{Object.values(loading).some(Boolean) ? "Loading…" : "No data available"}</p>}
    {validBundles.length > 0 && <section className="chart-stack" aria-label="Financial chart">
      {panels.map((panel) => <ChartPanel key={panel} panel={panel} plan={plan.filter((item) => item.panel === panel)} rows={rows}/>)}</section>}
    <details className="advanced-panel"><summary>Advanced</summary><label><input type="checkbox" checked={indexed} onChange={(event) => setIndexed(event.target.checked)}/> Index every series to 100</label>{plan.map((item) => <label key={item.id}>{item.ticker} · {METRICS[item.metric]?.short}<select value={item.frequency} onChange={(event) => setFrequencyOverrides((current) => ({ ...current, [item.id]: event.target.value as SeriesFrequency }))}>{frequencyOptions(item.metric).map((frequency) => <option value={frequency} key={frequency}>{frequencyLabel(frequency)}</option>)}</select></label>)}</details>
    {showTable && <section className="plain-section"><h2>Data table</h2><div className="table-scroll"><table><thead><tr><th>Date</th>{plan.map((item) => <th key={item.id}>{item.ticker}<small>{METRICS[item.metric]?.short}</small></th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.date as string}><th>{row.date as string}</th>{plan.map((item) => <td key={item.id}>{typeof row[item.id] === "number" ? formatTick(row[item.id] as number, item.family, datasets[item.ticker]?.company.currency) : "—"}</td>)}</tr>)}</tbody></table></div></section>}
  </div>;
}

function ChartPanel({ panel, plan, rows }: { panel: number; plan: AutoSeriesPlan[]; rows: Array<Record<string, unknown>> }) {
  const hasRight = plan.some((item) => item.axis === "right");
  const leftPlan = plan.filter((item) => item.axis === "left"); const rightPlan = plan.filter((item) => item.axis === "right");
  const values = (items: AutoSeriesPlan[]) => rows.flatMap((row) => items.map((item) => typeof row[item.id] === "number" ? row[item.id] as number : null));
  const leftDomain = automaticDomain(values(leftPlan), leftPlan.some((item) => item.scale === "auto") ? { scale: "auto" } : { scale: "zero" });
  const rightDomain = automaticDomain(values(rightPlan), rightPlan.some((item) => item.scale === "auto") ? { scale: "auto" } : { scale: "zero" });
  const leftFamily = leftPlan[0]?.family ?? "ratio"; const rightFamily = rightPlan[0]?.family ?? "ratio";
  return <div className="chart-panel"><div className="chart-panel-label">{plan.length === 1 ? `${plan[0].ticker} · ${METRICS[plan[0].metric]?.label}` : `Panel ${panel + 1} · ${[...new Set(plan.map((item) => item.family))].join(" / ")}`}</div><div className="chart-canvas"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} syncId="finscope-charts" margin={{ top: 8, right: hasRight ? 18 : 8, bottom: 4, left: 8 }}><CartesianGrid vertical={false} stroke="#e5e7eb"/><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(0, 7)} minTickGap={36}/><YAxis yAxisId="left" domain={leftDomain} tickFormatter={(value) => formatTick(value, leftFamily)}/>{hasRight && <YAxis yAxisId="right" orientation="right" domain={rightDomain} tickFormatter={(value) => formatTick(value, rightFamily)}/>}<ReferenceLine yAxisId="left" y={0} stroke="#9ca3af"/><Tooltip contentStyle={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 0 }} labelFormatter={(label) => String(label)} formatter={(value, name) => {
    const item = plan.find((entry) => entry.id === name); return [item ? formatTick(Number(value), item.family) : String(value), item ? `${item.ticker} · ${METRICS[item.metric]?.short}` : String(name)];
  }}/>{plan.map((item) => item.type === "bar" ? <Bar key={item.id} dataKey={item.id} yAxisId={item.axis} fill={item.color} isAnimationActive={false}/> : <Line key={item.id} dataKey={item.id} yAxisId={item.axis} stroke={item.color} strokeWidth={2} dot={false} connectNulls={false} type="linear" isAnimationActive={false}/>)}</ComposedChart></ResponsiveContainer></div></div>;
}
