"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CANDLE_INTERVALS, type Candles, type CandleInterval } from "@/lib/adapters/candles";
import { candlesToShow, dateLabels, dateText, INTERVAL_NAMES, INTERVAL_TITLES, priceScale } from "@/lib/io/candle-chart";
import { CHART_EMAS, ema, type Line } from "@/lib/io/indicators";
import {
  averageTrueRange, fairValueGaps, fibonacci, marketStructure, PIVOT_SPAN, pivots, priceOnLine,
  supportResistance, trendLines, type Study,
} from "@/lib/io/technicals";

/**
 * Candles, drawn here, wherever the site shows them: the chart page, a
 * company's price section, the charts under the watchlist.
 *
 * An SVG in a fixed box stretched to the container, strokes that keep their
 * width, and every word in HTML over it (see Plot.tsx). A still picture — no
 * zoom, no panning — with a crosshair that reads out the candle and the price
 * under the pointer. The studies passed in are drawn over the candles
 * (lib/io/technicals.ts); a compact chart draws fewer ticks and dates, no
 * legend, and allows narrower candles so three fit side by side.
 */

const W = 1000;
const H = 460;

const EMA_COLORS: Record<(typeof CHART_EMAS)[number], string> = { 20: "#e8a33d", 50: "#4c8dff", 200: "#b06cf0" };

const COMPACT_CANDLE_PX = 1.6;

const FIB_COLOR = "#d9a441";
const EXTENSION_COLOR = "#2bb3a3";

const ratioText = (ratio: number) => `${(ratio * 100).toFixed(1).replace(/\.0$/, "")}%`;

export const price = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const signed = (value: number) => `${value >= 0 ? "+" : "−"}${price(Math.abs(value))}`;
export const percent = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(2)}%`;
export const tone = (value: number | null) => (value == null ? undefined : value >= 0 ? "good" : "bad");

export type CandleLoad = { key: string; candles: Candles | null; error: string | null };

/** One symbol's candles at one interval; nothing is asked for until `enabled`. */
export function useCandles(symbol: string, interval: CandleInterval, enabled = true) {
  const key = `${symbol}:${interval}`;
  const [load, setLoad] = useState<CandleLoad>({ key: "", candles: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(`/api/candles/${encodeURIComponent(symbol)}?interval=${interval}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as Partial<Candles> & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
        if (!body.t?.length) throw new Error(`No price history for ${symbol}.`);
        setLoad({ key, candles: body as Candles, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ key, candles: null, error: error instanceof Error ? error.message : "Unreachable." });
      });
    return () => controller.abort();
  }, [key, symbol, interval, enabled]);

  const loading = load.key !== key;
  return { candles: loading ? null : load.candles, error: loading ? null : load.error, loading };
}

/** The last close and how far it moved from the one before, at the chart's interval. */
export function lastMoveOf(candles: Candles | null) {
  if (!candles?.c.length) return null;
  const close = candles.c[candles.c.length - 1];
  const before = candles.c.length > 1 ? candles.c[candles.c.length - 2] : null;
  return { close, move: before != null ? close - before : null, base: before };
}

export function IntervalPicker({ interval, onInterval }: { interval: CandleInterval; onInterval: (interval: CandleInterval) => void }) {
  return (
    <div className="seg" role="group" aria-label="Candle interval">
      {CANDLE_INTERVALS.map((item) => (
        <button type="button" key={item} aria-pressed={interval === item} title={INTERVAL_TITLES[item]} onClick={() => onInterval(item)}>
          {INTERVAL_NAMES[item]}
        </button>
      ))}
    </div>
  );
}

const NO_STUDIES: ReadonlySet<Study> = new Set();

