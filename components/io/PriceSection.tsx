"use client";

import { useEffect, useMemo, useState } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { Figure, type PricePoint } from "./Plot";
import { fundamentalWindow, priceWindow, RANGES, shapeFor, withinYears, type Frequency, type Range } from "./ranges";
import { ABSENT, datedCagrOf, delta, formatUnit, price as writePrice, shortDate, type Unit } from "./format";

/**
 * The chart the page is built around, and the one control that drives it.
 *
 * It shows the share price until the reader picks a measure below, and then it
 * shows that measure. Both halves read the same range, so choosing MAX at the
 * top moves everything on the screen at once rather than leaving the figures
 * underneath on a window of their own.
 */

interface Bar { date: string; close: number }
interface Answer { key: string; bars: Bar[] | null }

export function PriceSection({
  ticker,
  currency,
  view,
  metricKey,
  onClearMetric,
  range,
  onRange,
  frequency,
  onFrequency,
}: {
  ticker: string;
  currency: string;
  view: IoCompanyView;
  metricKey: string | null;
  onClearMetric: () => void;
  range: Range;
  onRange: (range: Range) => void;
  frequency: Frequency;
  onFrequency: (frequency: Frequency) => void;
}) {
  return metricKey
    ? (
      <MetricSection
        key={metricKey}
        view={view}
        metricKey={metricKey}
        onClear={onClearMetric}
        range={range}
        onRange={onRange}
        frequency={frequency}
        onFrequency={onFrequency}
      />
    )
    : <MarketPriceSection ticker={ticker} currency={currency} range={range} onRange={onRange} />;
}

function RangePicker({ range, onRange }: { range: Range; onRange: (range: Range) => void }) {
  return (
    <div className="seg">
      {RANGES.map((entry) => (
        <button key={entry} type="button" aria-pressed={range === entry} onClick={() => onRange(entry)}>
          {entry}
        </button>
      ))}
    </div>
  );
}

