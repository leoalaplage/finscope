"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { PriceLine, type PricePoint } from "./Plot";
import { ABSENT, datedCagrOf, delta, formatUnit, price as writePrice, shortDate, type Unit } from "./format";

type PriceRange = "1M" | "6M" | "1Y" | "5Y" | "MAX";
type MetricRange = "1Y" | "3Y" | "5Y" | "MAX";

const PRICE_RANGES: Array<{ id: PriceRange; frequency: "daily" | "weekly" | "monthly"; days: number | null }> = [
  { id: "1M", frequency: "daily", days: 35 },
  { id: "6M", frequency: "daily", days: 190 },
  { id: "1Y", frequency: "daily", days: 370 },
  { id: "5Y", frequency: "weekly", days: 1830 },
  { id: "MAX", frequency: "monthly", days: null },
];

const METRIC_RANGES: Array<{ id: MetricRange; years: number | null }> = [
  { id: "1Y", years: 1 }, { id: "3Y", years: 3 }, { id: "5Y", years: 5 }, { id: "MAX", years: null },
];

interface Bar { date: string; close: number }
interface Answer { key: string; bars: Bar[] | null }

function priceWindow(range: PriceRange) {
  const found = PRICE_RANGES.find((entry) => entry.id === range) ?? PRICE_RANGES[2];
  const end = new Date();
  const start = found.days == null ? new Date("1985-01-01") : new Date(end.getTime() - found.days * 86_400_000);
  return { frequency: found.frequency, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function periodWindow(periods: IoPeriod[], years: number | null) {
  if (years == null || periods.length === 0) return periods;
  const cutoff = new Date(`${periods.at(-1)!.end}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  const threshold = cutoff.toISOString().slice(0, 10);
  return periods.filter((period) => period.end >= threshold);
}

export function PriceSection({
  ticker,
  currency,
  view,
  metricKey,
  onClearMetric,
}: {
  ticker: string;
  currency: string;
  view: IoCompanyView;
  metricKey: string | null;
  onClearMetric: () => void;
}) {
  return metricKey
    ? <MetricSection key={metricKey} view={view} metricKey={metricKey} onClear={onClearMetric} />
    : <MarketPriceSection ticker={ticker} currency={currency} />;
}

function MarketPriceSection({ ticker, currency }: { ticker: string; currency: string }) {
  const [range, setRange] = useState<PriceRange>("1Y");
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
        <div className="seg">
          {PRICE_RANGES.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={range === entry.id} onClick={() => { setRange(entry.id); setHover(null); }}>
              {entry.id}
            </button>
          ))}
        </div>
      </div>

      {points.length > 1 ? (
        <ChartFrame points={points} bounds={bounds} onHover={setHover} write={(value) => writePrice(value, currency)} />
      ) : failed ? (
        <p className="price-chart plot-empty num faint">No session data for this symbol.</p>
      ) : (
        <div className="price-chart skeleton" />
      )}
    </section>
  );
}

function MetricSection({ view, metricKey, onClear }: { view: IoCompanyView; metricKey: string; onClear: () => void }) {
  const [range, setRange] = useState<MetricRange>("5Y");
  const [hover, setHover] = useState<number | null>(null);
  const metric = view.metrics.find((item) => item.key === metricKey) ?? null;

  const periods = useMemo(() => periodWindow(view.trailing, METRIC_RANGES.find((item) => item.id === range)?.years ?? null), [view.trailing, range]);
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
    <section className="section metric-feature" style={{ borderTop: 0, "--metric": metric.color } as CSSProperties}>
      <div className="metric-feature-title">
        <button className="metric-clear" type="button" onClick={onClear}>× Back to price</button>
        <span className="label">{metric.label} · TTM</span>
      </div>
      <div className="section-head">
        <div className="readout">
          <span className="v">{active ? write(active.value) : ABSENT}</span>
          <span className="d">{active ? shortDate(active.date) : range}</span>
          {growth != null ? <span className="readout-cagr">{delta(growth)} {metric.unit === "percent" ? "change" : "CAGR"}</span> : null}
        </div>
        <div className="seg">
          {METRIC_RANGES.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={range === entry.id} onClick={() => { setRange(entry.id); setHover(null); }}>
              {entry.id}
            </button>
          ))}
        </div>
      </div>
      {points.length > 1 ? (
        <ChartFrame points={points} bounds={bounds} onHover={setHover} write={write} />
      ) : (
        <p className="price-chart plot-empty num faint">Not enough TTM history for this metric.</p>
      )}
    </section>
  );
}

function ChartFrame({
  points,
  bounds,
  onHover,
  write,
}: {
  points: PricePoint[];
  bounds: { high: number; low: number } | null;
  onHover: (index: number | null) => void;
  write: (value: number) => string;
}) {
  return (
    <div className="price-frame">
      <PriceLine points={points} onHover={onHover} />
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
