"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { readParsed } from "@/lib/fetch-json";
import {
  EUROSTAT_SERIES,
  MACRO_COUNTRIES,
  eurostatUrls,
  macroDefinitionsFor,
  parseEurostatObservation,
  type MacroCountry,
  type MacroHistory,
  type MacroIndicator,
  type MacroObservation,
} from "@/lib/macro";

interface MacroAnswer {
  country?: { code: string; name: string };
  indicators?: MacroIndicator[];
  error?: string;
}

type HistoryRange = "1Y" | "5Y" | "10Y" | "MAX";
const HISTORY_RANGES: HistoryRange[] = ["1Y", "5Y", "10Y", "MAX"];
const COMPARABLE_SERIES = new Set(["inflation", "gdp-growth", "unemployment", "current-account", "oecd-cli"]);
const MAX_COMPARED_COUNTRIES = 5;

function valueOf(indicator: Pick<MacroIndicator, "value" | "unit" | "decimals">) {
  if (indicator.value == null || !Number.isFinite(indicator.value)) return "—";
  const sign = indicator.unit === "percentage-points" && indicator.value > 0 ? "+" : "";
  const suffix = indicator.unit === "index" ? "" : indicator.unit === "percentage-points" ? " pp" : "%";
  return `${sign}${indicator.value.toFixed(indicator.decimals)}${suffix}`;
}

