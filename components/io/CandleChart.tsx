"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CANDLE_INTERVALS, isIntraday, type Candles, type CandleInterval } from "@/lib/adapters/candles";
import { candlesToShow, dateLabels, dateText, INTERVAL_NAMES, INTERVAL_TITLES, priceScale } from "@/lib/io/candle-chart";
import { bollinger, CHART_EMAS, ema, ichimoku, macd, patternsAt, PATTERN_NAMES, rsi, sma, stochastic, volumeProfile, vwap, type Line } from "@/lib/io/indicators";
import {
  adx, aroon, chaikinMoneyFlow, cci, donchian, floorPivots, heikinAshi, hullMa, keltner, moneyFlowIndex, obv,
  parabolicSar, roc, squeeze, stochRsi, supertrend, williamsR, type Pivots,
} from "@/lib/io/indicators-extra";
import { DRAWN_FIB_RATIOS, drawingAt, indexOfTime, timeOfIndex, type Anchor, type Drawing, type Tool } from "@/lib/term/drawings";
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

/** The simple averages, the ones a golden cross is read from. */
const CHART_SMAS = [50, 200] as const;
const SMA_COLORS: Record<(typeof CHART_SMAS)[number], string> = { 50: "#3fb7c9", 200: "#e05fa0" };
const BAND_COLOR = "#7d8ad6";

/** The lower panes, each in a box of its own height and the chart's width. */
const PANE_H = 100;
type Pane = "volume" | "rsi" | "macd" | "stoch" | "atr" | "rs" | ExtraPane;
type ExtraPane = "adx" | "squeeze" | "stochrsi" | "willr" | "cci" | "roc" | "aroon" | "obv" | "cmf" | "mfi";
const EXTRA_PANES: ExtraPane[] = ["adx", "squeeze", "stochrsi", "willr", "cci", "roc", "aroon", "obv", "cmf", "mfi"];
const PANES: Pane[] = ["volume", "rsi", "macd", "stoch", "atr", "rs", ...EXTRA_PANES];
const KELTNER_COLOR = "#d68a3c";
const DONCHIAN_COLOR = "#3fb7c9";
const HMA_COLOR = "#f0c33c";
const PIVOT_COLOR = "#9aa3ad";

/**
 * Floor pivots for the period the last candle is in, from the period before:
 * the session before on intraday candles, the month before on days, the year
 * before on weeks and months — the convention charting platforms use.
 */
function pivotLevels(candles: Candles, interval: CandleInterval): Pivots | null {
  const keyOf = (time: number) => {
    const date = new Date(time * 1000).toISOString();
    return isIntraday(interval) ? date.slice(0, 10) : interval === "1d" ? date.slice(0, 7) : date.slice(0, 4);
  };
  const n = candles.t.length;
  if (n < 2) return null;
  const current = keyOf(candles.t[n - 1]);
  let index = n - 1;
  while (index >= 0 && keyOf(candles.t[index]) === current) index--;
  if (index < 0) return null;
  const previous = keyOf(candles.t[index]);
  let high = -Infinity, low = Infinity;
  const close = candles.c[index];
  for (; index >= 0 && keyOf(candles.t[index]) === previous; index--) { high = Math.max(high, candles.h[index]); low = Math.min(low, candles.l[index]); }
  return floorPivots(high, low, close);
}

const VWAP_COLOR = "#f1f1f1";
const TENKAN_COLOR = "#4c8dff";
const KIJUN_COLOR = "#e5484d";
const CLOUD_COLOR = "#2bb3a3";

/** Fewest candles a zoom can come down to. */
const MIN_CANDLES = 15;

/** A second symbol drawn over the first, rebased to it. */
export interface CompareSeries { symbol: string; candles: Candles | null; color: string }

/**
 * Ticks for a logarithmic axis: evenly spaced in the logarithm, each rounded
 * to two significant figures so the axis still reads in round numbers.
 */
