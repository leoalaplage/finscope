"use client";

import { useEffect, useMemo, useState } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { axisExtents, Figure, MultiAxis, type AxisSeries, type PricePoint } from "./Plot";
import { axesFor, fromBase } from "./selection";
import { fundamentalWindow, METRIC_RANGES, metricRange, offersFrequency, priceWindow, RANGES, shapeFor, withinYears, type Frequency, type Range } from "./ranges";
import { ABSENT, datedCagrOf, delta, formatUnit, price as writePrice, shortDate, type Unit } from "./format";

/**
 * The chart the page is built around, and the one control that drives it.
 *
 * It shows the share price until the reader picks a measure below, and then it
 * shows that measure. Both halves read the same range, so choosing MAX at the
 * top moves everything on the screen at once rather than leaving the figures
 * underneath on a window of their own.
 */

/** Where a measure chosen from the table below sends the reader. */
export const CHART_ANCHOR = "chart";

interface Bar { date: string; close: number }
interface Answer { key: string; bars: Bar[] | null }

export function PriceSection({
  ticker,
  currency,
  view,
  metricKeys,
  onClearMetric,
  range,
  onRange,
  frequency,
  onFrequency,
  rebased,
  onRebased,
}: {
  ticker: string;
  currency: string;
  view: IoCompanyView;
  metricKeys: string[];
  onClearMetric: () => void;
  range: Range;
  onRange: (range: Range) => void;
  frequency: Frequency;
  onFrequency: (frequency: Frequency) => void;
  rebased: boolean;
  onRebased: (rebased: boolean) => void;
}) {
  /*
   * The anchor sits on a wrapper that outlives the swap.
   *
   * It used to sit on each of the two sections, which are different elements:
   * choosing a measure from a statement row unmounted the one the scroll had
   * just been started on, and the browser cancelled it. The reader saw the row
   * highlight and nothing else move.
   */
  return (
    <div id={CHART_ANCHOR}>
      {metricKeys.length
        ? (
          <MetricSection
            key={metricKeys.join("|")}
            view={view}
            metricKeys={metricKeys}
            onClear={onClearMetric}
            range={range}
            onRange={onRange}
            frequency={frequency}
            onFrequency={onFrequency}
            rebased={rebased}
            onRebased={onRebased}
          />
        )
        : <MarketPriceSection ticker={ticker} currency={currency} range={range} onRange={onRange} />}
    </div>
  );
}