function periodOf(date: string | null, frequency: MacroIndicator["frequency"]) {
  if (!date) return "Observation unavailable";
  if (frequency === "Annual") return date;
  if (frequency === "Quarterly") return date.replace("-Q", " Q");
  if (frequency === "Monthly" && /^\d{4}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}-01T12:00:00Z`);
    return parsed.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function axisValue(value: number, decimals: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

const SERIES_DASHES = ["", "8 4", "2 3", "11 3 2 3", "1 5"];

function linePath(
  dates: string[],
  observations: Map<string, number>,
  x: (index: number) => number,
  y: (value: number) => number,
) {
  let drawing = false;
  return dates.map((date, index) => {
    const value = observations.get(date);
    if (value == null) { drawing = false; return ""; }
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${command}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
  }).join("");
}

function MacroHistoryChart({ histories }: { histories: MacroHistory[] }) {
  const svg = useRef<SVGSVGElement | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const history = histories[0];
  const dates = useMemo(() => [...new Set(histories.flatMap((item) => item.observations.map((point) => point.date)))].sort(), [histories]);
  const observations = useMemo(() => histories.map((item) => new Map(item.observations.map((point) => [point.date, point.value]))), [histories]);
  const bar = histories.length === 1 && (history.indicator.id === "inflation" || history.indicator.id === "gdp-growth" || history.indicator.id === "current-account");
  const width = 960, height = 310, left = 54, right = 18, top = 18, bottom = 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = histories.flatMap((item) => item.observations.map((point) => point.value));
  const rawMin = Math.min(...values), rawMax = Math.max(...values);
  const min = bar ? Math.min(0, rawMin) : rawMin;
  const max = bar ? Math.max(0, rawMax) : rawMax;
  const pad = (max - min) * 0.08 || 1;
  const floor = min - (bar && min === 0 ? 0 : pad), ceiling = max + pad;
  const x = (index: number) => left + (index + 0.5) / Math.max(dates.length, 1) * plotWidth;
  const y = (value: number) => top + (ceiling - value) / Math.max(ceiling - floor, 1) * plotHeight;
  const zero = y(0);
  const tickValues = Array.from({ length: 5 }, (_, index) => floor + (ceiling - floor) * index / 4).reverse();
  const labelIndexes = useMemo(() => {
    if (dates.length <= 6) return dates.map((_, index) => index);
    return Array.from({ length: 6 }, (_, index) => Math.round(index * (dates.length - 1) / 5));
  }, [dates]);
  const activeIndex = hovered ?? dates.length - 1;
  const activeDate = dates[activeIndex];
  const updateHover = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = svg.current?.getBoundingClientRect();
    if (!bounds || !dates.length) return;
    const local = (event.clientX - bounds.left) / bounds.width * width;
    const index = Math.round((local - left) / plotWidth * dates.length - 0.5);
    setHovered(Math.max(0, Math.min(dates.length - 1, index)));
  };

  if (!dates.length) return null;
  return <div className="macro-history-plot">
    <div className="macro-chart-legend" aria-label="Compared countries">
      {histories.map((item, index) => <div key={item.country.code}>
        <i style={{ borderTopStyle: index === 0 ? "solid" : index % 2 ? "dashed" : "dotted" }}/>
        <span>{item.country.name}</span>
        <strong>{valueOf({ value: item.observations.at(-1)?.value ?? null, unit: item.indicator.unit, decimals: item.indicator.decimals })}</strong>
        <small>{item.indicator.source}</small>
      </div>)}
    </div>
    <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${history.indicator.label} for ${histories.map((item) => item.country.name).join(", ")}.`}
      onPointerMove={updateHover} onPointerLeave={() => setHovered(null)}>
      {tickValues.map((tick) => <g key={tick}>
        <line className="macro-chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)}/>
        <text className="macro-chart-axis" x={left - 9} y={y(tick) + 3} textAnchor="end">{axisValue(tick, history.indicator.decimals)}</text>
      </g>)}
      {bar && floor < 0 && ceiling > 0 && <line className="macro-chart-zero" x1={left} x2={width - right} y1={zero} y2={zero}/>}
      {bar ? history.observations.map((point, index) => {
        const column = plotWidth / Math.max(dates.length, 1);
        const barWidth = Math.max(1, column * 0.72);
        const pointY = y(point.value);
        return <rect className={`macro-chart-bar${index === activeIndex ? " active" : ""}`} key={point.date}
          x={x(index) - barWidth / 2} y={Math.min(pointY, zero)} width={barWidth} height={Math.max(1, Math.abs(zero - pointY))}/>;
      }) : histories.map((item, index) => <path className="macro-chart-line" data-series={index} key={item.country.code}
        d={linePath(dates, observations[index], x, y)} strokeDasharray={SERIES_DASHES[index]}/>) }
      {activeDate && <g className="macro-chart-active">
        <line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={height - bottom}/>
        {observations.map((series, index) => {
          const value = series.get(activeDate);
          return value == null ? null : <circle data-series={index} key={histories[index].country.code} cx={x(activeIndex)} cy={y(value)} r={3}/>;
        })}
      </g>}
      {labelIndexes.map((index) => <text className="macro-chart-axis" key={dates[index]}
        x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === dates.length - 1 ? "end" : "middle"}>
        {periodOf(dates[index], history.indicator.frequency)}
      </text>)}
    </svg>
    {activeDate && <div className="macro-history-tooltip" aria-live="polite">
      <b>{periodOf(activeDate, history.indicator.frequency)}</b>
      {histories.map((item, index) => <span key={item.country.code}>
        <i style={{ borderTopStyle: index === 0 ? "solid" : index % 2 ? "dashed" : "dotted" }}/>
        <span>{item.country.name}</span>
        <strong>{valueOf({ value: observations[index].get(activeDate) ?? null, unit: item.indicator.unit, decimals: item.indicator.decimals })}</strong>
      </span>)}
    </div>}
  </div>;
}

function changeOf(points: MacroObservation[], indicator: MacroHistory["indicator"]) {
  const current = points.at(-1)?.value;
  const previous = points.at(-2)?.value;
  if (current == null || previous == null) return "—";
  const change = current - previous;
  const suffix = indicator.unit === "index" ? "" : " pp";
  return `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(indicator.decimals)}${suffix}`;
}

async function readEurostatDirect(country: MacroCountry, signal: AbortSignal) {
  if (!country.eurostat) return [];
  const results = await Promise.all(EUROSTAT_SERIES.map(async ({ definition, dataset, parameters }): Promise<MacroIndicator | null> => {
    const urls = eurostatUrls(dataset, country.eurostat as string, parameters, definition.frequency);
    try {
      const response = await fetch(urls.api, { headers: { Accept: "application/json" }, signal });
      if (!response.ok) return null;
      const observation = parseEurostatObservation(await response.json());
      return observation ? {
        ...definition,
        ...observation,
        source: "Eurostat",
        sourceUrl: urls.source,
      } satisfies MacroIndicator : null;
    } catch {
      return null;
    }
  }));
  return results.filter((indicator): indicator is MacroIndicator => indicator !== null);
}