function logTicks(min: number, max: number, count: number): number[] {
  const low = Math.log(min);
  const step = (Math.log(max) - low) / count;
  const ticks = new Set<number>();
  for (let k = 1; k < count; k++) {
    const value = Math.exp(low + k * step);
    const unit = 10 ** (Math.floor(Math.log10(value)) - 1);
    ticks.add(Number((Math.round(value / unit) * unit).toPrecision(6)));
  }
  return [...ticks];
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

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
  drawings, tool = "cursor", onDrawingsChange, zoomable = false, logScale = false, compare, benchmark, openOn,
}: {
  candles: Candles | null;
  interval: CandleInterval;
  loading: boolean;
  error: string | null;
  label: string;
  studies?: ReadonlySet<Study>;
  compact?: boolean;
  /**
   * The reader's own lines, anchored to dates and prices (lib/term/drawings.ts).
   * Given with `onDrawingsChange`, the chart lets the reader add and erase them
   * with `tool`; without, it draws none.
   */
  drawings?: Drawing[];
  tool?: Tool;
  onDrawingsChange?: (next: Drawing[]) => void;
  /**
   * The wheel zooms around the pointer, a drag pans, a double click returns
   * to the latest candles. Off where the chart sits in a page that scrolls
   * past it, so the wheel still scrolls the page there.
   */
  zoomable?: boolean;
  /** Prices on a logarithmic axis, where equal moves in percent are equal distances. */
  logScale?: boolean;
  /** Other symbols drawn over this one, rebased to its first candle on screen. */
  compare?: CompareSeries[];
  /** The market this symbol is measured against in the relative-strength pane. */
  benchmark?: Candles | null;
  /**
   * How many of the latest candles open on screen, where a period was chosen
   * (lib/io/chart-ranges.ts) rather than left to the width. The whole history
   * is still read, so the averages are settled on the first candle shown.
   */
  openOn?: number;
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
  /*
   * Every other indicator, read over the whole history and cut to the candles
   * on screen afterwards, like the averages: the first candle shown already
   * has a settled 200-period average and a warmed-up RSI.
   */
  const indicators = useMemo(() => {
    if (!candles) return null;
    return {
      smas: CHART_SMAS.map((period) => ({ period, line: sma(candles.c, period) })),
      bands: bollinger(candles.c),
      rsi: rsi(candles.c),
      macd: macd(candles.c),
      stoch: stochastic(candles),
      cloud: ichimoku(candles),
      sessionVwap: isIntraday(interval) ? vwap(candles, true) : null,
      trend: sma(candles.c, 10),
      // The rest of the toolkit (lib/io/indicators-extra.ts), each read only when it is on.
      keltner: studies.has("keltner") ? keltner(candles) : null,
      donchian: studies.has("donchian") ? donchian(candles) : null,
      supertrend: studies.has("supertrend") ? supertrend(candles) : null,
      psar: studies.has("psar") ? parabolicSar(candles) : null,
      hma: studies.has("hma") ? hullMa(candles.c) : null,
      pivots: studies.has("pivots") ? pivotLevels(candles, interval) : null,
      heikin: studies.has("heikinAshi") ? heikinAshi(candles) : null,
      extra: {
        adx: studies.has("adx") ? adx(candles) : null,
        squeeze: studies.has("squeeze") ? squeeze(candles) : null,
        stochrsi: studies.has("stochrsi") ? stochRsi(candles.c) : null,
        willr: studies.has("willr") ? williamsR(candles) : null,
        cci: studies.has("cci") ? cci(candles) : null,
        roc: studies.has("roc") ? roc(candles.c) : null,
        aroon: studies.has("aroon") ? aroon(candles) : null,
        obv: studies.has("obv") ? obv(candles) : null,
        cmf: studies.has("cmf") ? chaikinMoneyFlow(candles) : null,
        mfi: studies.has("mfi") ? moneyFlowIndex(candles) : null,
      },
    };
  }, [candles, interval, studies]);
  const on = (study: Study) => studies.has(study);
  const showEma = studies.has("ema");
  const showExtension = studies.has("fibExtension");
  const showSma = studies.has("sma");
  const showBands = studies.has("bollinger");
  const showCloud = studies.has("ichimoku");
  const showVwap = studies.has("vwap");

  /*
   * The window on the history: how many candles, and how many of the newest
   * are scrolled off to the right. Kept per symbol and interval, so a new one
   * opens on its latest candles; null is the default fit.
   */
  const seriesKey = candles ? `${candles.symbol}:${interval}:${candles.t.length}:${openOn ?? ""}` : "";
  const [zoom, setZoom] = useState<{ key: string; count: number; end: number } | null>(null);
  const windowed = zoomable && zoom?.key === seriesKey ? zoom : null;

  /*
   * The wheel, listened to directly: React's wheel handler is passive and
   * cannot stop the page scrolling under a zoom. Vertical movement zooms
   * around the candle under the pointer; horizontal movement, a trackpad's
   * sideways swipe, pans.
   */
  const latest = useRef<{ key: string; count: number; end: number; total: number; from: number } | null>(null);
  useEffect(() => {
    const element = plotRef.current;
    if (!element || !zoomable) return;
    const onWheel = (event: WheelEvent) => {
      const current = latest.current;
      if (!current) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const moved = (event.deltaX / box.width) * current.count;
        setZoom({ key: current.key, count: current.count, end: Math.min(Math.max(0, current.end - moved), current.total - current.count) });
        return;
      }
      const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      const count = Math.min(current.total, Math.max(Math.min(MIN_CANDLES, current.total), current.count * Math.exp(event.deltaY * 0.0015)));
      const anchor = current.from + fraction * current.count;
      const end = current.total - (anchor - fraction * count + count);
      setZoom({ key: current.key, count, end: Math.min(Math.max(0, end), current.total - count) });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomable]);
  const panes = PANES.filter((pane) => studies.has(pane)
    && !(pane === "volume" && !candles?.v?.some((value) => value > 0))
    && !(pane === "rs" && !benchmark?.t.length));

  /* The candles on screen, and everything positioned from them. */
  const view = useMemo(() => {
    if (!candles) return null;
    const total = candles.t.length;
    const fit = openOn ? Math.min(total, Math.max(2, openOn)) : candlesToShow(interval, total, width, compact ? COMPACT_CANDLE_PX : undefined);
    if (!fit) return null;
    const count = windowed ? Math.min(total, Math.max(Math.min(MIN_CANDLES, total), Math.round(windowed.count))) : fit;
    const end = windowed ? Math.min(Math.max(0, Math.round(windowed.end)), total - count) : 0;
    const from = total - count - end;
    const to = total - end;
    const t = candles.t.slice(from, to), o = candles.o.slice(from, to), h = candles.h.slice(from, to), l = candles.l.slice(from, to), c = candles.c.slice(from, to);
    const lines = averages.map((average) => ({ period: average.period, values: average.line.slice(from, to) }));
    const smaLines = (indicators?.smas ?? []).map((average) => ({ period: average.period, values: average.line.slice(from, to) }));
    const bands = indicators ? {
      middle: indicators.bands.middle.slice(from, to), upper: indicators.bands.upper.slice(from, to), lower: indicators.bands.lower.slice(from, to),
    } : null;
    /*
     * Relative strength: this symbol over the market, set to 100 on the first
     * candle both have on screen. Rising, it is beating the market; falling,
     * trailing it, whatever either did on its own.
     */
    const market = benchmark?.t.length ? new Map(benchmark.t.map((time, index) => [time, benchmark.c[index]])) : null;
    const rsBase = market ? t.findIndex((time) => market.has(time)) : -1;
    const rsLine: Line = market && rsBase >= 0
      ? t.map((time, index) => (market.has(time) ? ((c[index] / market.get(time)!) / (c[rsBase] / market.get(t[rsBase])!)) * 100 : null))
      : t.map(() => null);
    const momentum = indicators ? {
      rs: rsLine,
      stochK: indicators.stoch.k.slice(from, to), stochD: indicators.stoch.d.slice(from, to),
      atr: ranges.slice(from, to),
      rsi: indicators.rsi.slice(from, to),
      macd: indicators.macd.macd.slice(from, to), signal: indicators.macd.signal.slice(from, to), histogram: indicators.macd.histogram.slice(from, to),
    } : null;
    const volume = candles.v?.length === total ? candles.v.slice(from, to) : null;
    const cut = (line: Line | null | undefined) => (line ? line.slice(from, to) : null);
    const cutFlags = (flags: Array<boolean | null> | null | undefined) => (flags ? flags.slice(from, to) : null);
    const extra = indicators ? {
      keltner: indicators.keltner ? { upper: cut(indicators.keltner.upper)!, middle: cut(indicators.keltner.middle)!, lower: cut(indicators.keltner.lower)! } : null,
      donchian: indicators.donchian ? { upper: cut(indicators.donchian.upper)!, middle: cut(indicators.donchian.middle)!, lower: cut(indicators.donchian.lower)! } : null,
      supertrend: indicators.supertrend ? { line: cut(indicators.supertrend.line)!, up: cutFlags(indicators.supertrend.up)! } : null,
      psar: indicators.psar ? { line: cut(indicators.psar.line)!, up: cutFlags(indicators.psar.up)! } : null,
      hma: cut(indicators.hma),
      pivots: indicators.pivots,
      panes: {
        adx: indicators.extra.adx ? { adx: cut(indicators.extra.adx.adx)!, plus: cut(indicators.extra.adx.plus)!, minus: cut(indicators.extra.adx.minus)! } : null,
        squeeze: indicators.extra.squeeze ? { on: cutFlags(indicators.extra.squeeze.on)!, momentum: cut(indicators.extra.squeeze.momentum)! } : null,
        stochrsi: indicators.extra.stochrsi ? { k: cut(indicators.extra.stochrsi.k)!, d: cut(indicators.extra.stochrsi.d)! } : null,
        willr: cut(indicators.extra.willr),
        cci: cut(indicators.extra.cci),
        roc: cut(indicators.extra.roc),
        aroon: indicators.extra.aroon ? { up: cut(indicators.extra.aroon.up)!, down: cut(indicators.extra.aroon.down)! } : null,
        obv: cut(indicators.extra.obv),
        cmf: cut(indicators.extra.cmf),
        mfi: cut(indicators.extra.mfi),
      },
    } : null;
    // Heikin-Ashi changes the candles drawn, never the prices read: averages, levels and readouts stay on the real ones.
    const drawn = indicators?.heikin
      ? { o: indicators.heikin.o.slice(from, to), h: indicators.heikin.h.slice(from, to), l: indicators.heikin.l.slice(from, to), c: indicators.heikin.c.slice(from, to) }
      : { o, h, l, c };
    const cloud = indicators ? {
      tenkan: indicators.cloud.tenkan.slice(from, to), kijun: indicators.cloud.kijun.slice(from, to),
      spanA: indicators.cloud.spanA.slice(from, to), spanB: indicators.cloud.spanB.slice(from, to),
    } : null;
    // Inside the session it starts each morning; on days and longer, from the first candle on screen.
    const vwapLine = indicators?.sessionVwap ? indicators.sessionVwap.slice(from, to)
      : vwap({ t, o, h, l, c, v: volume ?? undefined }, false);
    const patterns = studies.has("patterns") && indicators
      ? c.map((_, index) => patternsAt(candles, from + index, indicators.trend))
      : null;

    /*
     * A compared symbol, rebased: its closes scaled so that on the first
     * candle both have, it stands where this symbol stands. The two lines
     * then part exactly as far as the two returns do.
     */
    const compared = (compare ?? []).flatMap((other) => {
      if (!other.candles?.t.length) return [];
      const closes = new Map(other.candles.t.map((time, index) => [time, other.candles!.c[index]]));
      const base = t.findIndex((time) => closes.has(time));
      if (base < 0) return [];
      const ratio = c[base] / closes.get(t[base])!;
      const values: Line = t.map((time) => (closes.has(time) ? closes.get(time)! * ratio : null));
      return [{ symbol: other.symbol, color: other.color, values, base }];
    });

    // The analysis reads the candles on screen, with tolerances in average ranges.
    const series = { t, o, h, l, c };
    const atrs = ranges.slice(from, to);
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
      ...(showSma ? smaLines.flatMap((line) => line.values.filter((value): value is number => value != null)) : []),
      ...(showBands && bands ? [...bands.upper, ...bands.lower].filter((value): value is number => value != null) : []),
      ...(showCloud && cloud ? [...cloud.spanA, ...cloud.spanB].filter((value): value is number => value != null) : []),
      ...(extra ? [
        ...(extra.keltner ? [...extra.keltner.upper, ...extra.keltner.lower] : []),
        ...(extra.donchian ? [...extra.donchian.upper, ...extra.donchian.lower] : []),
        ...(extra.supertrend ? extra.supertrend.line : []),
        ...(extra.psar ? extra.psar.line : []),
        ...(extra.hma ?? []),
      ].filter((value): value is number => value != null) : []),
      ...compared.flatMap((line) => line.values.filter((value): value is number => value != null)),
    ], compact ? 5 : 6);
    if (!scale) return null;
    const slot = W / count;
    const x = (index: number) => (index + 0.5) * slot;
    // A logarithmic axis needs every price above zero; without that it stays linear.
    const log = logScale && scale.min > 0;
    const lnMin = Math.log(Math.max(scale.min, 1e-9));
    const lnMax = Math.log(Math.max(scale.max, 1e-9));
    const y = log
      ? (value: number) => H - ((Math.log(Math.max(value, 1e-9)) - lnMin) / (lnMax - lnMin)) * H
      : (value: number) => H - ((value - scale.min) / (scale.max - scale.min)) * H;
    /** The price at a height on the plot, as a fraction from the top. */
    const priceAt = log
      ? (fraction: number) => Math.exp(lnMax - fraction * (lnMax - lnMin))
      : (fraction: number) => scale.max - fraction * (scale.max - scale.min);
    const ticks = log ? logTicks(scale.min, scale.max, compact ? 5 : 7) : scale.ticks;
    const profile = studies.has("vprofile") && volume ? volumeProfile({ t, o, h, l, c, v: volume }, scale.min, scale.max, compact ? 16 : 24) : null;
    return {
      t, o, h, l, c, drawn, extra, lines, smaLines, bands, cloud, vwapLine, patterns, compared, profile, momentum, volume, analysis,
      scale, ticks, priceAt, log, slot, x, y, count, end, from, total, key: seriesKey,
      previous: from > 0 ? candles.c[from - 1] : null,
    };
  }, [candles, averages, indicators, ranges, interval, width, showEma, showSma, showBands, showCloud, showExtension, compact, windowed, logScale, compare, benchmark, studies, seriesKey, openOn]);

  useEffect(() => {
    latest.current = view ? { key: view.key, count: view.count, end: view.end, total: view.total, from: view.from } : null;
  }, [view]);

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
  const pointerPrice = pointer && view ? view.priceAt(pointer.y) : null;

  /*
   * Drawing. A press starts a line where the pointer is, a drag stretches it,
   * a release keeps it; a level needs only the press. Positions become a date
   * and a price at once, so nothing drawn depends on this screen's width.
   */
  const drawing = onDrawingsChange != null && tool !== "cursor";
  const [draft, setDraft] = useState<Drawing | null>(null);
  const anchorAt = (event: ReactPointerEvent<HTMLDivElement>): Anchor | null => {
    if (!view) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const index = ((event.clientX - box.left) / box.width) * view.count - 0.5;
    const y = (event.clientY - box.top) / box.height;
    return { t: timeOfIndex(view.t, index), p: view.priceAt(y) };
  };
  const screenOf = (anchor: Anchor) => (view ? { x: view.x(indexOfTime(view.t, anchor.t)), y: view.y(anchor.p) } : { x: 0, y: 0 });
  /*
   * Panning: a press with the cursor tool holds the chart, and the drag moves
   * the window by as many candles as the pointer travelled.
   */
  const pan = useRef<{ x: number; end: number; count: number; width: number } | null>(null);
  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing && zoomable && view && event.button === 0) {
      pan.current = { x: event.clientX, end: view.end, count: view.count, width: event.currentTarget.getBoundingClientRect().width };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!drawing || !view || !onDrawingsChange) return;
    const anchor = anchorAt(event);
    if (!anchor) return;
    event.preventDefault();
    if (tool === "erase") {
      const box = event.currentTarget.getBoundingClientRect();
      const toPixels = (at: Anchor) => { const point = screenOf(at); return { x: (point.x / W) * box.width, y: (point.y / H) * box.height }; };
      const hit = drawingAt(drawings ?? [], { x: event.clientX - box.left, y: event.clientY - box.top }, toPixels, 8);
      if (hit) onDrawingsChange((drawings ?? []).filter((item) => item.id !== hit.id));
      return;
    }
    if (tool === "hline") {
      onDrawingsChange([...(drawings ?? []), { id: newId(), kind: "hline", a: anchor, b: anchor }]);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ id: newId(), kind: tool, a: anchor, b: anchor });
  };
  const onDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointer(event);
    if (pan.current && view) {
      const held = pan.current;
      const moved = ((event.clientX - held.x) / held.width) * held.count;
      setZoom({ key: view.key, count: held.count, end: Math.min(Math.max(0, held.end + moved), view.total - held.count) });
      return;
    }
    if (!draft) return;
    const anchor = anchorAt(event);
    if (anchor) setDraft({ ...draft, b: anchor });
  };
  const onUp = () => {
    pan.current = null;
    if (!draft || !onDrawingsChange) return;
    const a = screenOf(draft.a);
    const b = screenOf(draft.b);
    // A click without a drag is not a line.
    if (Math.hypot(a.x - b.x, a.y - b.y) > 4) onDrawingsChange([...(drawings ?? []), draft]);
    setDraft(null);
  };
  const shown = [...(drawings ?? []), ...(draft ? [draft] : [])];

  const at = view ? Math.min(hover ?? view.count - 1, view.count - 1) : null;
  const baseOf = (index: number) => (!view ? null : index > 0 ? view.c[index - 1] : view.previous);
  const before = at != null ? baseOf(at) : null;
  const move = view && at != null && before != null ? view.c[at] - before : null;
  const last = view ? view.count - 1 : 0;
  const lastBase = baseOf(last);
  const lastMove = view && lastBase != null ? view.c[last] - lastBase : null;

  return (
  <figure
    className="candle-chart" data-size={compact ? "compact" : undefined} aria-label={label}
    // How many lower panes are open, so a page with a fixed height can give the candles what is left.
    style={{ "--panes": panes.length } as React.CSSProperties}
  >
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
          {showVwap ? (
            <span className="candle-legend-ema">
              <i style={{ background: VWAP_COLOR }} aria-hidden="true" />{isIntraday(interval) ? "VWAP" : "AVWAP"} <b>{price(view.vwapLine[at])}</b>
            </span>
          ) : null}
          {view.compared.map((line) => {
            // Each line's move since the first candle both have, so the two read as returns.
            const own = view.c[line.base];
            const value = line.values[at];
            return (
              <span key={line.symbol} className="candle-legend-ema">
                <i style={{ background: line.color }} aria-hidden="true" />{line.symbol}{" "}
                <b data-tone={value == null ? undefined : tone(value - own)}>{value == null ? "—" : percent(value / own - 1)}</b>
                {" "}vs <b data-tone={tone(view.c[at] - own)}>{percent(view.c[at] / own - 1)}</b>
              </span>
            );
          })}
          {view.log ? <span className="dim">LOG</span> : null}
        </>
      ) : null}
    </div>}

    <div className="candle-body">
      <div
        className="candle-plot" ref={plotRef} data-tool={drawing ? tool : undefined}
        data-zoomable={zoomable || undefined}
        onPointerMove={onDrag} onPointerLeave={() => setPointer(null)} onPointerDown={onDown} onPointerUp={onUp}
        onPointerCancel={() => { setDraft(null); pan.current = null; }}
        onDoubleClick={() => { if (zoomable && !drawing) setZoom(null); }}
      >
        {view ? (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {view.ticks.map((tick) => (
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
            {view.drawn.c.map((close, index) => {
              const open = view.drawn.o[index];
              const top = view.y(Math.max(open, close));
              const bottom = view.y(Math.min(open, close));
              const width = view.slot * 0.64;
              return (
                <g key={view.t[index]} className={close >= open ? "candle-up" : "candle-down"}>
                  <line x1={view.x(index)} x2={view.x(index)} y1={view.y(view.drawn.h[index])} y2={view.y(view.drawn.l[index])} vectorEffect="non-scaling-stroke" />
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
            {showSma ? view.smaLines.map((line) => {
              const path = pathOf(line.values, view.x, view.y);
              return path ? <path key={`sma-${line.period}`} className="candle-ema" d={path} style={{ stroke: SMA_COLORS[line.period] }} vectorEffect="non-scaling-stroke" /> : null;
            }) : null}
            {showBands && view.bands ? (
              <g className="study-bands" style={{ stroke: BAND_COLOR, fill: BAND_COLOR }}>
                <path className="study-band-fill" d={bandPath(view.bands.upper, view.bands.lower, view.x, view.y)} />
                <path className="study-band-edge" d={pathOf(view.bands.upper, view.x, view.y)} vectorEffect="non-scaling-stroke" />
                <path className="study-band-edge" d={pathOf(view.bands.lower, view.x, view.y)} vectorEffect="non-scaling-stroke" />
                <path className="study-band-middle" d={pathOf(view.bands.middle, view.x, view.y)} vectorEffect="non-scaling-stroke" />
              </g>
            ) : null}
            {showCloud && view.cloud ? (
              <g className="study-cloud">
                <path className="study-cloud-fill" d={bandPath(view.cloud.spanA, view.cloud.spanB, view.x, view.y)} style={{ fill: CLOUD_COLOR }} />
                <path className="study-cloud-edge" d={pathOf(view.cloud.spanA, view.x, view.y)} style={{ stroke: CLOUD_COLOR }} vectorEffect="non-scaling-stroke" />
                <path className="study-cloud-edge" d={pathOf(view.cloud.spanB, view.x, view.y)} style={{ stroke: KIJUN_COLOR }} vectorEffect="non-scaling-stroke" />
                <path className="candle-ema" d={pathOf(view.cloud.tenkan, view.x, view.y)} style={{ stroke: TENKAN_COLOR }} vectorEffect="non-scaling-stroke" />
                <path className="candle-ema" d={pathOf(view.cloud.kijun, view.x, view.y)} style={{ stroke: KIJUN_COLOR }} vectorEffect="non-scaling-stroke" />
              </g>
            ) : null}
            {showVwap ? <path className="candle-ema study-vwap" d={pathOf(view.vwapLine, view.x, view.y)} style={{ stroke: VWAP_COLOR }} vectorEffect="non-scaling-stroke" /> : null}
            {view.extra?.keltner ? (
              <g className="study-bands" style={{ stroke: KELTNER_COLOR, fill: KELTNER_COLOR }}>
                <path className="study-band-fill" d={bandPath(view.extra.keltner.upper, view.extra.keltner.lower, view.x, view.y)} />
                <path className="study-band-edge" d={pathOf(view.extra.keltner.upper, view.x, view.y)} vectorEffect="non-scaling-stroke" />
                <path className="study-band-edge" d={pathOf(view.extra.keltner.lower, view.x, view.y)} vectorEffect="non-scaling-stroke" />
                <path className="study-band-middle" d={pathOf(view.extra.keltner.middle, view.x, view.y)} vectorEffect="non-scaling-stroke" />
              </g>
            ) : null}
            {view.extra?.donchian ? (
              <g className="study-bands" style={{ stroke: DONCHIAN_COLOR, fill: DONCHIAN_COLOR }}>
                <path className="study-band-fill" d={bandPath(view.extra.donchian.upper, view.extra.donchian.lower, view.x, view.y)} />
                <path className="study-band-edge" d={pathOf(view.extra.donchian.upper, view.x, view.y)} vectorEffect="non-scaling-stroke" />
                <path className="study-band-edge" d={pathOf(view.extra.donchian.lower, view.x, view.y)} vectorEffect="non-scaling-stroke" />
                <path className="study-band-middle" d={pathOf(view.extra.donchian.middle, view.x, view.y)} vectorEffect="non-scaling-stroke" />
              </g>
            ) : null}
            {view.extra?.hma ? <path className="candle-ema" d={pathOf(view.extra.hma, view.x, view.y)} style={{ stroke: HMA_COLOR }} vectorEffect="non-scaling-stroke" /> : null}
            {view.extra?.supertrend ? (() => {
              const trail = view.extra.supertrend;
              const side = (want: boolean) => pathOf(trail.line.map((value, index) => (trail.up[index] === want ? value : null)), view.x, view.y);
              return (
                <g className="study-supertrend">
                  <path className="study-trail-up" d={side(true)} vectorEffect="non-scaling-stroke" />
                  <path className="study-trail-down" d={side(false)} vectorEffect="non-scaling-stroke" />
                </g>
              );
            })() : null}
            {view.extra?.psar ? (
              <g className="study-psar">
                {view.extra.psar.line.map((value, index) => (value == null ? null : (
                  <line key={index} className={view.extra!.psar!.up[index] ? "study-trail-up" : "study-trail-down"}
                    x1={view.x(index) - view.slot * 0.18} x2={view.x(index) + view.slot * 0.18} y1={view.y(value)} y2={view.y(value)} vectorEffect="non-scaling-stroke" />
                )))}
              </g>
            ) : null}
            {view.extra?.pivots ? (
              <g className="study-pivots" style={{ stroke: PIVOT_COLOR }}>
                {(["r3", "r2", "r1", "p", "s1", "s2", "s3"] as const).map((key) => {
                  const level = view.extra!.pivots![key];
                  if (level < view.scale.min || level > view.scale.max) return null;
                  return <line key={key} data-level={key} x1={0} x2={W} y1={view.y(level)} y2={view.y(level)} vectorEffect="non-scaling-stroke" />;
                })}
              </g>
            ) : null}
            {view.compared.map((line) => (
              <path key={`cmp-${line.symbol}`} className="candle-ema study-compare" d={pathOf(line.values, view.x, view.y)} style={{ stroke: line.color }} vectorEffect="non-scaling-stroke" />
            ))}
            {view.profile ? (() => {
              const most = Math.max(...view.profile.map((bin) => bin.volume), 1);
              return (
                <g className="study-profile">
                  {view.profile.map((bin, index) => {
                    const top = view.y(bin.high);
                    const width = (bin.volume / most) * W * 0.22;
                    return (
                      <rect
                        key={index} className={bin.volume === most ? "study-profile-poc" : undefined}
                        x={W - width} width={width} y={top} height={Math.max(view.y(bin.low) - top - 0.5, 0.5)}
                      />
                    );
                  })}
                </g>
              );
            })() : null}
            {shown.length ? (
              <g className="drawings" clipPath={`url(#${clipId})`}>
                {shown.map((item) => {
                  const a = screenOf(item.a);
                  const b = screenOf(item.b);
                  const key = item.id + (item === draft ? "-draft" : "");
                  if (item.kind === "hline") return <line key={key} className="drawing" x1={0} x2={W} y1={a.y} y2={a.y} vectorEffect="non-scaling-stroke" />;
                  if (item.kind === "trend") return <line key={key} className="drawing" x1={a.x} x2={b.x} y1={a.y} y2={b.y} vectorEffect="non-scaling-stroke" />;
                  if (item.kind === "rect") {
                    return <rect key={key} className="drawing drawing-zone" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} vectorEffect="non-scaling-stroke" />;
                  }
                  return (
                    <g key={key}>
                      <line className="drawing drawing-swing" x1={a.x} x2={b.x} y1={a.y} y2={b.y} vectorEffect="non-scaling-stroke" />
                      {DRAWN_FIB_RATIOS.map((ratio) => {
                        const y = b.y + (a.y - b.y) * ratio;
                        return <line key={ratio} className="drawing drawing-fib" x1={Math.min(a.x, b.x)} x2={W} y1={y} y2={y} vectorEffect="non-scaling-stroke" />;
                      })}
                    </g>
                  );
                })}
              </g>
            ) : null}
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
            {view.patterns ? view.patterns.flatMap((found, index) => found.map((pattern, stack) => {
              const meaning = PATTERN_NAMES[pattern];
              const below = meaning.bullish !== false;
              const y = below ? view.y(view.l[index]) : view.y(view.h[index]);
              return (
                <span
                  key={`pattern-${index}-${pattern}`} className={below ? "study-pattern study-pattern-below" : "study-pattern"}
                  data-tone={meaning.bullish == null ? undefined : meaning.bullish ? "good" : "bad"} title={meaning.name}
                  style={{ left: pct(view.x(index), W), top: `calc(${pct(y, H)} ${below ? "+" : "-"} ${4 + stack * 11}px)` }}
                >
                  {meaning.short}
                </span>
              );
            })) : null}
            {shown.filter((item) => item.kind === "fib").flatMap((item) => {
              const a = screenOf(item.a);
              const b = screenOf(item.b);
              return DRAWN_FIB_RATIOS.map((ratio) => {
                const y = b.y + (a.y - b.y) * ratio;
                return (
                  <span key={`${item.id}-${ratio}`} className={`drawing-note ${noteSide(Math.min(a.x, b.x)) ?? ""}`} style={noteAt(Math.min(a.x, b.x), y)}>
                    {ratioText(ratio)} {price(item.b.p + (item.a.p - item.b.p) * ratio)}
                  </span>
                );
              });
            })}
          </div>
        ) : null}
        {loading || error || (!view && candles) ? (
          <div className="candle-state">{loading ? "Loading…" : error ?? "Not enough history to draw."}</div>
        ) : null}
      </div>

      <div className="candle-axis" aria-hidden="true">
        {view ? (
          <>
            {view.ticks.map((tick) => (
              <span key={tick} style={{ top: `${(view.y(tick) / H) * 100}%` }}>{price(tick)}</span>
            ))}
            <span className="candle-tag" data-tone={tone(lastMove)} style={{ top: `${(view.y(view.c[last]) / H) * 100}%` }}>
              {price(view.c[last])}
            </span>
            {shown.filter((item) => item.kind === "hline").map((item) => (
              <span key={`tag-${item.id}`} className="candle-tag drawing-tag" style={{ top: `${(view.y(item.a.p) / H) * 100}%` }}>{price(item.a.p)}</span>
            ))}
            {pointer && pointerPrice != null ? (
              <span className="candle-tag candle-cross" style={{ top: `${pointer.y * 100}%` }}>{price(pointerPrice)}</span>
            ) : null}
          </>
        ) : null}
      </div>
    </div>

    {view && view.momentum ? panes.map((pane) => (
      (EXTRA_PANES as Pane[]).includes(pane)
        ? <ExtraLowerPane key={pane} pane={pane as ExtraPane} view={view as PaneView} panes={view.extra?.panes ?? null} at={at} hover={hover} />
        : <LowerPane key={pane} pane={pane} view={view as PaneView} at={at} hover={hover} />
    )) : null}

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

/** A line through the values that exist, broken where they do not. */
function pathOf(values: Line, x: (index: number) => number, y: (value: number) => number): string {
  let path = "";
  let open = false;
  values.forEach((value, index) => {
    if (value == null) { open = false; return; }
    path += `${open ? "L" : "M"}${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
    open = true;
  });
  return path;
}

/** The area between two lines, over the stretch where both exist. */
function bandPath(upper: Line, lower: Line, x: (index: number) => number, y: (value: number) => number): string {
  const indices = upper.map((value, index) => (value != null && lower[index] != null ? index : -1)).filter((index) => index >= 0);
  if (indices.length < 2) return "";
  const top = indices.map((index, position) => `${position ? "L" : "M"}${x(index).toFixed(2)} ${y(upper[index]!).toFixed(2)}`).join("");
  const bottom = [...indices].reverse().map((index) => `L${x(index).toFixed(2)} ${y(lower[index]!).toFixed(2)}`).join("");
  return `${top}${bottom}Z`;
}

const PANE_NAMES: Record<Pane, string> = {
  volume: "VOL", rsi: "RSI 14", macd: "MACD 12 26 9", stoch: "STOCH 14 3 3", atr: "ATR 14", rs: "RS vs S&P 500",
  adx: "ADX 14 · +DI · −DI", squeeze: "SQUEEZE 20", stochrsi: "STOCH RSI 14 3 3", willr: "WILLIAMS %R 14", cci: "CCI 20",
  roc: "ROC 12", aroon: "AROON 25 · up · down", obv: "OBV", cmf: "CMF 20", mfi: "MFI 14",
};

interface PaneView {
  count: number;
  slot: number;
  x: (index: number) => number;
  o: number[];
  c: number[];
  volume: number[] | null;
  momentum: { rsi: Line; macd: Line; signal: Line; histogram: Line; stochK: Line; stochD: Line; atr: Array<number | null>; rs: Line };
}

const compactNumber = (value: number) =>
  Math.abs(value) >= 1e9 ? `${(value / 1e9).toFixed(1)}B` : Math.abs(value) >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : Math.abs(value) >= 1e3 ? `${(value / 1e3).toFixed(0)}K` : value.toFixed(0);

/**
 * A study with a scale of its own, under the candles and on their x.
 *
 * Volume as bars in the colour of their candle; RSI between its 30 and 70
 * lines; MACD as its line, its signal and the histogram of the gap. Each reads
 * out the value at the candle the crosshair is on, or the last one.
 */
function LowerPane({ pane, view, at, hover }: { pane: Pane; view: PaneView; at: number | null; hover: number | null }) {
  const { momentum } = view;
  let body: React.ReactNode = null;
  let ticks: { value: number; text: string }[] = [];
  let readout: React.ReactNode = null;
  let y: (value: number) => number = () => 0;

  if (pane === "volume" && view.volume) {
    const volume = view.volume;
    const top = Math.max(...volume, 1);
    y = (value) => PANE_H - (value / top) * PANE_H * 0.92;
    body = volume.map((value, index) => (
      <rect
        key={index} className={view.c[index] >= view.o[index] ? "pane-up" : "pane-down"}
        x={view.x(index) - view.slot * 0.32} width={view.slot * 0.64} y={y(value)} height={PANE_H - y(value)}
      />
    ));
    ticks = [{ value: top, text: compactNumber(top) }];
    readout = at != null ? <b>{compactNumber(volume[at])}</b> : null;
  }

  if (pane === "rsi") {
    y = (value) => PANE_H - (value / 100) * PANE_H;
    const path = pathOf(momentum.rsi, view.x, y);
    body = (
      <>
        <rect className="pane-zone" x={0} width={W} y={y(70)} height={y(30) - y(70)} />
        {[30, 70].map((level) => <line key={level} className="pane-guide" x1={0} x2={W} y1={y(level)} y2={y(level)} vectorEffect="non-scaling-stroke" />)}
        {path ? <path className="pane-line pane-rsi" d={path} vectorEffect="non-scaling-stroke" /> : null}
      </>
    );
    ticks = [70, 30].map((value) => ({ value, text: String(value) }));
    const value = at != null ? momentum.rsi[at] : null;
    readout = value != null ? <b data-tone={value >= 70 ? "bad" : value <= 30 ? "good" : undefined}>{value.toFixed(1)}</b> : null;
  }

  if (pane === "macd") {
    const values = [...momentum.macd, ...momentum.signal, ...momentum.histogram].filter((value): value is number => value != null);
    const reach = Math.max(...values.map(Math.abs), 1e-9);
    y = (value) => PANE_H / 2 - (value / reach) * (PANE_H / 2) * 0.9;
    const macdPath = pathOf(momentum.macd, view.x, y);
    const signalPath = pathOf(momentum.signal, view.x, y);
    body = (
      <>
        <line className="pane-guide" x1={0} x2={W} y1={y(0)} y2={y(0)} vectorEffect="non-scaling-stroke" />
        {momentum.histogram.map((value, index) => (value == null ? null : (
          <rect
            key={index} className={value >= 0 ? "pane-up" : "pane-down"}
            x={view.x(index) - view.slot * 0.32} width={view.slot * 0.64} y={Math.min(y(value), y(0))} height={Math.abs(y(value) - y(0))}
          />
        )))}
        {macdPath ? <path className="pane-line pane-macd" d={macdPath} vectorEffect="non-scaling-stroke" /> : null}
        {signalPath ? <path className="pane-line pane-signal" d={signalPath} vectorEffect="non-scaling-stroke" /> : null}
      </>
    );
    ticks = [{ value: 0, text: "0" }];
    if (at != null && momentum.macd[at] != null && momentum.signal[at] != null) {
      readout = (
        <>
          <b className="pane-macd-text">{momentum.macd[at]!.toFixed(2)}</b>
          <b className="pane-signal-text">{momentum.signal[at]!.toFixed(2)}</b>
          <b data-tone={tone(momentum.histogram[at])}>{momentum.histogram[at]!.toFixed(2)}</b>
        </>
      );
    }
  }

  if (pane === "stoch") {
    y = (value) => PANE_H - (value / 100) * PANE_H;
    const k = pathOf(momentum.stochK, view.x, y);
    const d = pathOf(momentum.stochD, view.x, y);
    body = (
      <>
        <rect className="pane-zone" x={0} width={W} y={y(80)} height={y(20) - y(80)} />
        {[20, 80].map((level) => <line key={level} className="pane-guide" x1={0} x2={W} y1={y(level)} y2={y(level)} vectorEffect="non-scaling-stroke" />)}
        {k ? <path className="pane-line pane-macd" d={k} vectorEffect="non-scaling-stroke" /> : null}
        {d ? <path className="pane-line pane-signal" d={d} vectorEffect="non-scaling-stroke" /> : null}
      </>
    );
    ticks = [80, 20].map((value) => ({ value, text: String(value) }));
    if (at != null && momentum.stochK[at] != null) {
      readout = (
        <>
          <b className="pane-macd-text">{momentum.stochK[at]!.toFixed(1)}</b>
          {momentum.stochD[at] != null ? <b className="pane-signal-text">{momentum.stochD[at]!.toFixed(1)}</b> : null}
        </>
      );
    }
  }

  if (pane === "rs") {
    const values = momentum.rs.filter((value): value is number => value != null);
    const top = Math.max(...values, 100);
    const bottom = Math.min(...values, 100);
    y = (value) => PANE_H - ((value - bottom) / (top - bottom || 1)) * PANE_H * 0.86 - PANE_H * 0.07;
    const path = pathOf(momentum.rs, view.x, y);
    const last = values.at(-1) ?? null;
    body = (
      <>
        <line className="pane-guide" x1={0} x2={W} y1={y(100)} y2={y(100)} vectorEffect="non-scaling-stroke" />
        {path ? <path className="pane-line pane-rs" d={path} data-tone={last != null && last >= 100 ? "good" : "bad"} vectorEffect="non-scaling-stroke" /> : null}
      </>
    );
    ticks = [{ value: 100, text: "100" }];
    const value = at != null ? momentum.rs[at] : null;
    readout = value != null ? <b data-tone={value >= 100 ? "good" : "bad"}>{(value - 100 >= 0 ? "+" : "−") + Math.abs(value - 100).toFixed(1)}%</b> : null;
  }

  if (pane === "atr") {
    const values = momentum.atr.filter((value): value is number => value != null);
    const top = Math.max(...values, 1e-9);
    const bottom = Math.min(...values, top);
    y = (value) => PANE_H - ((value - bottom) / (top - bottom || 1)) * PANE_H * 0.85 - PANE_H * 0.07;
    const path = pathOf(momentum.atr, view.x, y);
    body = path ? <path className="pane-line pane-rsi" d={path} vectorEffect="non-scaling-stroke" /> : null;
    ticks = [{ value: top, text: price(top) }];
    readout = at != null && momentum.atr[at] != null ? <b>{price(momentum.atr[at])}</b> : null;
  }

  if (!body) return null;
  return (
    <div className="candle-pane" data-pane={pane}>
      <div className="candle-pane-plot">
        <span className="candle-pane-name">{PANE_NAMES[pane]} {readout}</span>
        <svg viewBox={`0 0 ${W} ${PANE_H}`} preserveAspectRatio="none" aria-hidden="true">
          {body}
          {hover != null ? <line className="candle-cursor" x1={view.x(hover)} x2={view.x(hover)} y1={0} y2={PANE_H} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
      </div>
      <div className="candle-axis" aria-hidden="true">
        {ticks.map((tick) => <span key={tick.value} style={{ top: `${(y(tick.value) / PANE_H) * 100}%` }}>{tick.text}</span>)}
      </div>
    </div>
  );
}


type ExtraPanes = {
  adx: { adx: Line; plus: Line; minus: Line } | null;
  squeeze: { on: Array<boolean | null>; momentum: Line } | null;
  stochrsi: { k: Line; d: Line } | null;
  willr: Line | null; cci: Line | null; roc: Line | null;
  aroon: { up: Line; down: Line } | null;
  obv: Line | null; cmf: Line | null; mfi: Line | null;
};

/**
 * The toolkit's lower panes (lib/io/indicators-extra.ts), drawn by one
 * description each: their lines, the levels that mean something on their
 * scale, and a histogram where the indicator is one.
 */
function ExtraLowerPane({ pane, view, panes, at, hover }: { pane: ExtraPane; view: PaneView; panes: ExtraPanes | null; at: number | null; hover: number | null }) {
  if (!panes) return null;
  type Spec = { lines: Array<{ values: Line; className: string }>; bars?: Line; dots?: Array<boolean | null>; range: [number, number] | null; guides: number[]; zone?: [number, number]; format: (value: number) => string };
  const fixed = (places: number) => (value: number) => value.toFixed(places);
  let spec: Spec | null = null;
  if (pane === "adx" && panes.adx) spec = { lines: [{ values: panes.adx.adx, className: "pane-rsi" }, { values: panes.adx.plus, className: "pane-up-line" }, { values: panes.adx.minus, className: "pane-down-line" }], range: [0, 60], guides: [20, 40], format: fixed(1) };
  if (pane === "squeeze" && panes.squeeze) spec = { lines: [], bars: panes.squeeze.momentum, dots: panes.squeeze.on, range: null, guides: [0], format: fixed(2) };
  if (pane === "stochrsi" && panes.stochrsi) spec = { lines: [{ values: panes.stochrsi.k, className: "pane-macd" }, { values: panes.stochrsi.d, className: "pane-signal" }], range: [0, 100], guides: [20, 80], zone: [20, 80], format: fixed(1) };
  if (pane === "willr" && panes.willr) spec = { lines: [{ values: panes.willr, className: "pane-rsi" }], range: [-100, 0], guides: [-80, -20], zone: [-80, -20], format: fixed(1) };
  if (pane === "cci" && panes.cci) spec = { lines: [{ values: panes.cci, className: "pane-rsi" }], range: null, guides: [-100, 0, 100], zone: [-100, 100], format: fixed(0) };
  if (pane === "roc" && panes.roc) spec = { lines: [{ values: panes.roc, className: "pane-rsi" }], range: null, guides: [0], format: (value) => `${value.toFixed(2)}%` };
  if (pane === "aroon" && panes.aroon) spec = { lines: [{ values: panes.aroon.up, className: "pane-up-line" }, { values: panes.aroon.down, className: "pane-down-line" }], range: [0, 100], guides: [30, 70], format: fixed(0) };
  if (pane === "obv" && panes.obv) spec = { lines: [{ values: panes.obv, className: "pane-rsi" }], range: null, guides: [], format: compactNumber };
  if (pane === "cmf" && panes.cmf) spec = { lines: [], bars: panes.cmf, range: null, guides: [0], format: fixed(3) };
  if (pane === "mfi" && panes.mfi) spec = { lines: [{ values: panes.mfi, className: "pane-rsi" }], range: [0, 100], guides: [20, 80], zone: [20, 80], format: fixed(1) };
  if (!spec) return null;

  const values = [...spec.lines.flatMap((line) => line.values), ...(spec.bars ?? []), ...spec.guides].filter((value): value is number => value != null && Number.isFinite(value));
  if (!values.length) return null;
  const [bottom, top] = spec.range ?? [Math.min(...values), Math.max(...values)];
  const y = (value: number) => PANE_H - ((value - bottom) / (top - bottom || 1)) * PANE_H * 0.86 - PANE_H * 0.07;
  const zero = y(Math.min(Math.max(0, bottom), top));
  const readouts = spec.lines.map((line) => (at != null ? line.values[at] : null));
  const barAt = at != null && spec.bars ? spec.bars[at] : null;
  return (
    <div className="candle-pane" data-pane={pane}>
      <div className="candle-pane-plot">
        <span className="candle-pane-name">
          {PANE_NAMES[pane]}{" "}
          {readouts.map((value, index) => (value == null ? null : <b key={index} className={`${spec!.lines[index].className}-text`}>{spec!.format(value)} </b>))}
          {barAt != null ? <b data-tone={barAt >= 0 ? "good" : "bad"}>{spec.format(barAt)}</b> : null}
          {pane === "squeeze" && at != null && spec.dots?.[at] != null ? <b data-tone={spec.dots[at] ? "bad" : "good"}> {spec.dots[at] ? "on" : "fired"}</b> : null}
        </span>
        <svg viewBox={`0 0 ${W} ${PANE_H}`} preserveAspectRatio="none" aria-hidden="true">
          {spec.zone ? <rect className="pane-zone" x={0} width={W} y={y(spec.zone[1])} height={y(spec.zone[0]) - y(spec.zone[1])} /> : null}
          {spec.guides.map((level) => <line key={level} className="pane-guide" x1={0} x2={W} y1={y(level)} y2={y(level)} vectorEffect="non-scaling-stroke" />)}
          {spec.bars ? spec.bars.map((value, index) => (value == null ? null : (
            <rect key={index} className={value >= 0 ? "pane-up" : "pane-down"}
              x={view.x(index) - view.slot * 0.32} width={view.slot * 0.64} y={Math.min(y(value), zero)} height={Math.max(Math.abs(y(value) - zero), 0.5)} />
          ))) : null}
          {spec.dots ? spec.dots.map((on, index) => (on == null ? null : (
            <line key={`d${index}`} className={on ? "pane-squeeze-on" : "pane-squeeze-off"} x1={view.x(index) - view.slot * 0.2} x2={view.x(index) + view.slot * 0.2} y1={zero} y2={zero} vectorEffect="non-scaling-stroke" />
          ))) : null}
          {spec.lines.map((line, index) => {
            const path = pathOf(line.values, view.x, y);
            return path ? <path key={index} className={`pane-line ${line.className}`} d={path} vectorEffect="non-scaling-stroke" /> : null;
          })}
          {hover != null ? <line className="candle-cursor" x1={view.x(hover)} x2={view.x(hover)} y1={0} y2={PANE_H} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
      </div>
      <div className="candle-axis" aria-hidden="true">
        {(spec.range ? spec.guides : [top, bottom]).map((value) => <span key={value} style={{ top: `${(y(value) / PANE_H) * 100}%` }}>{spec!.format(value)}</span>)}
      </div>
    </div>
  );
}