function RangePicker({ range, onRange, offered = RANGES }: { range: Range; onRange: (range: Range) => void; offered?: Range[] }) {
  return (
    <div className="seg">
      {offered.map((entry) => (
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
  metricKeys,
  onClear,
  range,
  onRange,
  frequency,
  onFrequency,
  rebased,
  onRebased,
}: {
  view: IoCompanyView;
  metricKeys: string[];
  onClear: () => void;
  range: Range;
  onRange: (range: Range) => void;
  frequency: Frequency;
  onFrequency: (frequency: Frequency) => void;
  rebased: boolean;
  onRebased: (rebased: boolean) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const chosen = useMemo(
    () => metricKeys.map((key) => view.metrics.find((item) => item.key === key)).filter((item): item is NonNullable<typeof item> => item != null),
    [metricKeys, view.metrics],
  );
  const metric = chosen[0] ?? null;

  const shown = metricRange(range);
  const periods = useMemo<IoPeriod[]>(() => {
    const series = frequency === "annual" ? view.annual : view.trailing;
    return withinYears(series, fundamentalWindow(shown).years);
  }, [view.annual, view.trailing, frequency, shown]);

  const pointsFor = (key: string): PricePoint[] => periods.flatMap((period) => {
    const value = period.values[key];
    return value == null || !Number.isFinite(value) ? [] : [{ date: period.end, value }];
  });

  const currency = periods.at(-1)?.currency ?? view.company.currency;
  const writeWith = (unit: string) => (value: number) => formatUnit(value, unit as Unit, currency);

  const { units, axisOf } = axesFor(metricKeys, (key) => chosen.find((item) => item.key === key)?.unit ?? null);
  /*
   * Three measures over at most eighty periods: cheaper to walk than to
   * remember, and remembering it correctly would need a key made of both.
   *
   * Rebased, every series starts at nought and shares one axis — which is the
   * only way a chart can answer "which of these moved further", because with
   * two scales that answer is a property of where the scales were put.
   */
  const series: AxisSeries[] = chosen
    .map((item) => {
      const points = pointsFor(item.key);
      return { label: item.short, points: rebased ? fromBase(points) : points, axis: rebased ? 0 : axisOf(item.key) };
    })
    .filter((entry) => entry.points.length > 1);
  const scales = rebased ? [] : units;

  const single = chosen.length === 1 && metric != null;
  const points = single ? pointsFor(metric.key) : [];
  const active = hover == null ? points.at(-1) ?? null : points[hover] ?? null;
  const growth = single && metric.unit === "percent"
    ? points.length > 1 ? points.at(-1)!.value - points[0].value : null
    : single ? datedCagrOf(points) : null;
  const bounds = points.length
    ? { high: Math.max(...points.map((point) => point.value)), low: Math.min(...points.map((point) => point.value)) }
    : null;
  const write = (value: number) => (metric ? formatUnit(value, metric.unit as Unit, currency) : ABSENT);
  const extents = axisExtents(series);

  if (!metric) return null;

  return (
    <section className="section metric-feature" style={{ borderTop: 0 }}>
      <div className="metric-feature-title">
        <button className="metric-clear" type="button" onClick={onClear}>× Back to price</button>
        <span className="label">{chosen.map((item) => item.label).join(" · ")}</span>
        {chosen.length > 1 ? (
          <button className="metric-toggle" type="button" aria-pressed={rebased} onClick={() => { onRebased(!rebased); setHover(null); }}>
            Start from 0
          </button>
        ) : null}
        {offersFrequency(shown) ? (
          <div className="seg seg-frequency">
            {FREQUENCIES.map((entry) => (
              <button key={entry.id} type="button" aria-pressed={frequency === entry.id} onClick={() => { onFrequency(entry.id); setHover(null); }}>
                {entry.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="section-head">
        <div className="readout">
          {single ? (
            <>
              <span className="v">{active ? write(active.value) : ABSENT}</span>
              <span className="d">{active ? shortDate(active.date) : shown}</span>
              {growth != null ? <span className="readout-cagr">{delta(growth)} {metric.unit === "percent" ? "change" : "CAGR"}</span> : null}
            </>
          ) : (
            <span className="d">
              {hover != null && series[0]?.points[hover] ? shortDate(series[0].points[hover].date) : `${shown} · ${frequency === "annual" ? "Yearly" : "TTM"}`}
            </span>
          )}
        </div>
        <RangePicker range={shown} onRange={onRange} offered={METRIC_RANGES} />
      </div>
      {!single ? (
        <>
          {/*
            * Each line's own figure, because two scales mean the reader cannot
            * read one line off the other's axis.
            */}
          <div className="compare-values">
            {series.map((entry, index) => {
              const item = chosen[index];
              const point = hover == null ? entry.points.at(-1) : entry.points[hover];
              return (
                <span className="compare-value" key={entry.label}>
                  <span className={`plot-swatch plot-stroke-${index % 5}`} />
                  <span className="compare-value-name">{entry.label}</span>
                  <span className="num">{point && item ? (rebased ? delta(point.value, 1) : writeWith(item.unit)(point.value)) : ABSENT}</span>
                </span>
              );
            })}
          </div>
          {series.length ? (
            <div className="price-frame">
              <MultiAxis series={series} onHover={setHover} />
              <div className="plot-axis">
                {extents[0] ? (
                  <>
                    <span className="plot-tag plot-tag-left" style={{ top: 0 }}>{rebased ? delta(extents[0].max, 0) : writeWith(scales[0] ?? "currency")(extents[0].max)}</span>
                    <span className="plot-tag plot-tag-left" style={{ bottom: 0 }}>{rebased ? delta(extents[0].min, 0) : writeWith(scales[0] ?? "currency")(extents[0].min)}</span>
                  </>
                ) : null}
                {extents[1] && scales[1] ? (
                  <>
                    <span className="plot-tag" style={{ right: 0, top: 0 }}>{writeWith(scales[1])(extents[1].max)}</span>
                    <span className="plot-tag" style={{ right: 0, bottom: 0 }}>{writeWith(scales[1])(extents[1].min)}</span>
                  </>
                ) : null}
                <span className="plot-tag plot-tag-under" style={{ left: 0 }}>{shortDate(series[0]?.points[0]?.date)}</span>
                <span className="plot-tag plot-tag-under" style={{ right: 0 }}>{shortDate(series[0]?.points.at(-1)?.date)}</span>
              </div>
            </div>
          ) : (
            <p className="price-chart plot-empty num faint">Not enough history for these measures.</p>
          )}
          {rebased ? (
            <p className="stat-note" style={{ marginTop: 10 }}>
              Change from the start of the window, so both measures begin together on one axis. A measure that began at
              or below nought has no proportion to grow by and is left out rather than drawn from an arbitrary floor.
            </p>
          ) : scales.length > 1 ? (
            <p className="stat-note" style={{ marginTop: 10 }}>
              Two scales: {scales[0]} on the left, {scales[1]} on the right. Where the lines cross means nothing — two
              independent axes can be slid past each other until any two series touch anywhere. Read each line&rsquo;s own
              shape, or start them both from nought.
            </p>
          ) : null}
        </>
      ) : points.length > 1 ? (
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