function MarketPriceSection({
  ticker,
  currency,
  range,
  onRange,
}: {
  ticker: string;
  currency: string;
  range: Range;
  onRange: (range: Range) => void;
}) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const key = `${ticker}|${range}`;
  const current = answer?.key === key ? answer : null;
  const failed = current != null && current.bars == null;

  useEffect(() => {
    const controller = new AbortController();
    const { frequency, start, end } = priceWindow(range);
    (async () => {
      try {
        const response = await fetch(`/api/market/${encodeURIComponent(ticker)}?frequency=${frequency}&start=${start}&end=${end}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { bars: Array<{ date: string; close: number | null }> };
        setAnswer({ key: `${ticker}|${range}`, bars: body.bars.filter((bar): bar is Bar => bar.close != null && Number.isFinite(bar.close)) });
      } catch {
        if (!controller.signal.aborted) setAnswer({ key: `${ticker}|${range}`, bars: null });
      }
    })();
    return () => controller.abort();
  }, [ticker, range]);

  const points = useMemo<PricePoint[]>(() => (current?.bars ?? []).map((bar) => ({ date: bar.date, value: bar.close })), [current]);
  const first = points[0]?.value ?? null;
  const last = points.at(-1)?.value ?? null;
  const move = first != null && last != null && first > 0 ? last / first - 1 : null;
  const cagr = range === "5Y" || range === "MAX" ? datedCagrOf(points) : null;
  const active = hover == null ? points.at(-1) ?? null : points[hover] ?? null;
  const bounds = useMemo(() => {
    if (!points.length) return null;
    const values = points.map((point) => point.value);
    return { high: Math.max(...values), low: Math.min(...values) };
  }, [points]);

  return (
    <section className="section" style={{ borderTop: 0 }}>
      <div className="section-head">
        <div className="readout">
          <span className="v">{active ? writePrice(active.value, currency) : ABSENT}</span>
          <span className="d">{active ? shortDate(active.date) : range}</span>
          {move != null ? <span className="readout-change">{delta(move)} {range}</span> : null}
          {cagr != null ? <span className="readout-cagr">{delta(cagr)} CAGR</span> : null}
        </div>
        <RangePicker range={range} onRange={onRange} />
      </div>

      {points.length > 1 ? (
        <ChartFrame points={points} shape="area" bounds={bounds} onHover={setHover} write={(value) => writePrice(value, currency)} />
      ) : failed ? (
        <p className="price-chart plot-empty num faint">No session data for this symbol.</p>
      ) : (
        <div className="price-chart skeleton" />
      )}
    </section>
  );
}

const FREQUENCIES: Array<{ id: Frequency; label: string }> = [
  { id: "ttm", label: "TTM" },
  { id: "annual", label: "Yearly" },
];

function MetricSection({
  view,
  metricKey,
  onClear,
  range,
  onRange,
  frequency,
  onFrequency,
}: {
  view: IoCompanyView;
  metricKey: string;
  onClear: () => void;
  range: Range;
  onRange: (range: Range) => void;
  frequency: Frequency;
  onFrequency: (frequency: Frequency) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const metric = view.metrics.find((item) => item.key === metricKey) ?? null;

  const periods = useMemo<IoPeriod[]>(() => {
    const series = frequency === "annual" ? view.annual : view.trailing;
    return withinYears(series, fundamentalWindow(range).years);
  }, [view.annual, view.trailing, frequency, range]);

  const points = useMemo<PricePoint[]>(() => metric
    ? periods.flatMap((period) => {
        const value = period.values[metric.key];
        return value == null || !Number.isFinite(value) ? [] : [{ date: period.end, value }];
      })
    : [], [periods, metric]);

  const active = hover == null ? points.at(-1) ?? null : points[hover] ?? null;
  const growth = metric?.unit === "percent"
    ? points.length > 1 ? points.at(-1)!.value - points[0].value : null
    : datedCagrOf(points);
  const bounds = useMemo(() => {
    if (!points.length) return null;
    const values = points.map((point) => point.value);
    return { high: Math.max(...values), low: Math.min(...values) };
  }, [points]);
  const currency = periods.at(-1)?.currency ?? view.company.currency;
  const write = (value: number) => metric ? formatUnit(value, metric.unit as Unit, currency) : ABSENT;

  if (!metric) return null;

  return (
    <section className="section metric-feature" style={{ borderTop: 0 }}>
      <div className="metric-feature-title">
        <button className="metric-clear" type="button" onClick={onClear}>× Back to price</button>
        <span className="label">{metric.label}</span>
        <div className="seg seg-frequency">
          {FREQUENCIES.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={frequency === entry.id} onClick={() => { onFrequency(entry.id); setHover(null); }}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <div className="section-head">
        <div className="readout">
          <span className="v">{active ? write(active.value) : ABSENT}</span>
          <span className="d">{active ? shortDate(active.date) : range}</span>
          {growth != null ? <span className="readout-cagr">{delta(growth)} {metric.unit === "percent" ? "change" : "CAGR"}</span> : null}
        </div>
        <RangePicker range={range} onRange={onRange} />
      </div>
      {points.length > 1 ? (
        <ChartFrame points={points} shape={shapeFor(metric.unit)} bounds={bounds} onHover={setHover} write={write} />
      ) : (
        <p className="price-chart plot-empty num faint">
          {frequency === "annual" ? "Not enough annual history for this measure." : "Not enough TTM history for this measure."}
        </p>
      )}
    </section>
  );
}

function ChartFrame({
  points,
  shape,
  bounds,
  onHover,
  write,
}: {
  points: PricePoint[];
  shape: "area" | "bars";
  bounds: { high: number; low: number } | null;
  onHover: (index: number | null) => void;
  write: (value: number) => string;
}) {
  return (
    <div className="price-frame">
      <Figure points={points} shape={shape} onHover={onHover} />
      {bounds ? (
        <div className="plot-axis">
          <span className="plot-tag" style={{ right: 0, top: 0 }}>{write(bounds.high)}</span>
          <span className="plot-tag" style={{ right: 0, bottom: 0 }}>{write(bounds.low)}</span>
          <span className="plot-tag plot-tag-under" style={{ left: 0 }}>{shortDate(points[0].date)}</span>
          <span className="plot-tag plot-tag-under" style={{ right: 0 }}>{shortDate(points.at(-1)!.date)}</span>
        </div>
      ) : null}
    </div>
  );
}
