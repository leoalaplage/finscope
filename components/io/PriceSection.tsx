"use client";

import { useEffect, useMemo, useState } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { axisExtents, Figure, MultiAxis, type AxisSeries, type PricePoint } from "./Plot";
import { axesFor, fromBase } from "./selection";
import { closesAsOf, overlayWindow, type Bar } from "./overlay";
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
  withPrice,
  onWithPrice,
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
  withPrice: boolean;
  onWithPrice: (withPrice: boolean) => void;
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
            ticker={ticker}
            currency={currency}
            view={view}
            metricKeys={metricKeys}
            onClear={onClearMetric}
            range={range}
            onRange={onRange}
            frequency={frequency}
            onFrequency={onFrequency}
            rebased={rebased}
            onRebased={onRebased}
            withPrice={withPrice}
            onWithPrice={onWithPrice}
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

/**
 * What each axis is called in a sentence.
 *
 * The caution under a two-scale chart used to print the unit key itself —
 * "perShare on the left" — which is the code's word for it, not the reader's.
 */
const SCALE_NAMES: Record<string, string> = {
  currency: "amounts",
  perShare: "per-share amounts",
  percent: "rates",
  ratio: "multiples",
  shares: "share counts",
  price: "the share price",
};

const scaleName = (unit: string) => SCALE_NAMES[unit] ?? unit;

type OverlayState = "idle" | "loading" | "ready" | "failed";

/**
 * The share price, read at the dates the filings were read at.
 *
 * The chart draws one point per period and places it by its position in the
 * series, so a price series has to be exactly those periods to line up with
 * them. Sampling the quotes at each period end — rather than drawing the daily
 * line beside them — is what makes the crosshair name one date for both, and
 * what lets a reader put free cash flow per share against the price paid for it
 * and see the two shapes on the same seventeen years.
 */
function useOverlayPrice(ticker: string, periods: IoPeriod[], enabled: boolean): { state: OverlayState; points: PricePoint[] } {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const asked = enabled ? overlayWindow(periods) : null;
  const key = asked ? `${ticker}|${asked.frequency}|${asked.start}|${periods.length}|${periods.at(-1)?.end ?? ""}` : "";
  const current = answer?.key === key ? answer : null;

  useEffect(() => {
    if (!key || !asked) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/market/${encodeURIComponent(ticker)}?frequency=${asked.frequency}&start=${asked.start}&end=${asked.end}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { bars: Array<{ date: string; close: number | null }> };
        setAnswer({ key, bars: body.bars.filter((bar): bar is Bar => bar.close != null && Number.isFinite(bar.close)) });
      } catch {
        if (!controller.signal.aborted) setAnswer({ key, bars: null });
      }
    })();
    return () => controller.abort();
    // The key carries the symbol and the window, which is everything the
    // request is made of; `asked` is derived from the same periods.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ticker]);

  const points = useMemo<PricePoint[]>(() => {
    if (!current?.bars?.length) return [];
    const closes = closesAsOf(current.bars, periods.map((period) => period.end));
    return periods.flatMap((period, index) => {
      const close = closes[index];
      return close == null ? [] : [{ date: period.end, value: close }];
    });
  }, [current, periods]);

  if (!enabled) return { state: "idle", points: [] };
  if (!current) return { state: "loading", points: [] };
  return { state: current.bars == null ? "failed" : "ready", points };
}