function mergeEurostat(answer: MacroAnswer | null, country: MacroCountry, eurostat: MacroIndicator[]): MacroAnswer {
  if (!eurostat.length) return answer ?? { error: "Macro data is unavailable." };
  const base = answer?.indicators ?? [];
  const indicators = macroDefinitionsFor(country.code).flatMap((definition) =>
    eurostat.find((indicator) => indicator.id === definition.id)
    ?? base.find((indicator) => indicator.id === definition.id)
    ?? [],
  );
  return { ...answer, country: { code: country.code, name: country.name }, indicators, error: undefined };
}

export function MacroSnapshot() {
  const [countryCode, setCountryCode] = useState("US");
  const [answers, setAnswers] = useState<Record<string, MacroAnswer>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("10Y");
  const [histories, setHistories] = useState<Record<string, MacroHistory>>({});
  const [historyError, setHistoryError] = useState("");
  const [comparisonCountries, setComparisonCountries] = useState<string[]>([]);
  const [comparisonErrors, setComparisonErrors] = useState<Record<string, string>>({});
  const answer = answers[countryCode];
  const country = MACRO_COUNTRIES.find((candidate) => candidate.code === countryCode) ?? MACRO_COUNTRIES[0];

  useEffect(() => {
    if (answers[countryCode]) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const [response, eurostat] = await Promise.all([
          fetch(`/api/macro?country=${encodeURIComponent(countryCode)}`, { signal: controller.signal }),
          readEurostatDirect(country, controller.signal),
        ]);
        const parsed = await readParsed<MacroAnswer>(response, { what: `${country.name}'s macro backdrop` });
        if (!controller.signal.aborted) {
          setAnswers((current) => ({
            ...current,
            [countryCode]: mergeEurostat(parsed.data, country, eurostat),
          }));
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setAnswers((current) => ({ ...current, [countryCode]: { error: cause instanceof Error ? cause.message : "Macro data is unavailable." } }));
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [answers, country, countryCode]);

  useEffect(() => {
    if (!selected) return;
    const key = `${countryCode}:${selected}:${historyRange}`;
    if (histories[key]) return;
    const controller = new AbortController();
    setHistoryError("");
    const load = async () => {
      try {
        const response = await fetch(`/api/macro/history?country=${encodeURIComponent(countryCode)}&series=${encodeURIComponent(selected)}&range=${historyRange}`, { signal: controller.signal });
        const parsed = await readParsed<MacroHistory>(response, { what: `${country.name}'s historical macro data` });
        if (parsed.error) throw new Error(parsed.error);
        if (!parsed.data) throw new Error("Historical macro data is unavailable.");
        if (!controller.signal.aborted) setHistories((current) => ({ ...current, [key]: parsed.data as MacroHistory }));
      } catch (cause) {
        if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : "Historical macro data is unavailable.");
      }
    };
    void load();
    return () => controller.abort();
  }, [country.name, countryCode, histories, historyRange, selected]);

  useEffect(() => {
    if (!selected || comparisonCountries.length === 0) return;
    const missing = comparisonCountries.filter((code) => {
      const key = `${code}:${selected}:${historyRange}`;
      return !histories[key] && !comparisonErrors[key];
    });
    if (!missing.length) return;
    const controller = new AbortController();
    const load = async () => {
      const results = await Promise.all(missing.map(async (code) => {
        const option = MACRO_COUNTRIES.find((candidate) => candidate.code === code);
        const key = `${code}:${selected}:${historyRange}`;
        try {
          const response = await fetch(`/api/macro/history?country=${encodeURIComponent(code)}&series=${encodeURIComponent(selected)}&range=${historyRange}`, { signal: controller.signal });
          const parsed = await readParsed<MacroHistory>(response, { what: `${option?.name ?? code}'s historical macro data` });
          if (parsed.error) throw new Error(parsed.error);
          if (!parsed.data) throw new Error("Historical macro data is unavailable.");
          return { key, data: parsed.data, error: "" };
        } catch (cause) {
          return { key, data: null, error: cause instanceof Error ? cause.message : "Historical macro data is unavailable." };
        }
      }));
      if (controller.signal.aborted) return;
      setHistories((current) => ({
        ...current,
        ...Object.fromEntries(results.flatMap((result) => result.data ? [[result.key, result.data]] : [])),
      }));
      setComparisonErrors((current) => ({
        ...current,
        ...Object.fromEntries(results.flatMap((result) => result.error ? [[result.key, result.error]] : [])),
      }));
    };
    void load();
    return () => controller.abort();
  }, [comparisonCountries, comparisonErrors, histories, historyRange, selected]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const indicators = answer?.indicators ?? macroDefinitionsFor(countryCode).map((definition) => ({
    ...definition,
    value: null,
    date: null,
    source: "",
    sourceUrl: "",
  }));
  const historyKey = selected ? `${countryCode}:${selected}:${historyRange}` : "";
  const history = histories[historyKey];
  const selectedIndicator = indicators.find((indicator) => indicator.id === selected);
  const historyLatest = history?.observations.at(-1);
  const comparisonOptions = selected && COMPARABLE_SERIES.has(selected)
    ? MACRO_COUNTRIES.filter((option) => option.code !== countryCode && macroDefinitionsFor(option.code).some((definition) => definition.id === selected))
    : [];
  const requestedComparisonHistories = selected ? comparisonCountries.flatMap((code) => {
    const candidate = histories[`${code}:${selected}:${historyRange}`];
    return candidate ? [candidate] : [];
  }) : [];
  const chartHistories = history
    ? [history, ...requestedComparisonHistories.filter((candidate) => candidate.indicator.frequency === history.indicator.frequency)]
    : [];
  const incompatibleCountries = history
    ? requestedComparisonHistories.filter((candidate) => candidate.indicator.frequency !== history.indicator.frequency).map((candidate) => candidate.country.name)
    : [];
  const comparisonLoading = selected && comparisonCountries.some((code) => {
    const key = `${code}:${selected}:${historyRange}`;
    return !histories[key] && !comparisonErrors[key];
  });
  const comparisonFailures = selected ? comparisonCountries.flatMap((code) => {
    const key = `${code}:${selected}:${historyRange}`;
    return comparisonErrors[key] ? [MACRO_COUNTRIES.find((option) => option.code === code)?.name ?? code] : [];
  }) : [];

  const toggleComparison = (code: string) => {
    setComparisonCountries((current) => current.includes(code)
      ? current.filter((candidate) => candidate !== code)
      : current.length < MAX_COMPARED_COUNTRIES - 1 ? [...current, code] : current);
  };

  return (
    <section className="section macro-section" aria-labelledby="macro-heading">
      <div className="section-head">
        <h2 className="label" id="macro-heading">Macro</h2>
        <span className="label">{country.name} · latest available data</span>
      </div>
      <div className="macro-countries" role="group" aria-label="Select a macro geography">
        {MACRO_COUNTRIES.map((option) => (
          <button
            className={`macro-country${option.code === countryCode ? " active" : ""}`}
            type="button"
            aria-pressed={option.code === countryCode}
            onClick={() => { setCountryCode(option.code); setSelected(null); setComparisonCountries([]); setHistoryError(""); }}
            key={option.code}
          >
            {option.name}
          </button>
        ))}
      </div>
      {answer?.error && <p className="notice">{answer.error}</p>}
      {selectedIndicator && <article className="macro-history-panel">
        <header className="macro-history-head">
          <div>
            <span className="label">{country.name} · {history?.indicator.frequency ?? selectedIndicator.frequency}</span>
            <h3>{selectedIndicator.label}</h3>
            <p>{history?.indicator.note ?? selectedIndicator.note}</p>
          </div>
          <button className="macro-history-close" type="button" aria-label="Close historical chart" onClick={() => setSelected(null)}>×</button>
        </header>
        <div className="macro-history-summary">
          <div><span className="label">Latest</span><strong>{historyLatest ? valueOf({ ...selectedIndicator, value: historyLatest.value, unit: history?.indicator.unit ?? selectedIndicator.unit, decimals: history?.indicator.decimals ?? selectedIndicator.decimals }) : valueOf(selectedIndicator)}</strong><small>{periodOf(historyLatest?.date ?? selectedIndicator.date, history?.indicator.frequency ?? selectedIndicator.frequency)}</small></div>
          <div><span className="label">Previous</span><strong>{history?.observations.at(-2) ? valueOf({ ...selectedIndicator, value: history.observations.at(-2)?.value ?? null }) : "—"}</strong></div>
          <div><span className="label">Change</span><strong>{history ? changeOf(history.observations, history.indicator) : "—"}</strong></div>
          <div><span className="label">Observations</span><strong>{history?.observations.length.toLocaleString("en-US") ?? "—"}</strong></div>
        </div>
        <div className="macro-history-tools">
          <div className="segmented" role="group" aria-label="Historical range">
            {HISTORY_RANGES.map((range) => <button className={range === historyRange ? "active" : ""} type="button"
              aria-pressed={range === historyRange} key={range} onClick={() => setHistoryRange(range)}>{range === "MAX" ? "Max" : range}</button>)}
          </div>
          <span className="label">{history?.indicator.source ?? selectedIndicator.source} · {history?.indicator.frequency ?? selectedIndicator.frequency}</span>
        </div>
        {comparisonOptions.length > 0 && <div className="macro-country-compare">
          <div className="macro-country-compare-head">
            <span className="label">Compare countries</span>
            <small>{comparisonCountries.length + 1} / {MAX_COMPARED_COUNTRIES}</small>
          </div>
          <div role="group" aria-label={`Compare countries for ${selectedIndicator.label}`}>
            <button className="active locked" type="button" aria-pressed="true" disabled>{country.name}</button>
            {comparisonOptions.map((option) => {
              const active = comparisonCountries.includes(option.code);
              const full = comparisonCountries.length >= MAX_COMPARED_COUNTRIES - 1;
              return <button className={active ? "active" : ""} type="button" aria-pressed={active}
                disabled={!active && full} onClick={() => toggleComparison(option.code)} key={option.code}>{option.name}</button>;
            })}
          </div>
        </div>}
        {!history && !historyError && <div className="macro-history-loading" role="status">Loading historical observations…</div>}
        {historyError && <p className="notice">{historyError}</p>}
        {comparisonLoading && <p className="macro-comparison-status" role="status">Loading comparison…</p>}
        {comparisonFailures.length > 0 && <p className="macro-comparison-status">Unavailable: {comparisonFailures.join(", ")}.</p>}
        {incompatibleCountries.length > 0 && <p className="macro-comparison-status">Different publication frequency, not overlaid: {incompatibleCountries.join(", ")}.</p>}
        {chartHistories.length > 0 && <MacroHistoryChart histories={chartHistories}/>}
        <footer className="macro-history-foot">
          <span>Published observations only · no interpolation</span>
          {(history?.indicator.sourceUrl || selectedIndicator.sourceUrl) && <a href={history?.indicator.sourceUrl || selectedIndicator.sourceUrl} target="_blank" rel="noreferrer">Open official source ↗</a>}
        </footer>
      </article>}
      <div className="grid-ruled macro-grid" aria-busy={answer == null}>
        {indicators.map((indicator) => (
          <article className={`macro-card${selected === indicator.id ? " active" : ""}`} key={indicator.id}>
            <button className="macro-card-open" type="button" aria-expanded={selected === indicator.id}
              aria-label={`Open ${indicator.label} history`} onClick={() => { setSelected(indicator.id); setComparisonCountries([]); setHistoryError(""); }}>
              <span className="label">{indicator.label}</span>
              <strong data-empty={indicator.value == null}>{answer == null ? "···" : valueOf(indicator)}</strong>
              <small>{indicator.note}</small>
              <span className="macro-card-action">View history ↗</span>
            </button>
            <div className="macro-card-meta">
              {indicator.sourceUrl ? <a href={indicator.sourceUrl} target="_blank" rel="noreferrer">{indicator.source}</a> : <span>Official release</span>}
              <time dateTime={indicator.date ?? undefined}>{indicator.frequency} · {periodOf(indicator.date, indicator.frequency)}</time>
            </div>
          </article>
        ))}
      </div>
      <p className="macro-foot">Select any indicator for its history. Inflation and unemployment are monthly where the official source publishes them; GDP remains quarterly. No missing period is estimated.</p>
    </section>
  );
}