export function CandleChart({
  candles, interval, loading, error, label, studies = NO_STUDIES, compact = false,
}: {
  candles: Candles | null;
  interval: CandleInterval;
  loading: boolean;
  error: string | null;
  label: string;
  studies?: ReadonlySet<Study>;
  compact?: boolean;
}) {
  const clipId = `candle-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  /* How wide the plot is, so a phone shows fewer, wider candles. */
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const averages = useMemo(
    () => CHART_EMAS.map((period) => ({ period, line: candles ? ema(candles.c, period) : ([] as Line) })),
    [candles],
  );
  const ranges = useMemo(() => (candles ? averageTrueRange(candles) : []), [candles]);
  const on = (study: Study) => studies.has(study);
  const showEma = studies.has("ema");
  const showExtension = studies.has("fibExtension");

  /* The candles on screen, and everything positioned from them. */
  const view = useMemo(() => {
    if (!candles) return null;
    const total = candles.t.length;
    const count = candlesToShow(interval, total, width, compact ? COMPACT_CANDLE_PX : undefined);
    if (!count) return null;
    const from = total - count;
    const t = candles.t.slice(from), o = candles.o.slice(from), h = candles.h.slice(from), l = candles.l.slice(from), c = candles.c.slice(from);
    const lines = averages.map((average) => ({ period: average.period, values: average.line.slice(from) }));

    // The analysis reads the candles on screen, with tolerances in average ranges.
    const series = { t, o, h, l, c };
    const atrs = ranges.slice(from);
    const atr = [...atrs].reverse().find((value): value is number => value != null) ?? (Math.max(...h) - Math.min(...l)) / 20;
    const found = pivots(series, PIVOT_SPAN[interval]);
    const analysis = {
      fib: fibonacci(series, PIVOT_SPAN[interval]),
      gaps: fairValueGaps(series, atrs),
      trends: trendLines(series, found, atr),
      levels: supportResistance(series, found, atr),
      structure: marketStructure(series, PIVOT_SPAN[interval]),
    };

    const scale = priceScale([
      ...h, ...l,
      ...(showEma ? lines.flatMap((line) => line.values.filter((value): value is number => value != null)) : []),
      ...(showExtension && analysis.fib ? analysis.fib.extension.map((level) => level.price) : []),
    ], compact ? 5 : 6);
    if (!scale) return null;
    const slot = W / count;
    const x = (index: number) => (index + 0.5) * slot;
    const y = (value: number) => H - ((value - scale.min) / (scale.max - scale.min)) * H;
    return { t, o, h, l, c, lines, analysis, scale, slot, x, y, count, previous: from > 0 ? candles.c[from - 1] : null };
  }, [candles, averages, ranges, interval, width, showEma, showExtension, compact]);

  /* Where each study's words sit over the plot, as fractions of it. */
  const pct = (value: number, of: number) => `${Math.min(100, Math.max(0, (value / of) * 100))}%`;
  // A label that would run off the right edge is written leftwards from its line's start instead.
  const noteAt = (x: number, y: number) => ({ left: pct(x, W), top: pct(y, H) });
  const noteSide = (x: number) => (x / W > 0.72 ? "study-note-flip" : undefined);
  const fib = view?.analysis.fib ?? null;

  /*
   * The crosshair: the candle under the pointer, which the vertical line snaps
   * to, and the pointer's own height, which the horizontal line follows
   * exactly — a price is read off the axis wherever the pointer is, not only
   * at a candle's close.
   */
  const [pointer, setPointer] = useState<{ index: number; y: number } | null>(null);
  const onPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!view) return;
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - box.left) / box.width) * view.count);
    const y = (event.clientY - box.top) / box.height;
    setPointer(index >= 0 && index < view.count && y >= 0 && y <= 1 ? { index, y } : null);
  };
  const hover = pointer && view && pointer.index < view.count ? pointer.index : null;
  const pointerPrice = pointer && view ? view.scale.max - pointer.y * (view.scale.max - view.scale.min) : null;

  const at = view ? Math.min(hover ?? view.count - 1, view.count - 1) : null;
  const baseOf = (index: number) => (!view ? null : index > 0 ? view.c[index - 1] : view.previous);
  const before = at != null ? baseOf(at) : null;
  const move = view && at != null && before != null ? view.c[at] - before : null;
  const last = view ? view.count - 1 : 0;
  const lastBase = baseOf(last);
  const lastMove = view && lastBase != null ? view.c[last] - lastBase : null;

  return (
  <figure className="candle-chart" data-size={compact ? "compact" : undefined} aria-label={label}>
    {compact ? null : <div className="candle-legend">
      {view && at != null ? (
        <>
          <span className="dim">{dateText(view.t[at], interval)}</span>
          <span>O <b>{price(view.o[at])}</b></span>
          <span>H <b>{price(view.h[at])}</b></span>
          <span>L <b>{price(view.l[at])}</b></span>
          <span>C <b>{price(view.c[at])}</b></span>
          {move != null && before ? <b data-tone={tone(move)}>{signed(move)} ({percent(move / before)})</b> : null}
          {showEma ? CHART_EMAS.map((period, index) => (
            <span key={period} className="candle-legend-ema">
              <i style={{ background: EMA_COLORS[period] }} aria-hidden="true" />EMA {period} <b>{price(view.lines[index].values[at])}</b>
            </span>
          )) : null}
        </>
      ) : null}
    </div>}

    <div className="candle-body">
      <div className="candle-plot" ref={plotRef} onPointerMove={onPointer} onPointerLeave={() => setPointer(null)}>
        {view ? (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {view.scale.ticks.map((tick) => (
              <line key={tick} className="candle-grid" x1={0} x2={W} y1={view.y(tick)} y2={view.y(tick)} vectorEffect="non-scaling-stroke" />
            ))}
            {hover != null && pointer ? (
              <>
                <line className="candle-cursor" x1={view.x(hover)} x2={view.x(hover)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
                <line className="candle-cursor" x1={0} x2={W} y1={pointer.y * H} y2={pointer.y * H} vectorEffect="non-scaling-stroke" />
              </>
            ) : null}
            <defs><clipPath id={clipId}><rect x={0} y={0} width={W} height={H} /></clipPath></defs>
            <line className="candle-last" x1={0} x2={W} y1={view.y(view.c[last])} y2={view.y(view.c[last])} vectorEffect="non-scaling-stroke" />
            {on("fvg") ? (
              <g clipPath={`url(#${clipId})`}>
                {view.analysis.gaps.map((gap) => (
                  <rect
                    key={`${gap.kind}-${gap.index}`} className={`study-gap study-gap-${gap.kind}`}
                    x={view.x(gap.index) - view.slot / 2} width={W - view.x(gap.index) + view.slot / 2}
                    y={view.y(gap.top)} height={Math.max(view.y(gap.bottom) - view.y(gap.top), 0.8)}
                  />
                ))}
              </g>
            ) : null}
            {on("orderBlocks") ? (
              <g clipPath={`url(#${clipId})`}>
                {view.analysis.structure.blocks.map((block) => (
                  <rect
                    key={`ob-${block.index}`} className={`study-block study-block-${block.direction}`}
                    x={view.x(block.index) - view.slot / 2} width={W - view.x(block.index) + view.slot / 2}
                    y={view.y(block.top)} height={Math.max(view.y(block.bottom) - view.y(block.top), 0.8)}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            ) : null}
            {view.c.map((close, index) => {
              const open = view.o[index];
              const top = view.y(Math.max(open, close));
              const bottom = view.y(Math.min(open, close));
              const width = view.slot * 0.64;
              return (
                <g key={view.t[index]} className={close >= open ? "candle-up" : "candle-down"}>
                  <line x1={view.x(index)} x2={view.x(index)} y1={view.y(view.h[index])} y2={view.y(view.l[index])} vectorEffect="non-scaling-stroke" />
                  <rect x={view.x(index) - width / 2} y={top} width={width} height={Math.max(bottom - top, 0.8)} />
                </g>
              );
            })}
            <g clipPath={`url(#${clipId})`}>
              {on("structure") ? view.analysis.structure.breaks.map((item) => (
                <line
                  key={`break-${item.index}`} className={`study-break study-${item.direction === "bullish" ? "support" : "resistance"}`}
                  x1={view.x(item.swing.index)} x2={view.x(item.index)} y1={view.y(item.swing.price)} y2={view.y(item.swing.price)}
                  vectorEffect="non-scaling-stroke"
                />
              )) : null}
              {on("levels") ? view.analysis.levels.map((level) => (
                <line key={`level-${level.price}`} className={`study-level study-${level.kind}`} x1={0} x2={W} y1={view.y(level.price)} y2={view.y(level.price)} vectorEffect="non-scaling-stroke" />
              )) : null}
              {on("fibRetracement") && fib ? (
                <>
                  <line className="study-fib-swing" x1={view.x(fib.from.index)} y1={view.y(fib.from.price)} x2={view.x(fib.to.index)} y2={view.y(fib.to.price)} vectorEffect="non-scaling-stroke" />
                  {fib.retracement.map((level) => (
                    <line
                      key={`fib-${level.ratio}`} className="study-fib" data-key={level.ratio === 0.5 || level.ratio === 0.618 ? "" : undefined}
                      style={{ stroke: FIB_COLOR }} x1={view.x(Math.min(fib.from.index, fib.to.index))} x2={W}
                      y1={view.y(level.price)} y2={view.y(level.price)} vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </>
              ) : null}
              {on("fibExtension") && fib ? fib.extension.map((level) => (
                <line
                  key={`ext-${level.ratio}`} className="study-fib" style={{ stroke: EXTENSION_COLOR }}
                  x1={view.x((fib.pullback ?? fib.to).index)} x2={W} y1={view.y(level.price)} y2={view.y(level.price)} vectorEffect="non-scaling-stroke"
                />
              )) : null}
              {on("trendLines") ? view.analysis.trends.map((line) => (
                <line
                  key={`${line.kind}-${line.a.index}-${line.b.index}`} className={`study-trend study-${line.kind}`}
                  x1={view.x(line.a.index)} y1={view.y(line.a.price)} x2={W} y2={view.y(priceOnLine(line, view.count - 0.5))}
                  vectorEffect="non-scaling-stroke"
                />
              )) : null}
            </g>
            {showEma ? view.lines.map((line) => {
              let path = "";
              let open = false;
              line.values.forEach((value, index) => {
                if (value == null) { open = false; return; }
                path += `${open ? "L" : "M"}${view.x(index).toFixed(2)} ${view.y(value).toFixed(2)}`;
                open = true;
              });
              return path ? (
                <path key={line.period} className="candle-ema" d={path} style={{ stroke: EMA_COLORS[line.period] }} vectorEffect="non-scaling-stroke" />
              ) : null;
            }) : null}
          </svg>
        ) : null}
        {view ? (
          <div className="study-notes" aria-hidden="true">
            {on("fibRetracement") && fib ? fib.retracement.map((level) => (
              <span key={`fib-${level.ratio}`} className={noteSide(view.x(Math.min(fib.from.index, fib.to.index)))} style={{ ...noteAt(view.x(Math.min(fib.from.index, fib.to.index)), view.y(level.price)), color: FIB_COLOR }}>
                {ratioText(level.ratio)} {price(level.price)}
              </span>
            )) : null}
            {on("fibExtension") && fib ? fib.extension.map((level) => (
              <span key={`ext-${level.ratio}`} className={noteSide(view.x((fib.pullback ?? fib.to).index))} style={{ ...noteAt(view.x((fib.pullback ?? fib.to).index), view.y(level.price)), color: EXTENSION_COLOR }}>
                Ext {ratioText(level.ratio)} {price(level.price)}
              </span>
            )) : null}
            {on("structure") ? view.analysis.structure.breaks.map((item) => (
              <span
                key={`break-${item.index}`} className="study-note-centre" data-tone={item.direction === "bullish" ? "good" : "bad"}
                style={noteAt((view.x(item.swing.index) + view.x(item.index)) / 2, view.y(item.swing.price))}
              >
                {item.kind}
              </span>
            )) : null}
            {on("orderBlocks") ? view.analysis.structure.blocks.map((block) => (
              <span
                key={`ob-${block.index}`} className={noteSide(view.x(block.index))} data-tone={block.direction === "bullish" ? "good" : "bad"}
                style={noteAt(view.x(block.index) - view.slot / 2, view.y(block.top))}
              >
                {block.direction === "bullish" ? "Bull OB" : "Bear OB"}
              </span>
            )) : null}
            {on("levels") ? view.analysis.levels.map((level) => (
              <span key={`level-${level.price}`} className="study-note-right" data-tone={level.kind === "support" ? "good" : "bad"} style={{ top: pct(view.y(level.price), H) }}>
                {level.kind === "support" ? "S" : "R"} {price(level.price)} · {level.touches}×
              </span>
            )) : null}
          </div>
        ) : null}
        {loading || error || (!view && candles) ? (
          <div className="candle-state">{loading ? "Loading…" : error ?? "Not enough history to draw."}</div>
        ) : null}
      </div>

      <div className="candle-axis" aria-hidden="true">
        {view ? (
          <>
            {view.scale.ticks.map((tick) => (
              <span key={tick} style={{ top: `${(view.y(tick) / H) * 100}%` }}>{price(tick)}</span>
            ))}
            <span className="candle-tag" data-tone={tone(lastMove)} style={{ top: `${(view.y(view.c[last]) / H) * 100}%` }}>
              {price(view.c[last])}
            </span>
            {pointer && pointerPrice != null ? (
              <span className="candle-tag candle-cross" style={{ top: `${pointer.y * 100}%` }}>{price(pointerPrice)}</span>
            ) : null}
          </>
        ) : null}
      </div>
    </div>

    <div className="candle-dates" aria-hidden="true">
      {view ? dateLabels(view.t, interval, compact ? 4 : 8).map((label) => (
        <span key={label.index} style={{ left: `${((label.index + 0.5) / view.count) * 100}%` }}>{label.text}</span>
      )) : null}
      {view && hover != null ? (
        <span className="candle-cross" style={{ left: `${((hover + 0.5) / view.count) * 100}%` }}>{dateText(view.t[hover], interval).replace("Week of ", "")}</span>
      ) : null}
    </div>
  </figure>

  );
}