function MetricSection({
  ticker,
  currency: quoted,
  view,
  metricKeys,
  onClear,
  range,
  onRange,
  frequency,
  onFrequency,
  rebased,
  onRebased,
  withPrice,
  onWithPrice,
}: {
  ticker: string;
  currency: string;
  view: IoCompanyView;
  metricKeys: string[];
  onClear: () => void;
  range: Range;
  onRange: (range: Range) => void;
  frequency: Frequency;
  onFrequency: (frequency: Frequency) => void;
  rebased: boolean;
  onRebased: (rebased: boolean) => void;
  withPrice: boolean;
  onWithPrice: (withPrice: boolean) => void;
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
  /*
   * A figure is written in the unit of the series it belongs to.
   *
   * "price" is the overlay's own, and it is not a filed unit: a quote is in the
   * currency of the listing, which for a filer reporting in another currency is
   * not the currency the statements are kept in. Written with the price
   * formatter and the quoted currency, so the two are never conflated.
   */
  const writeWith = (unit: string) => (value: number) =>
    (unit === "price" ? writePrice(value, quoted) : formatUnit(value, unit as Unit, currency));

  const { units, axisOf } = axesFor(metricKeys, (key) => chosen.find((item) => item.key === key)?.unit ?? null);
  /*
   * The price is offered while there is an axis left to draw it against.
   *
   * A chart here carries two scales and no more, and the measures on screen
   * claim one for each unit they use. So the overlay is offered whenever the
   * measures share a single unit — which is the case a reader asks for it in:
   * free cash flow per share against what the market charged for it. Choosing a
   * second unit takes the axis back, and the price steps aside rather than
   * being drawn against a scale that is not its own.
   */
  const offersPrice = units.length <= 1;
  const overlay = useOverlayPrice(ticker, periods, withPrice && offersPrice);
  const priced = overlay.state === "ready" && overlay.points.length > 1;

  /*
   * Three measures over at most eighty periods: cheaper to walk than to
   * remember, and remembering it correctly would need a key made of both.
   *
   * Rebased, every series starts at nought and shares one axis — which is the
   * only way a chart can answer "which of these moved further", because with
   * two scales that answer is a property of where the scales were put.
   */
  const drawn = [
    ...chosen.map((item) => {
      const points = pointsFor(item.key);
      return { label: item.short, unit: item.unit as string, points: rebased ? fromBase(points) : points, axis: (rebased ? 0 : axisOf(item.key)) as 0 | 1 };
    }),
    // The quote is a currency of its own — the one the shares trade in, which
    // for a filer reporting in another currency is not the accounts' — so it is
    // written with the price formatter and never shares the measures' axis.
    ...(priced ? [{ label: "Share price", unit: "price", points: rebased ? fromBase(overlay.points) : overlay.points, axis: (rebased ? 0 : 1) as 0 | 1 }] : []),
  ].filter((entry) => entry.points.length > 1);
  const series: AxisSeries[] = drawn.map(({ label, points, axis }) => ({ label, points, axis }));
  const scales = rebased ? [] : priced ? [units[0] ?? "currency", "price"] : units;

  const single = chosen.length === 1 && metric != null && !priced;
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
        {/*
          * What the market paid, beside what the company earned.
          *
          * The chart used to swap one for the other: choosing free cash flow
          * per share put the share price away, which is precisely the moment a
          * reader wants both. The quote is read at each period end, so the two
          * lines carry the same dates and the crosshair names one of them.
          */}
        {offersPrice ? (
          <button className="metric-toggle" type="button" aria-pressed={withPrice} onClick={() => { onWithPrice(!withPrice); setHover(null); }}>
            Share price
          </button>
        ) : null}
        {/*
          * Two readings of the same lines, and one of them is always in force.
          *
          * "Start from 0" was a switch that named its own mechanism rather than
          * what it gives you, and a switch that looks the same on and off is
          * not a switch — the reader could not tell which of the two pictures
          * they were looking at. A pair, with the one in force filled, says
          * both things at once: what you are reading, and what the other option
          * would be.
          */}
        {drawn.length > 1 ? (
          <div className="seg">
            <button type="button" aria-pressed={!rebased} onClick={() => { onRebased(false); setHover(null); }}>Values</button>
            <button type="button" aria-pressed={rebased} onClick={() => { onRebased(true); setHover(null); }}>% change</button>
          </div>
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
            {drawn.map((entry, index) => {
              const point = hover == null ? entry.points.at(-1) : entry.points[hover];
              return (
                <span className="compare-value" key={entry.label}>
                  <span className={`plot-swatch plot-stroke-${index % 5}`} />
                  <span className="compare-value-name">{entry.label}</span>
                  <span className="num">{point ? (rebased ? delta(point.value, 1) : writeWith(entry.unit)(point.value)) : ABSENT}</span>
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
              Two scales: {scaleName(scales[0])} on the left, {scaleName(scales[1])} on the right. Where the lines cross
              means nothing — two independent axes can be slid past each other until any two series touch anywhere. Read
              each line&rsquo;s own shape, or read them as % change instead.
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
      {/* A switch that appears to do nothing is worse than one that is not
          offered: say why the quote is not on the picture. */}
      {overlay.state === "failed" ? (
        <p className="stat-note" style={{ marginTop: 10 }}>No quoted history for this symbol, so the share price cannot be drawn beside it.</p>
      ) : null}
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
