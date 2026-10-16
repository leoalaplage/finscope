"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CANDLE_INTERVALS, isIntraday, type Candles, type CandleInterval } from "@/lib/adapters/candles";
import { candlesToShow, dateLabels, dateText, INTERVAL_NAMES, INTERVAL_TITLES, priceScale } from "@/lib/io/candle-chart";
import { bollinger, ema, ichimoku, macd, patternsAt, PATTERN_NAMES, rsi, sma, stochastic, volumeProfile, vwap, type Line } from "@/lib/io/indicators";
import {
  adx, aroon, chaikinMoneyFlow, cci, donchian, floorPivots, heikinAshi, hullMa, keltner, moneyFlowIndex, obv,
  parabolicSar, roc, squeeze, stochRsi, supertrend, williamsR, type Pivots,
} from "@/lib/io/indicators-extra";
import { CHART_PATTERN_NAMES, chartPatterns } from "@/lib/io/chart-patterns";
import {
  anchoredVwap, channelOffset, DEFAULT_DRAWING_COLOR, FIB_EXTENSION_RATIOS, pitchforkLines, regressionOver, THREE_POINTS, DRAWING_COLORS, DRAWN_FIB_RATIOS, drawingAt, handleAnchor, handlesOf, indexOfTime, lineReach, mapAnchors,
  ONE_CLICK, positionAround, positionFigures, timeOfIndex, withHandle, type Anchor, type Drawing, type HandleKey, type LineStyle, type Tool,
} from "@/lib/term/drawings";
import { paramsOf, studyName, type StudyParams } from "@/lib/io/study-params";
import { useChartEvents } from "./chart-events";
import { canAlert } from "./line-alerts";
import { publishCross, releaseCross, useSharedCross } from "./crosshair-sync";
import { setPaneHeight, usePaneHeights } from "./pane-heights";
import { clampViewport, panBy, rightMargin, shiftRange, stretchRange, ticksFor, windowOf, zoomAround, type Viewport } from "@/lib/io/chart-view";
import {
  averageTrueRange, fairValueGaps, fibonacci, marketStructure, PIVOT_SPAN, pivots, priceOnLine,
  supportResistance, trendLines, type Study,
} from "@/lib/io/technicals";

/**
 * Candles, drawn here, wherever the site shows them: the chart page, a
 * company's price section, the charts under the watchlist.
 *
 * An SVG in a fixed box stretched to the container, strokes that keep their
 * width, and every word in HTML over it (see Plot.tsx), with a crosshair that
 * reads out the candle and the price under the pointer. Where it may move,
 * the chart pans and zooms freely as on the desk platforms
 * (lib/io/chart-view.ts): a drag moves it both ways, past the last candle
 * too; a drag on the price axis stretches it, on the dates compresses it. The studies passed in are drawn over the candles
 * (lib/io/technicals.ts); a compact chart draws fewer ticks and dates, no
 * legend, and allows narrower candles so three fit side by side.
 */

const W = 1000;
const H = 460;

/** The averages' colours, fastest first, whatever periods the reader set. */
const EMA_COLORS = ["#e8a33d", "#4c8dff", "#b06cf0"];

const COMPACT_CANDLE_PX = 1.6;

/** The simple averages, the ones a golden cross is read from, fastest first. */
const SMA_COLORS = ["#3fb7c9", "#e05fa0"];
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
export function useCandles(symbol: string, interval: CandleInterval, enabled = true, refreshMs = 0) {
  const key = `${symbol}:${interval}`;
  const [load, setLoad] = useState<CandleLoad>({ key: "", candles: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const read = () => fetch(`/api/candles/${encodeURIComponent(symbol)}?interval=${interval}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as Partial<Candles> & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
        if (!body.t?.length) throw new Error(`No price history for ${symbol}.`);
        if (!controller.signal.aborted) setLoad({ key, candles: body as Candles, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad((current) => current.key === key && current.candles ? current : { key, candles: null, error: error instanceof Error ? error.message : "Unreachable." });
      });
    void read();
    const timer = refreshMs > 0 ? setInterval(read, refreshMs) : null;
    return () => { controller.abort(); if (timer != null) clearInterval(timer); };
  }, [key, symbol, interval, enabled, refreshMs]);

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
const NO_DRAWINGS: Drawing[] = [];
const NO_TIMES: number[] = [];

/** What an instrument is called in a chart's watermark: a company by its ticker, an index, a future or a coin by a short name. */
const WATERMARKS: Record<string, string> = {
  "^GSPC": "S&P 500", "^IXIC": "NASDAQ", "^NDX": "NASDAQ 100", "^DJI": "DOW", "^RUT": "RUSSELL 2000", "^VIX": "VIX", "^TNX": "US 10Y",
  "ES=F": "S&P FUT", "NQ=F": "NASDAQ FUT", "YM=F": "DOW FUT", "RTY=F": "RUSSELL FUT", "CL=F": "CRUDE", "GC=F": "GOLD", "SI=F": "SILVER",
  "BTC-USD": "BITCOIN", "ETH-USD": "ETHER", "DX-Y.NYB": "DOLLAR",
};
function watermarkOf(symbol: string, name?: string | null): string {
  if (WATERMARKS[symbol]) return WATERMARKS[symbol];
  if (/^\^|=|-USD$/.test(symbol)) return name && name.length <= 16 ? name.toUpperCase() : symbol.replace(/^\^/, "");
  return symbol;
}

export function CandleChart({
  candles, interval, loading, error, label, studies = NO_STUDIES, compact = false,
  drawings, tool = "cursor", onDrawingsChange, onToolDone, magnet = false, zoomable = false, movable = zoomable,
  logScale = false, percentScale = false, compare, benchmark, openOn, ohlc = true, params, crosshairGroup, onPickTime, alerted, onLineAlert,
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
  /** Called once a drawing is made, so the page can hand back the cursor. */
  onToolDone?: () => void;
  /** Points drawn snap to the nearest open, high, low or close. */
  magnet?: boolean;
  /**
   * The wheel zooms around the pointer. Off where the chart sits in a page
   * that scrolls past it, so the wheel still scrolls the page there.
   */
  zoomable?: boolean;
  /**
   * A drag pans both ways, the axes stretch, buttons zoom, a double click
   * returns to the latest candles. On wherever the wheel zooms; a chart in a
   * scrolling page can move without taking the wheel.
   */
  movable?: boolean;
  /** Prices on a logarithmic axis, where equal moves in percent are equal distances. */
  logScale?: boolean;
  /** The axis in percent from the first candle on screen, as the platforms' percentage scale reads. */
  percentScale?: boolean;
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
  /** The candle's open, high, low and close in the legend; off where the screen has no room for them. */
  ohlc?: boolean;
  /** The reader's settings for the studies (lib/io/study-params.ts); the defaults where absent. */
  params?: StudyParams;
  /** Charts of the same group show each other's crosshair, at the same time. */
  crosshairGroup?: string;
  /** While set, a click on the plot picks the candle under it (a replay's start) and does nothing else. */
  onPickTime?: (time: number) => void;
  /** The drawings with an alert, and how to set or remove one (components/io/line-alerts.ts). */
  alerted?: ReadonlySet<string>;
  onLineAlert?: (drawing: Drawing, lastPrice: number) => void;
}) {
  const selfId = useId();
  const clipId = `candle-clip-${selfId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  /* How wide the plot is, so a phone shows fewer, wider candles. */
  const plotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = size?.width ?? null;


  /* Each study with the reader's settings (lib/io/study-params.ts), the defaults where they changed none. */
  const set = (study: Study) => paramsOf(params, study);
  const emaPeriods = set("ema").join(",");
  const averages = useMemo(
    () => emaPeriods.split(",").map(Number).map((period) => ({ period, line: candles ? ema(candles.c, period) : ([] as Line) })),
    [candles, emaPeriods],
  );
  // The analysis measures its tolerances in 14-period ranges; the ATR pane follows the reader's period.
  const ranges = useMemo(() => (candles ? averageTrueRange(candles) : []), [candles]);
  /*
   * Every other indicator, read over the whole history and cut to the candles
   * on screen afterwards, like the averages: the first candle shown already
   * has a settled 200-period average and a warmed-up RSI.
   */
  const indicators = useMemo(() => {
    if (!candles) return null;
    const of = (study: Study) => paramsOf(params, study);
    const [bandPeriod, bandWidth] = of("bollinger");
    const [macdFast, macdSlow, macdSignal] = of("macd");
    const [stochK, stochSmooth, stochD] = of("stoch");
    const [tenkan, kijun, senkou] = of("ichimoku");
    const [atrPeriod] = of("atr");
    return {
      smas: of("sma").map((period) => ({ period, line: sma(candles.c, period) })),
      bands: bollinger(candles.c, bandPeriod, bandWidth),
      rsi: rsi(candles.c, of("rsi")[0]),
      macd: macd(candles.c, macdFast, macdSlow, macdSignal),
      stoch: stochastic(candles, stochK, stochSmooth, stochD),
      cloud: ichimoku(candles, tenkan, kijun, senkou),
      atr: atrPeriod === 14 ? null : averageTrueRange(candles, atrPeriod),
      sessionVwap: isIntraday(interval) ? vwap(candles, true) : null,
      trend: sma(candles.c, 10),
      // The rest of the toolkit (lib/io/indicators-extra.ts), each read only when it is on.
      keltner: studies.has("keltner") ? keltner(candles, ...(of("keltner") as [number, number, number])) : null,
      donchian: studies.has("donchian") ? donchian(candles, of("donchian")[0]) : null,
      supertrend: studies.has("supertrend") ? supertrend(candles, ...(of("supertrend") as [number, number])) : null,
      psar: studies.has("psar") ? parabolicSar(candles, ...(of("psar") as [number, number])) : null,
      hma: studies.has("hma") ? hullMa(candles.c, of("hma")[0]) : null,
      pivots: studies.has("pivots") ? pivotLevels(candles, interval) : null,
      heikin: studies.has("heikinAshi") ? heikinAshi(candles) : null,
      extra: {
        adx: studies.has("adx") ? adx(candles, of("adx")[0]) : null,
        squeeze: studies.has("squeeze") ? squeeze(candles, of("squeeze")[0]) : null,
        stochrsi: studies.has("stochrsi") ? stochRsi(candles.c, ...(of("stochrsi") as [number, number, number])) : null,
        willr: studies.has("willr") ? williamsR(candles, of("willr")[0]) : null,
        cci: studies.has("cci") ? cci(candles, of("cci")[0]) : null,
        roc: studies.has("roc") ? roc(candles.c, of("roc")[0]) : null,
        aroon: studies.has("aroon") ? aroon(candles, of("aroon")[0]) : null,
        obv: studies.has("obv") ? obv(candles) : null,
        cmf: studies.has("cmf") ? chaikinMoneyFlow(candles, of("cmf")[0]) : null,
        mfi: studies.has("mfi") ? moneyFlowIndex(candles, of("mfi")[0]) : null,
      },
    };
  }, [candles, interval, studies, params]);
  const on = (study: Study) => studies.has(study);
  const showEma = studies.has("ema");
  const showExtension = studies.has("fibExtension");
  const showSma = studies.has("sma");
  const showBands = studies.has("bollinger");
  const showCloud = studies.has("ichimoku");
  const showVwap = studies.has("vwap");

  /*
   * The window on the history (lib/io/chart-view.ts): how many slots across,
   * and where the right edge stands from the last candle. Kept per symbol and
   * interval, so a new one opens on its latest candles with a little room
   * after them; null is that default. The price axis fits the candles on
   * screen until the reader stretches or moves it, then holds their range.
   */
  const total = candles?.t.length ?? 0;
  const navKey = candles ? `${candles.symbol}:${interval}:${openOn ?? ""}` : "";
  const yKey = `${navKey}:${logScale ? "log" : "linear"}`;
  const [nav, setNav] = useState<(Viewport & { key: string }) | null>(null);
  const [yRange, setYRange] = useState<{ key: string; min: number; max: number } | null>(null);
  const manual = movable && yRange?.key === yKey ? yRange : null;
  const fit = !candles ? 0 : openOn ? Math.min(total, Math.max(2, openOn)) : candlesToShow(interval, total, width, compact ? COMPACT_CANDLE_PX : undefined);
  const margin = movable && fit ? rightMargin(fit) : 0;
  const held = movable && nav?.key === navKey ? nav : null;
  const viewSpan = held ? clampViewport(held, total).span : fit + margin;
  const viewOffset = held ? clampViewport(held, total).offset : margin;
  const viewport = useMemo<Viewport | null>(() => (fit ? { span: viewSpan, offset: viewOffset } : null), [fit, viewSpan, viewOffset]);
  const moveTo = (next: Viewport) => setNav({ key: navKey, ...clampViewport(next, total) });

  /*
   * The wheel, listened to directly: React's wheel handler is passive and
   * cannot stop the page scrolling under a zoom. Vertical movement zooms
   * around the candle under the pointer; horizontal movement, a trackpad's
   * sideways swipe, pans.
   */
  const latest = useRef<{ key: string; viewport: Viewport; total: number } | null>(null);
  useEffect(() => {
    const element = plotRef.current;
    if (!element || !zoomable) return;
    const onWheel = (event: WheelEvent) => {
      const current = latest.current;
      if (!current) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const next = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? panBy(current.viewport, current.total, (event.deltaX / box.width) * current.viewport.span)
        : zoomAround(current.viewport, current.total, Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), Math.exp(event.deltaY * 0.0015));
      setNav({ key: current.key, ...next });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomable]);
  const panes = PANES.filter((pane) => studies.has(pane)
    && !(pane === "volume" && !candles?.v?.some((value) => value > 0))
    && !(pane === "rs" && !benchmark?.t.length));

  /* The candles on screen, and everything positioned from them. */
  const view = useMemo(() => {
    if (!candles || !viewport) return null;
    const total = candles.t.length;
    const { from, to, left, right } = windowOf(viewport, total);
    if (to - from < 2) return null;
    const count = to - from;
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
      atr: (indicators.atr ?? ranges).slice(from, to),
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
      shapes: studies.has("chartPatterns") ? chartPatterns(series, found, atr) : [],
    };

    const fitted = priceScale([
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
    if (!fitted) return null;
    // The reader's own range, once they have stretched or moved the price axis.
    const scale = manual && manual.max > manual.min
      ? { min: manual.min, max: manual.max, ticks: ticksFor(manual.min, manual.max, compact ? 5 : 6) }
      : fitted;
    const slot = W / viewport.span;
    /** Where a candle on screen stands across the plot, by its place in the slice; fractions and places past either end work too. */
    const x = (index: number) => (index + from + 0.5 - left) * slot;
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
    // On the percentage scale the ticks fall on round percentages from the first close on screen.
    const base = c[0];
    const percentOn = percentScale && !log && base > 0;
    const ticks = percentOn
      ? ticksFor((scale.min / base - 1) * 100, (scale.max / base - 1) * 100, compact ? 5 : 6).map((value) => base * (1 + value / 100))
      : log ? logTicks(scale.min, scale.max, compact ? 5 : 7) : scale.ticks;
    /**
     * A price as the axis writes it: itself, or its distance from the first
     * close in percent — the ticks to the places their spacing needs, a single
     * price (the last close, the pointer) to two.
     */
    const tickStep = ticks.length > 1 ? Math.abs((ticks[1] - ticks[0]) / base) * 100 : 1;
    const tickPlaces = tickStep >= 1 ? 0 : tickStep >= 0.1 ? 1 : 2;
    const axisText = (value: number, exact = false) => {
      if (!percentOn) return price(value);
      const change = (value / base - 1) * 100;
      const places = exact ? 2 : tickPlaces;
      if (Math.abs(change) < 0.5 * 10 ** -places) return `${(0).toFixed(places)}%`;
      return `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(places)}%`;
    };
    const profile = studies.has("vprofile") && volume ? volumeProfile({ t, o, h, l, c, v: volume }, scale.min, scale.max, compact ? 16 : paramsOf(params, "vprofile")[0]) : null;
    return {
      t, o, h, l, c, drawn, extra, lines, smaLines, bands, cloud, vwapLine, patterns, compared, profile, momentum, volume, analysis,
      scale, ticks, axisText, percentOn, priceAt, log, slot, x, y, count, from, total, left, right, span: viewport.span,
      // The place in the slice at the plot's right edge, for lines drawn to it.
      edge: right - 0.5 - from,
      previous: from > 0 ? candles.c[from - 1] : null,
      lastClose: candles.c[total - 1],
      lastBase: total > 1 ? candles.c[total - 2] : null,
    };
  }, [candles, averages, indicators, ranges, interval, showEma, showSma, showBands, showCloud, showExtension, compact, viewport, manual, logScale, compare, benchmark, studies, params, percentScale]);

  useEffect(() => {
    latest.current = viewport && navKey ? { key: navKey, viewport, total } : null;
  }, [viewport, navKey, total]);

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
   * at a candle's close. Past the last candle the line follows the pointer.
   */
  const [pointer, setPointer] = useState<{ fx: number; y: number } | null>(null);
  const onPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!view) return;
    const box = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    setPointer(fx >= 0 && fx <= 1 && y >= 0 && y <= 1 ? { fx, y } : null);
  };
  const pointed = pointer && view ? Math.floor(view.left + pointer.fx * view.span) - view.from : null;
  const own = pointed != null && view && pointed >= 0 && pointed < view.count ? pointed : null;
  /* The crosshair of a linked chart: this one marks the candle that holds the same time. */
  const shared = useSharedCross(crosshairGroup, selfId);
  const sharedIndex = !pointer && shared && view && candles ? Math.floor(indexOfTime(candles.t, shared.t) + 1e-6) - view.from : null;
  const hover = own ?? (sharedIndex != null && sharedIndex >= 0 && sharedIndex < (view?.count ?? 0) ? sharedIndex : null);
  const ownTime = own != null && view ? view.t[own] : null;
  useEffect(() => {
    if (!crosshairGroup) return;
    if (ownTime != null) publishCross({ group: crosshairGroup, source: selfId, t: ownTime });
    else releaseCross(selfId);
  }, [crosshairGroup, ownTime, selfId]);
  useEffect(() => () => releaseCross(selfId), [selfId]);
  const pointerPrice = pointer && view ? view.priceAt(pointer.y) : null;

  /*
   * Drawing. A press starts a line where the pointer is, a drag stretches it,
   * a release keeps it — or a click at each end, as on the desk platforms; a
   * level, a note or a position needs only the press. Positions become a date
   * and a price at once, measured on the whole history, so nothing drawn
   * depends on this screen's width or on how far it is scrolled.
   *
   * With the cursor, a press on a drawing selects it: its handles reshape it,
   * a drag anywhere else on it moves it, Delete removes it, and a bar over the
   * plot sets its colour, width and line. A press anywhere else holds the chart.
   */
  const editable = onDrawingsChange != null;
  const drawingTool = editable && tool !== "cursor" && tool !== "erase";
  const list = drawings ?? NO_DRAWINGS;
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [live, setLive] = useState<Drawing | null>(null);
  /** A drawing being made: `follow` while a click waits for the next point, `third` while a three-point drawing waits for its last. */
  type Draft = Drawing & { follow?: boolean; third?: boolean };
  const [drafted, setDraft] = useState<Draft | null>(null);
  // A drawing begun with another tool is dropped when the tool changes.
  const draft = drafted && drafted.kind === tool ? drafted : null;
  type Gesture =
    | { kind: "pan"; x: number; y: number; view: Viewport; range: { min: number; max: number }; width: number; height: number; vertical: boolean }
    | { kind: "handle"; handle: HandleKey; original: Drawing }
    | { kind: "move"; x: number; y: number; original: Drawing }
    | { kind: "draft" }
    | { kind: "brush"; x: number; y: number };
  const gesture = useRef<Gesture | null>(null);
  const times = candles?.t ?? NO_TIMES;

  const screenOf = (anchor: Anchor) => (view ? { x: view.x(indexOfTime(times, anchor.t) - view.from), y: view.y(anchor.p) } : { x: 0, y: 0 });
  type Box = { width: number; height: number };
  const toPixels = (anchor: Anchor, box: Box) => { const point = screenOf(anchor); return { x: (point.x / W) * box.width, y: (point.y / H) * box.height }; };
  /** The date and price at a point on the plot, in pixels; with the magnet, the nearest open, high, low or close. */
  const anchorAt = (px: number, py: number, box: Box, snap: boolean): Anchor => {
    if (!view) return { t: 0, p: 0 };
    const index = view.left + (px / box.width) * view.span - 0.5 - view.from;
    const price = view.priceAt(py / box.height);
    if (snap && index > -0.5 && index < view.count - 0.5) {
      const at = Math.min(view.count - 1, Math.max(0, Math.round(index)));
      const nearest = [view.o[at], view.h[at], view.l[at], view.c[at]]
        .reduce((best, value) => (Math.abs(view.y(value) - (py / box.height) * H) < Math.abs(view.y(best) - (py / box.height) * H) ? value : best));
      return { t: view.t[at], p: nearest };
    }
    return { t: timeOfIndex(times, index + view.from), p: price };
  };
  const shown = [...list.map((item) => (live && item.id === live.id ? live : item)), ...(draft ? [draft] : [])];
  const chosen = selected ? shown.find((item) => item.id === selected) ?? null : null;
  /*
   * The drawings worked out from the candles rather than from their points
   * alone: an anchored VWAP's line, a regression channel's three lines.
   */
  const derivedOf = (item: Drawing): { line?: Anchor[]; regression?: { mid: [Anchor, Anchor]; up: [Anchor, Anchor]; low: [Anchor, Anchor] } } => {
    if (!candles) return {};
    if (item.kind === "avwap") return { line: anchoredVwap(candles, item.a.t) };
    if (item.kind === "regression") {
      const found = regressionOver(candles, item.a.t, item.b.t);
      if (!found) return {};
      const band = found.deviation * 2;
      return {
        regression: {
          mid: [found.a, found.b],
          up: [{ t: found.a.t, p: found.a.p + band }, { t: found.b.t, p: found.b.p + band }],
          low: [{ t: found.a.t, p: found.a.p - band }, { t: found.b.t, p: found.b.p - band }],
        },
      };
    }
    return {};
  };
  /** What the pointer is tested against: a derived drawing by the lines it shows. */
  const hitShape = (item: Drawing): Drawing => {
    const derived = derivedOf(item);
    if (derived.line) return { ...item, points: derived.line };
    if (derived.regression) {
      const { up, low } = derived.regression;
      return { ...item, points: [up[0], up[1], low[1], low[0], up[0]] };
    }
    return item;
  };
  const hitAt = (px: number, py: number, box: Box) => {
    const hit = drawingAt(list.map(hitShape), { x: px, y: py }, (anchor) => toPixels(anchor, box), 7, box);
    return hit ? list.find((item) => item.id === hit.id) ?? null : null;
  };

  const keep = (made: Drawing) => {
    onDrawingsChange?.([...list, made]);
    setSelected(made.id);
    setDraft(null);
    if (made.kind === "text") setFresh(made.id);
    onToolDone?.();
  };
  const replace = (next: Drawing) => onDrawingsChange?.(list.map((item) => (item.id === next.id ? next : item)));
  const remove = (id: string) => { onDrawingsChange?.(list.filter((item) => item.id !== id)); setSelected(null); };
  const finish = (drafted: Draft, box: Box) => {
    const made: Drawing = { ...drafted };
    delete (made as Draft).follow;
    delete (made as Draft).third;
    // A pitchfork or an extension has a third point still to come: it follows the pointer until the next click.
    if (THREE_POINTS.has(made.kind) && !drafted.third) {
      setDraft({ ...made, c: made.b, follow: true, third: true });
      return;
    }
    if (made.kind === "channel") {
      // The parallel opens a little under the base line; its handle sets the width.
      const a = toPixels(made.a, box);
      keep({ ...made, c: anchorAt(a.x, a.y + Math.max(24, box.height * 0.08), box, false) });
      return;
    }
    keep(made);
  };

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !view) return;
    const plot = event.currentTarget;
    const rect = plot.getBoundingClientRect();
    const box = { width: rect.width, height: rect.height };
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    if (onPickTime) {
      const local = Math.min(view.count - 1, Math.max(0, Math.floor(view.left + (px / rect.width) * view.span) - view.from));
      onPickTime(view.t[local]);
      return;
    }
    if (draft?.follow) {
      const anchor = anchorAt(px, py, box, magnet);
      finish(draft.third ? { ...draft, c: anchor } : { ...draft, b: anchor }, box);
      return;
    }
    if (drawingTool) {
      event.preventDefault();
      const anchor = anchorAt(px, py, box, magnet);
      const kind = tool as Drawing["kind"];
      if (ONE_CLICK.has(kind)) {
        let made: Drawing = { id: newId(), kind, a: anchor, b: anchor };
        if (kind === "long" || kind === "short") {
          const end = timeOfIndex(times, indexOfTime(times, anchor.t) + Math.max(6, view.span * 0.15));
          made = { ...made, ...positionAround(kind, anchor, end, (view.scale.max - view.scale.min) * 0.08) };
        }
        if (kind === "text") made = { ...made, text: "Note" };
        keep(made);
        return;
      }
      plot.setPointerCapture(event.pointerId);
      gesture.current = kind === "brush" ? { kind: "brush", x: px, y: py } : { kind: "draft" };
      setDraft({ id: newId(), kind, a: anchor, b: anchor, ...(kind === "brush" ? { points: [anchor] } : {}) });
      return;
    }
    if (editable && tool === "erase") {
      const hit = hitAt(px, py, box);
      if (hit) remove(hit.id);
      return;
    }
    if (editable && list.length) {
      if (chosen && !chosen.locked) {
        const handle = handlesOf(chosen).find((key) => { const at = toPixels(handleAnchor(chosen, key), box); return Math.hypot(at.x - px, at.y - py) <= 8; });
        if (handle) {
          plot.setPointerCapture(event.pointerId);
          gesture.current = { kind: "handle", handle, original: chosen };
          return;
        }
      }
      const hit = hitAt(px, py, box);
      if (hit) {
        setSelected(hit.id);
        if (!hit.locked) {
          plot.setPointerCapture(event.pointerId);
          gesture.current = { kind: "move", x: px, y: py, original: hit };
        }
        return;
      }
    }
    setSelected(null);
    if (movable && viewport) {
      plot.setPointerCapture(event.pointerId);
      gesture.current = {
        kind: "pan", x: event.clientX, y: event.clientY, view: viewport, range: { min: view.scale.min, max: view.scale.max },
        width: rect.width, height: rect.height, vertical: manual != null,
      };
    }
  };
  const onDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointer(event);
    if (!view) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const box = { width: rect.width, height: rect.height };
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const held = gesture.current;
    if (!held) {
      if (draft?.follow) {
        const anchor = anchorAt(px, py, box, magnet);
        setDraft(draft.third ? { ...draft, c: anchor } : { ...draft, b: anchor });
      }
      return;
    }
    if (held.kind === "pan") {
      const dx = event.clientX - held.x;
      const dy = event.clientY - held.y;
      moveTo(panBy(held.view, total, -(dx / held.width) * held.view.span));
      // Up or down as well: the price axis leaves its fit and follows the hand, as on the desk platforms.
      if (!held.vertical && Math.abs(dy) > 8) held.vertical = true;
      if (held.vertical) setYRange({ key: yKey, ...shiftRange(held.range, dy / held.height, view.log) });
      return;
    }
    if (held.kind === "handle") { setLive(withHandle(held.original, held.handle, anchorAt(px, py, box, magnet))); return; }
    if (held.kind === "move") {
      const dx = px - held.x;
      const dy = py - held.y;
      setLive(mapAnchors(held.original, (anchor) => { const at = toPixels(anchor, box); return anchorAt(at.x + dx, at.y + dy, box, false); }));
      return;
    }
    if (held.kind === "draft" && draft) { setDraft({ ...draft, b: anchorAt(px, py, box, magnet) }); return; }
    if (held.kind === "brush" && draft && Math.hypot(px - held.x, py - held.y) >= 3) {
      held.x = px;
      held.y = py;
      const point = anchorAt(px, py, box, false);
      setDraft({ ...draft, b: point, points: [...(draft.points ?? []), point] });
    }
  };
  const onUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = gesture.current;
    gesture.current = null;
    if (!held) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const box = { width: rect.width, height: rect.height };
    if (held.kind === "handle" || held.kind === "move") {
      if (live) replace(live);
      setLive(null);
      return;
    }
    if (held.kind === "draft" && draft) {
      const a = toPixels(draft.a, box);
      const b = toPixels(draft.b, box);
      // A drag draws it; a click starts it, and the next click ends it.
      if (Math.hypot(a.x - b.x, a.y - b.y) > 4) finish(draft, box); else setDraft({ ...draft, follow: true });
      return;
    }
    if (held.kind === "brush" && draft) {
      if ((draft.points?.length ?? 0) > 1) keep(draft); else setDraft(null);
    }
  };
  const cancel = () => { gesture.current = null; setLive(null); setDraft(null); };

  /* Delete removes the drawing selected, Escape lets it go — unless the reader is typing. */
  useEffect(() => {
    if (!selected || !editable) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onDrawingsChange?.(list.filter((item) => item.id !== selected));
        setSelected(null);
      }
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, editable, list, onDrawingsChange]);

  /* The price axis, stretched by a drag up or down; the dates, compressed by a drag sideways. */
  const axisDrag = useRef<{ y: number; range: { min: number; max: number } } | null>(null);
  const datesDrag = useRef<{ x: number; view: Viewport } | null>(null);
  const onAxisDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!movable || !view || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    axisDrag.current = { y: event.clientY, range: { min: view.scale.min, max: view.scale.max } };
  };
  const onAxisMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = axisDrag.current;
    if (!held || !view) return;
    setYRange({ key: yKey, ...stretchRange(held.range, Math.exp((event.clientY - held.y) * 0.006), view.log) });
  };
  const onDatesDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!movable || !viewport || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    datesDrag.current = { x: event.clientX, view: viewport };
  };
  const onDatesMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = datesDrag.current;
    if (!held) return;
    // The right edge holds; dragging left fits more candles, right fewer.
    moveTo({ span: held.view.span * Math.exp(-(event.clientX - held.x) * 0.006), offset: held.view.offset });
  };
  const reset = () => { setNav(null); setYRange(null); };
  const zoomBy = (factor: number) => { if (viewport) moveTo(zoomAround(viewport, total, 1, factor)); };
  const scrollBy = (share: number) => { if (viewport) moveTo(panBy(viewport, total, viewport.span * share)); };

  const at = view ? Math.min(hover ?? view.count - 1, view.count - 1) : null;
  const baseOf = (index: number) => (!view ? null : index > 0 ? view.c[index - 1] : view.previous);
  const before = at != null ? baseOf(at) : null;
  const move = view && at != null && before != null ? view.c[at] - before : null;
  const lastMove = view && view.lastBase != null ? view.lastClose - view.lastBase : null;
  // Pixel size of the plot, for the few marks that must not stretch with it: arrowheads.
  const sx = size ? W / Math.max(size.width, 1) : 1;
  const sy = size ? H / Math.max(size.height, 1) : 1;

  /*
   * Earnings releases and dividends under the candles they fell in, read from
   * the company's SEC index and its dividend history. On daily candles an
   * earnings marker gives the move from the close before the release to the
   * close after it, so a release before the open and one after the close read
   * alike; a dividend gives what it paid and what that was of the price.
   */
  /* Lower panes the reader resized: the candles give up what the panes take. */
  const paneHeights = usePaneHeights();
  const resizable = movable && !compact;
  const paneExtra = resizable ? panes.reduce((sum, pane) => sum + ((paneHeights[pane] ?? PANE_DEFAULT_PX) - PANE_DEFAULT_PX), 0) : 0;

  const companyEvents = useChartEvents(candles?.symbol ?? "", !compact && (studies.has("earnings") || studies.has("dividends")));
  const markers = useMemo(() => {
    if (!candles || !view || !companyEvents.length) return [];
    const daily = interval === "1d";
    const found: Array<{ key: string; kind: "earnings" | "dividend"; local: number; date: string; note: string; tone?: "good" | "bad" }> = [];
    for (const event of companyEvents) {
      if (event.kind === "earnings" ? !studies.has("earnings") : !studies.has("dividends")) continue;
      const end = Date.parse(`${event.date}T23:59:59Z`) / 1000;
      if (!Number.isFinite(end) || end < candles.t[0]) continue;
      // The last candle that opened by the end of that day.
      let low = 0, high = candles.t.length - 1;
      if (candles.t[high] <= end) low = high;
      else while (high - low > 1) { const middle = (low + high) >> 1; if (candles.t[middle] <= end) low = middle; else high = middle; }
      const local = low - view.from;
      if (local < 0 || local >= view.count) continue;
      if (event.kind === "earnings") {
        const before = daily && low > 0 ? candles.c[low - 1] : null;
        const after = daily && low + 1 < candles.c.length ? candles.c[low + 1] : null;
        const move = before && after ? after / before - 1 : null;
        found.push({ key: `e-${event.date}`, kind: "earnings", local, date: event.date, note: move == null ? "Earnings release" : `Earnings release · ${percent(move)} close to close`, tone: move == null ? undefined : move >= 0 ? "good" : "bad" });
      } else {
        const close = candles.c[low];
        found.push({ key: `d-${event.date}`, kind: "dividend", local, date: event.date, note: `Dividend ${price(event.amount)}${close ? ` · ${((event.amount ?? 0) / close * 100).toFixed(2)}% of the price` : ""}` });
      }
    }
    return found;
  }, [candles, view, companyEvents, studies, interval]);
  const [markedKey, setMarked] = useState<string | null>(null);
  const marked = markers.find((item) => item.key === markedKey) ?? null;

  return (
  <figure
    className="candle-chart" data-size={compact ? "compact" : undefined} aria-label={label}
    // How many lower panes are open, so a page with a fixed height can give the candles what is left.
    style={{ "--panes": panes.length, "--panes-extra": `${paneExtra}px` } as React.CSSProperties}
  >
    {compact ? null : <div className="candle-legend">
      {view && at != null ? (
        <>
          <span className="dim">{dateText(view.t[at], interval)}</span>
          {ohlc ? (
            <>
              <span>O <b>{price(view.o[at])}</b></span>
              <span>H <b>{price(view.h[at])}</b></span>
              <span>L <b>{price(view.l[at])}</b></span>
              <span>C <b>{price(view.c[at])}</b></span>
            </>
          ) : null}
          {move != null && before ? <b data-tone={tone(move)}>{signed(move)} ({percent(move / before)})</b> : null}
          {showEma ? view.lines.map((line, index) => (
            <span key={index} className="candle-legend-ema">
              <i style={{ background: EMA_COLORS[index % EMA_COLORS.length] }} aria-hidden="true" />EMA {line.period} <b>{price(line.values[at])}</b>
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
          {view.log ? <span className="dim">LOG</span> : view.percentOn ? <span className="dim">% from {dateText(view.t[0], interval)}</span> : null}
        </>
      ) : null}
    </div>}

    <div className="candle-body">
      <div
        className="candle-plot" ref={plotRef} data-tool={onPickTime ? "pick" : drawingTool || (editable && tool === "erase") ? tool : undefined}
        data-zoomable={movable || undefined}
        onPointerMove={onDrag} onPointerLeave={() => setPointer(null)} onPointerDown={onDown} onPointerUp={onUp}
        onPointerCancel={cancel}
        onDoubleClick={() => { if (movable && !drawingTool && !chosen) reset(); }}
      >
        {/* The watermark: the symbol faint across the plot and Tenqay's mark in its corner, under the pointer's notice. */}
        {candles?.symbol ? (
          <>
            <span className="candle-wmark" aria-hidden="true">{watermarkOf(candles.symbol, candles.name)}</span>
            <span className="candle-wmark-logo" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element -- the site's own favicon, a few hundred bytes. */}
              <img src="/favicon.svg" alt="" width={11} height={11} />TENQAY
            </span>
          </>
        ) : null}
        {view ? (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {view.ticks.map((tick) => (
              <line key={tick} className="candle-grid" x1={0} x2={W} y1={view.y(tick)} y2={view.y(tick)} vectorEffect="non-scaling-stroke" />
            ))}
            {pointer ? (
              <>
                <line className="candle-cursor" x1={hover != null ? view.x(hover) : pointer.fx * W} x2={hover != null ? view.x(hover) : pointer.fx * W} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
                <line className="candle-cursor" x1={0} x2={W} y1={pointer.y * H} y2={pointer.y * H} vectorEffect="non-scaling-stroke" />
              </>
            ) : hover != null ? (
              <line className="candle-cursor" x1={view.x(hover)} x2={view.x(hover)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
            ) : null}
            <defs><clipPath id={clipId}><rect x={0} y={0} width={W} height={H} /></clipPath></defs>
            <line className="candle-last" x1={0} x2={W} y1={view.y(view.lastClose)} y2={view.y(view.lastClose)} vectorEffect="non-scaling-stroke" />
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
              {view.analysis.shapes.map((shape) => {
                const reversal = shape.kind === "doubleTop" || shape.kind === "doubleBottom" || shape.kind === "headAndShoulders" || shape.kind === "inverseHeadAndShoulders";
                return (
                  <g key={`shape-${shape.kind}-${shape.start}`} className="study-shape" data-tone={CHART_PATTERN_NAMES[shape.kind].bullish == null ? undefined : CHART_PATTERN_NAMES[shape.kind].bullish ? "good" : "bad"}>
                    {reversal ? (
                      <path className="study-shape-swing" d={shape.points.map((point, index) => `${index ? "L" : "M"}${view.x(point.index).toFixed(2)} ${view.y(point.price).toFixed(2)}`).join("")} vectorEffect="non-scaling-stroke" />
                    ) : null}
                    {shape.lines.map((line, index) => (
                      <line key={index} className={reversal ? "study-shape-neck" : "study-shape-line"}
                        x1={view.x(line.a.index)} y1={view.y(line.a.price)} x2={view.x(line.b.index)} y2={view.y(line.b.price)} vectorEffect="non-scaling-stroke" />
                    ))}
                    {shape.target != null ? (
                      <line className="study-shape-target" x1={view.x(view.count - 1) - W * 0.06} x2={W} y1={view.y(shape.target)} y2={view.y(shape.target)} vectorEffect="non-scaling-stroke" />
                    ) : null}
                  </g>
                );
              })}
              {on("trendLines") ? view.analysis.trends.map((line) => (
                <line
                  key={`${line.kind}-${line.a.index}-${line.b.index}`} className={`study-trend study-${line.kind}`}
                  x1={view.x(line.a.index)} y1={view.y(line.a.price)} x2={W} y2={view.y(priceOnLine(line, view.edge))}
                  vectorEffect="non-scaling-stroke"
                />
              )) : null}
            </g>
            {showEma ? view.lines.map((line, index) => {
              let path = "";
              let open = false;
              line.values.forEach((value, index) => {
                if (value == null) { open = false; return; }
                path += `${open ? "L" : "M"}${view.x(index).toFixed(2)} ${view.y(value).toFixed(2)}`;
                open = true;
              });
              return path ? (
                <path key={index} className="candle-ema" d={path} style={{ stroke: EMA_COLORS[index % EMA_COLORS.length] }} vectorEffect="non-scaling-stroke" />
              ) : null;
            }) : null}
            {showSma ? view.smaLines.map((line, index) => {
              const path = pathOf(line.values, view.x, view.y);
              return path ? <path key={`sma-${index}`} className="candle-ema" d={path} style={{ stroke: SMA_COLORS[index % SMA_COLORS.length] }} vectorEffect="non-scaling-stroke" /> : null;
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
                {shown.map((item) => (
                  <DrawingMark
                    key={item.id + (item === draft ? "-draft" : "")} item={item} chosen={item.id === selected}
                    a={screenOf(item.a)} b={screenOf(item.b)} c={item.c ? screenOf(item.c) : null}
                    points={(derivedOf(item).line ?? item.points)?.map(screenOf) ?? null} sx={sx} sy={sy}
                    regression={(() => {
                      const found = derivedOf(item).regression;
                      return found ? { mid: found.mid.map(screenOf), up: found.up.map(screenOf), low: found.low.map(screenOf) } as RegressionSpots : null;
                    })()}
                  />
                ))}
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
            {view.analysis.shapes.map((shape) => {
              const meaning = CHART_PATTERN_NAMES[shape.kind];
              const top = Math.min(...shape.lines.flatMap((line) => [view.y(line.a.price), view.y(line.b.price)]), ...shape.points.map((point) => view.y(point.price)));
              return (
                <span key={`shape-label-${shape.kind}`} className="study-shape-label" data-tone={meaning.bullish == null ? undefined : meaning.bullish ? "good" : "bad"}
                  style={{ left: pct(view.x(shape.start), W), top: `calc(${pct(top, H)} - 16px)` }}>
                  {meaning.name}{shape.breakout ? ` · broke ${shape.breakout}` : ""}{shape.target != null ? ` · target ${price(shape.target)}` : ""}
                </span>
              );
            })}
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
            {shown.map((item) => (
              <DrawingNotes
                key={`notes-${item.id}`} item={item} a={screenOf(item.a)} b={screenOf(item.b)} c={item.c ? screenOf(item.c) : null}
                last={(() => { const line = derivedOf(item).line; return line?.length ? { at: screenOf(line[line.length - 1]), p: line[line.length - 1].p } : null; })()}
                bars={Math.round(indexOfTime(times, item.b.t) - indexOfTime(times, item.a.t))} noteAt={noteAt} noteSide={noteSide}
              />
            ))}
            {chosen && !chosen.locked && chosen.id !== draft?.id ? handlesOf(chosen).map((key) => {
              const point = screenOf(handleAnchor(chosen, key));
              return <span key={`handle-${key}`} className="drawing-handle" style={{ left: pct(point.x, W), top: pct(point.y, H), borderColor: chosen.color ?? DEFAULT_DRAWING_COLOR }} />;
            }) : null}
          </div>
        ) : null}
        {loading || error || (!view && candles) ? (
          <div className="candle-state">{loading ? "Loading…" : error ?? "Not enough history to draw."}</div>
        ) : null}
        {onPickTime && view ? <div className="candle-pick-note">Click the candle to replay from</div> : null}
        {view && markers.length ? (
          <div className="candle-events">
            {markers.map((item) => (
              <span
                key={item.key} className="candle-event" data-kind={item.kind} style={{ left: pct(view.x(item.local), W) }}
                onPointerEnter={() => setMarked(item.key)} onPointerLeave={() => setMarked(null)}
                aria-label={`${item.note}, ${item.date}`} role="img"
              >
                {item.kind === "earnings" ? "E" : "D"}
              </span>
            ))}
            {marked ? (
              <span className="candle-event-card" data-tone={marked.tone} style={{ left: `clamp(130px, ${pct(view.x(marked.local), W)}, calc(100% - 130px))` }}>
                <b>{dateText(Date.parse(`${marked.date}T12:00:00Z`) / 1000, "1d")}</b> {marked.note}
              </span>
            ) : null}
          </div>
        ) : null}
        {editable && chosen && !live && chosen.id !== draft?.id ? (
          <DrawingBar
            drawing={chosen} focusText={fresh === chosen.id}
            alert={onLineAlert && canAlert(chosen.kind) && candles ? {
              on: alerted?.has(chosen.id) === true,
              toggle: () => onLineAlert(chosen, candles.c[candles.c.length - 1]),
            } : null}
            onChange={replace} onDelete={() => remove(chosen.id)}
            onClone={() => {
              const box = plotRef.current?.getBoundingClientRect();
              if (!box) return;
              const copy = { ...mapAnchors(chosen, (anchor) => { const at = toPixels(anchor, box); return anchorAt(at.x + 14, at.y + 14, box, false); }), id: newId(), locked: false };
              onDrawingsChange?.([...list, copy]);
              setSelected(copy.id);
            }}
          />
        ) : null}
        {movable && view ? (
          <div className="candle-nav" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1.25)}>−</button>
            <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(0.8)}>+</button>
            <button type="button" title="Scroll back" aria-label="Scroll back" onClick={() => scrollBy(-0.25)}>‹</button>
            <button type="button" title="Scroll forward" aria-label="Scroll forward" onClick={() => scrollBy(0.25)}>›</button>
            <button type="button" title="Reset the view · double-click" aria-label="Reset the view" onClick={reset}>⟲</button>
          </div>
        ) : null}
        {movable && view && view.right < view.total ? (
          <button
            type="button" className="candle-latest" title="Back to the latest candle" aria-label="Back to the latest candle"
            onPointerDown={(event) => event.stopPropagation()} onClick={() => { if (viewport) moveTo({ span: viewport.span, offset: rightMargin(viewport.span) }); }}
          >
            »
          </button>
        ) : null}
      </div>

      <div
        className="candle-axis candle-price-axis" aria-hidden="true" data-movable={movable || undefined}
        onPointerDown={onAxisDown} onPointerMove={onAxisMove} onPointerUp={() => { axisDrag.current = null; }}
        onPointerCancel={() => { axisDrag.current = null; }} onDoubleClick={() => setYRange(null)}
      >
        {view ? (
          <>
            {view.ticks.map((tick) => {
              const top = view.y(tick) / H;
              return top < 0 || top > 1 ? null : <span key={tick} style={{ top: `${top * 100}%` }}>{view.axisText(tick)}</span>;
            })}
            {view.y(view.lastClose) >= 0 && view.y(view.lastClose) <= H ? (
              <span className="candle-tag" data-tone={tone(lastMove)} style={{ top: `${(view.y(view.lastClose) / H) * 100}%` }}>
                {view.axisText(view.lastClose, true)}
              </span>
            ) : null}
            {shown.flatMap((item) => {
              const prices = item.kind === "hline" || item.kind === "hray" ? [item.a.p]
                : item.id === selected && !["vline", "text", "brush", "avwap", "regression"].includes(item.kind)
                  ? [item.a.p, item.b.p, ...(item.c ? [item.c.p] : [])] : [];
              return prices.filter((value) => view.y(value) >= 0 && view.y(value) <= H).map((value, index) => (
                <span key={`tag-${item.id}-${index}`} className="candle-tag drawing-tag" style={{ top: `${(view.y(value) / H) * 100}%`, background: item.color ?? DEFAULT_DRAWING_COLOR }}>{price(value)}</span>
              ));
            })}
            {pointer && pointerPrice != null ? (
              <span className="candle-tag candle-cross" style={{ top: `${pointer.y * 100}%` }}>{view.axisText(pointerPrice, true)}</span>
            ) : null}
          </>
        ) : null}
      </div>
      {manual ? (
        <button type="button" className="candle-auto" title="Fit the price axis to the candles again" onClick={() => setYRange(null)}>AUTO</button>
      ) : null}
    </div>

    {view && view.momentum ? panes.map((pane) => (
      (EXTRA_PANES as Pane[]).includes(pane)
        ? <ExtraLowerPane key={pane} pane={pane as ExtraPane} name={paneName(pane, params)} height={resizable ? paneHeights[pane] : undefined} resizable={resizable} view={view as PaneView} panes={view.extra?.panes ?? null} at={at} hover={hover} />
        : <LowerPane key={pane} pane={pane} name={paneName(pane, params)} height={resizable ? paneHeights[pane] : undefined} resizable={resizable} view={view as PaneView} at={at} hover={hover} />
    )) : null}

    <div
      className="candle-dates" aria-hidden="true" data-movable={movable || undefined}
      onPointerDown={onDatesDown} onPointerMove={onDatesMove} onPointerUp={() => { datesDrag.current = null; }}
      onPointerCancel={() => { datesDrag.current = null; }} onDoubleClick={() => setNav(null)}
    >
      {view ? dateLabels(view.t, interval, compact ? 4 : Math.max(4, Math.round(8 * view.count / Math.max(view.span, 1)))).map((label) => {
        const left = view.x(label.index) / W;
        return left < 0.02 || left > 0.98 ? null : <span key={label.index} style={{ left: `${left * 100}%` }}>{label.text}</span>;
      }) : null}
      {view ? shown.filter((item) => item.kind === "vline").map((item) => {
        const left = screenOf(item.a).x / W;
        return left < 0 || left > 1 ? null : (
          <span key={`vtag-${item.id}`} className="candle-cross drawing-tag" style={{ left: `${left * 100}%`, background: item.color ?? DEFAULT_DRAWING_COLOR }}>
            {dateText(Math.round(item.a.t), interval).replace("Week of ", "")}
          </span>
        );
      }) : null}
      {view && hover != null ? (
        <span className="candle-cross" style={{ left: `${(view.x(hover) / W) * 100}%` }}>{dateText(view.t[hover], interval).replace("Week of ", "")}</span>
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

/** A lower pane's height before the reader drags it (app/io.css). */
const PANE_DEFAULT_PX = 92;

/** The top edge of a lower pane: dragged up, the pane grows and the candles give up the room; a double click puts it back. */
function PaneGrip({ pane }: { pane: string }) {
  const held = useRef<{ y: number; height: number } | null>(null);
  return (
    <div
      className="candle-pane-grip" title="Drag to resize · double-click to reset" aria-hidden="true"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        held.current = { y: event.clientY, height: event.currentTarget.parentElement?.getBoundingClientRect().height ?? PANE_DEFAULT_PX };
      }}
      onPointerMove={(event) => { if (held.current) setPaneHeight(pane, held.current.height - (event.clientY - held.current.y)); }}
      onPointerUp={() => { held.current = null; }}
      onPointerCancel={() => { held.current = null; }}
      onDoubleClick={() => setPaneHeight(pane, null)}
    />
  );
}

/** A pane's name with the reader's settings: "RSI 9" once the period is 9. */
const paneName = (pane: Pane, params: StudyParams | undefined) => {
  const name = studyName(pane, params, PANE_NAMES[pane]);
  return name === PANE_NAMES[pane] ? name : name.toUpperCase().replace("RELATIVE STRENGTH", "RS").replace("STOCHASTIC", "STOCH");
};

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
function LowerPane({ pane, name, height, resizable, view, at, hover }: {
  pane: Pane; name: string; height: number | undefined; resizable: boolean; view: PaneView; at: number | null; hover: number | null;
}) {
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
    <div className="candle-pane" data-pane={pane} style={height ? { height } : undefined}>
      {resizable ? <PaneGrip pane={pane} /> : null}
      <div className="candle-pane-plot">
        <span className="candle-pane-name">{name} {readout}</span>
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
function ExtraLowerPane({ pane, name, height, resizable, view, panes, at, hover }: {
  pane: ExtraPane; name: string; height: number | undefined; resizable: boolean; view: PaneView; panes: ExtraPanes | null; at: number | null; hover: number | null;
}) {
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
    <div className="candle-pane" data-pane={pane} style={height ? { height } : undefined}>
      {resizable ? <PaneGrip pane={pane} /> : null}
      <div className="candle-pane-plot">
        <span className="candle-pane-name">
          {name}{" "}
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

/* --- The reader's drawings ------------------------------------------------- */

const DASHES: Record<LineStyle, string | undefined> = { solid: undefined, dashed: "7 5", dotted: "1.5 3.5" };
const STROKES: Record<1 | 2 | 3, number> = { 1: 1.25, 2: 2, 3: 3 };
const TARGET_COLOR = "#26a69a";
const STOP_COLOR = "#ef5350";

type Spot = { x: number; y: number };

function strokeOf(item: Drawing): React.CSSProperties {
  return { stroke: item.color ?? DEFAULT_DRAWING_COLOR, strokeWidth: STROKES[item.width ?? 1], strokeDasharray: DASHES[item.style ?? "solid"] };
}

/**
 * One drawing, in the plot's stretched units. The few marks that must keep
 * their shape on any screen — an arrow's head — are worked out in pixels
 * (`sx`, `sy`: units per pixel) and brought back.
 */
type RegressionSpots = { mid: [Spot, Spot]; up: [Spot, Spot]; low: [Spot, Spot] };

function DrawingMark({ item, chosen, a, b, c, points, regression, sx, sy }: {
  item: Drawing; chosen: boolean; a: Spot; b: Spot; c: Spot | null; points: Spot[] | null; regression: RegressionSpots | null; sx: number; sy: number;
}) {
  const stroke = strokeOf(item);
  const color = item.color ?? DEFAULT_DRAWING_COLOR;
  const common = { vectorEffect: "non-scaling-stroke" as const };
  const className = chosen ? "drawing drawing-chosen" : "drawing";
  switch (item.kind) {
    case "hline":
      return <line className={className} style={stroke} x1={0} x2={W} y1={a.y} y2={a.y} {...common} />;
    case "hray":
      return <line className={className} style={stroke} x1={a.x} x2={W} y1={a.y} y2={a.y} {...common} />;
    case "vline":
      return <line className={className} style={stroke} x1={a.x} x2={a.x} y1={0} y2={H} {...common} />;
    case "trend":
      return <line className={className} style={stroke} x1={a.x} x2={b.x} y1={a.y} y2={b.y} {...common} />;
    case "ray":
    case "extended": {
      const line = lineReach(a, b, (W + H) * 6, item.kind === "extended");
      return <line className={className} style={stroke} x1={line.from.x} x2={line.to.x} y1={line.from.y} y2={line.to.y} {...common} />;
    }
    case "arrow": {
      // The head, 11 pixels long whatever the plot's shape.
      const dx = (b.x - a.x) / sx;
      const dy = (b.y - a.y) / sy;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const size = 9 + (item.width ?? 1) * 2;
      const wing = (side: number) => `${(b.x - (ux * size - uy * size * 0.45 * side) * sx).toFixed(2)},${(b.y - (uy * size + ux * size * 0.45 * side) * sy).toFixed(2)}`;
      return (
        <g>
          <line className={className} style={stroke} x1={a.x} x2={b.x - ux * size * 0.6 * sx} y1={a.y} y2={b.y - uy * size * 0.6 * sy} {...common} />
          <polygon points={`${b.x.toFixed(2)},${b.y.toFixed(2)} ${wing(1)} ${wing(-1)}`} style={{ fill: color }} />
        </g>
      );
    }
    case "channel": {
      const offset = channelOffset(a, b, c ?? a);
      const a2 = { x: a.x, y: a.y + offset };
      const b2 = { x: b.x, y: b.y + offset };
      return (
        <g>
          <polygon className="drawing-fill" points={`${a.x},${a.y} ${b.x},${b.y} ${b2.x},${b2.y} ${a2.x},${a2.y}`} style={{ fill: color }} />
          <line className={className} style={stroke} x1={a.x} x2={b.x} y1={a.y} y2={b.y} {...common} />
          <line className={className} style={stroke} x1={a2.x} x2={b2.x} y1={a2.y} y2={b2.y} {...common} />
          <line className="drawing drawing-mid" style={{ stroke: color }} x1={a.x} x2={b.x} y1={a.y + offset / 2} y2={b.y + offset / 2} {...common} />
        </g>
      );
    }
    case "rect":
      return (
        <rect className={`${className} drawing-zone`} style={{ ...stroke, fill: color }}
          x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} {...common} />
      );
    case "range": {
      const up = item.b.p >= item.a.p;
      const tint = up ? TARGET_COLOR : STOP_COLOR;
      const middle = (a.x + b.x) / 2;
      return (
        <g>
          <rect className="drawing-zone" style={{ fill: tint, stroke: "none" }} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} />
          <line className="drawing" style={{ stroke: tint }} x1={middle} x2={middle} y1={a.y} y2={b.y} {...common} />
          <line className="drawing" style={{ stroke: tint }} x1={a.x} x2={b.x} y1={(a.y + b.y) / 2} y2={(a.y + b.y) / 2} {...common} />
        </g>
      );
    }
    case "long":
    case "short": {
      const stop = c ?? a;
      const left = Math.min(a.x, b.x);
      const width = Math.abs(b.x - a.x);
      return (
        <g>
          <rect className="drawing-position" style={{ fill: TARGET_COLOR }} x={left} width={width} y={Math.min(a.y, b.y)} height={Math.abs(a.y - b.y)} />
          <rect className="drawing-position" style={{ fill: STOP_COLOR }} x={left} width={width} y={Math.min(a.y, stop.y)} height={Math.abs(a.y - stop.y)} />
          <line className="drawing" style={{ stroke: "#e9edf2", strokeWidth: 1 }} x1={left} x2={left + width} y1={a.y} y2={a.y} {...common} />
        </g>
      );
    }
    case "fib":
      return (
        <g>
          <line className="drawing drawing-swing" style={{ stroke: color }} x1={a.x} x2={b.x} y1={a.y} y2={b.y} {...common} />
          {DRAWN_FIB_RATIOS.map((ratio) => {
            const y = b.y + (a.y - b.y) * ratio;
            return <line key={ratio} className="drawing drawing-fib" style={{ ...stroke, strokeDasharray: undefined }} x1={Math.min(a.x, b.x)} x2={W} y1={y} y2={y} {...common} />;
          })}
        </g>
      );
    case "pitchfork": {
      const [median, upper, lower] = pitchforkLines(a, b, c ?? b, (W + H) * 6);
      return (
        <g>
          <polygon className="drawing-fill" points={`${upper.from.x},${upper.from.y} ${upper.to.x},${upper.to.y} ${lower.to.x},${lower.to.y} ${lower.from.x},${lower.from.y}`} style={{ fill: color }} />
          <line className={className} style={stroke} x1={median.from.x} x2={median.to.x} y1={median.from.y} y2={median.to.y} {...common} />
          <line className={className} style={stroke} x1={upper.from.x} x2={upper.to.x} y1={upper.from.y} y2={upper.to.y} {...common} />
          <line className={className} style={stroke} x1={lower.from.x} x2={lower.to.x} y1={lower.from.y} y2={lower.to.y} {...common} />
          <line className="drawing drawing-mid" style={{ stroke: color }} x1={b.x} x2={(c ?? b).x} y1={b.y} y2={(c ?? b).y} {...common} />
        </g>
      );
    }
    case "fibext": {
      const end = c ?? b;
      return (
        <g>
          <path className="drawing drawing-swing" style={{ stroke: color }} d={`M${a.x} ${a.y}L${b.x} ${b.y}L${end.x} ${end.y}`} {...common} />
          {FIB_EXTENSION_RATIOS.map((ratio) => {
            const y = end.y + (b.y - a.y) * ratio;
            return <line key={ratio} className="drawing drawing-fib" style={{ ...stroke, strokeDasharray: undefined }} x1={end.x} x2={W} y1={y} y2={y} {...common} />;
          })}
        </g>
      );
    }
    case "regression":
      return regression ? (
        <g>
          <polygon className="drawing-fill" points={`${regression.up[0].x},${regression.up[0].y} ${regression.up[1].x},${regression.up[1].y} ${regression.low[1].x},${regression.low[1].y} ${regression.low[0].x},${regression.low[0].y}`} style={{ fill: color }} />
          <line className={className} style={stroke} x1={regression.mid[0].x} x2={regression.mid[1].x} y1={regression.mid[0].y} y2={regression.mid[1].y} {...common} />
          <line className="drawing drawing-mid" style={{ stroke: color }} x1={regression.up[0].x} x2={regression.up[1].x} y1={regression.up[0].y} y2={regression.up[1].y} {...common} />
          <line className="drawing drawing-mid" style={{ stroke: color }} x1={regression.low[0].x} x2={regression.low[1].x} y1={regression.low[0].y} y2={regression.low[1].y} {...common} />
        </g>
      ) : null;
    case "avwap":
    case "brush":
      return points && points.length > 1 ? (
        <path className={className} style={{ ...stroke, strokeLinejoin: "round", strokeLinecap: "round" }}
          d={points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join("")} {...common} />
      ) : null;
    case "text":
      return null;
  }
}

/** The words a drawing carries: a retracement's levels, a range's move, a position's target, stop and ratio, a note. */
function DrawingNotes({ item, a, b, c, last, bars, noteAt, noteSide }: {
  item: Drawing; a: Spot; b: Spot; c: Spot | null; last: { at: Spot; p: number } | null; bars: number;
  noteAt: (x: number, y: number) => React.CSSProperties; noteSide: (x: number) => string | undefined;
}) {
  const color = item.color ?? DEFAULT_DRAWING_COLOR;
  if (item.kind === "fib") {
    const left = Math.min(a.x, b.x);
    return (
      <>
        {DRAWN_FIB_RATIOS.map((ratio) => (
          <span key={ratio} className={`drawing-note ${noteSide(left) ?? ""}`} style={{ ...noteAt(left, b.y + (a.y - b.y) * ratio), color }}>
            {ratioText(ratio)} {price(item.b.p + (item.a.p - item.b.p) * ratio)}
          </span>
        ))}
      </>
    );
  }
  if (item.kind === "fibext") {
    const end = c ?? b;
    return (
      <>
        {FIB_EXTENSION_RATIOS.map((ratio) => (
          <span key={ratio} className={`drawing-note ${noteSide(end.x) ?? ""}`} style={{ ...noteAt(end.x, end.y + (b.y - a.y) * ratio), color }}>
            {ratioText(ratio)} {price((item.c ?? item.b).p + (item.b.p - item.a.p) * ratio)}
          </span>
        ))}
      </>
    );
  }
  if (item.kind === "avwap" && last) {
    return <span className="drawing-note study-note-flip" style={{ ...noteAt(last.at.x, last.at.y), color }}>AVWAP {price(last.p)}</span>;
  }
  if (item.kind === "range") {
    const change = item.b.p - item.a.p;
    return (
      <span className="drawing-label" data-tone={tone(change)} style={noteAt((a.x + b.x) / 2, Math.max(a.y, b.y))}>
        {signed(change)} ({item.a.p ? percent(change / item.a.p) : "—"}) · {Math.abs(bars)} {Math.abs(bars) === 1 ? "bar" : "bars"}
      </span>
    );
  }
  if (item.kind === "long" || item.kind === "short") {
    const figures = positionFigures(item);
    const stop = c ?? a;
    const targetAbove = b.y < a.y;
    // Near the right edge the words are written leftwards from the box's right side, so they stay on screen.
    const flip = noteSide(Math.min(a.x, b.x)) != null;
    const x = flip ? Math.max(a.x, b.x) : Math.min(a.x, b.x);
    const shift = (vertical: string) => ({ transform: `translate(${flip ? "-100%" : "0"}, ${vertical})` });
    return (
      <>
        <span className="drawing-label drawing-label-left" data-tone="good" style={{ ...noteAt(x, b.y), ...shift(targetAbove ? "-100%" : "0") }}>
          Target {price(figures.target)} ({percent(figures.targetMove)})
        </span>
        <span className="drawing-label drawing-label-left" data-tone="bad" style={{ ...noteAt(x, stop.y), ...shift(targetAbove ? "0" : "-100%") }}>
          Stop {price(figures.stop)} ({percent(figures.stopMove)})
        </span>
        <span className="drawing-label drawing-label-left" style={{ ...noteAt(x, a.y), ...shift("-50%") }}>
          {item.kind === "long" ? "Long" : "Short"} {price(figures.entry)}{figures.ratio != null ? ` · R:R ${figures.ratio.toFixed(2)}` : ""}
        </span>
      </>
    );
  }
  if (item.kind === "text") {
    return (
      <span className="drawing-text" style={{ ...noteAt(a.x, a.y), color, fontSize: `${10 + (item.width ?? 1) * 2}px` }}>
        {item.text || "Note"}
      </span>
    );
  }
  return null;
}

/** The bar over the plot for the drawing selected: colour, width, line, its note, lock, copy, delete. */
function DrawingBar({ drawing, focusText, alert, onChange, onDelete, onClone }: {
  drawing: Drawing; focusText: boolean; alert: { on: boolean; toggle: () => void } | null;
  onChange: (next: Drawing) => void; onDelete: () => void; onClone: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const lines = drawing.kind !== "text" && drawing.kind !== "long" && drawing.kind !== "short" && drawing.kind !== "range";
  const commitText = () => { if (text != null && text !== drawing.text) onChange({ ...drawing, text: text.slice(0, 120) }); setText(null); };
  return (
    <div className="drawing-bar" role="toolbar" aria-label="Selected drawing"
      onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      {drawing.kind !== "long" && drawing.kind !== "short" && drawing.kind !== "range" ? (
        <span className="drawing-swatches">
          {DRAWING_COLORS.map((color) => (
            <button key={color} type="button" aria-label={`Colour ${color}`} aria-pressed={(drawing.color ?? DEFAULT_DRAWING_COLOR) === color}
              style={{ background: color }} onClick={() => onChange({ ...drawing, color })} />
          ))}
        </span>
      ) : null}
      {drawing.kind !== "long" && drawing.kind !== "short" && drawing.kind !== "range" ? (
        <span className="seg" role="group" aria-label={drawing.kind === "text" ? "Size" : "Width"}>
          {([1, 2, 3] as const).map((width) => (
            <button key={width} type="button" aria-pressed={(drawing.width ?? 1) === width} onClick={() => onChange({ ...drawing, width })}
              title={drawing.kind === "text" ? ["Small", "Medium", "Large"][width - 1] : `${width} px`}>
              {drawing.kind === "text" ? ["S", "M", "L"][width - 1] : <i className="drawing-weight" style={{ height: STROKES[width] }} />}
            </button>
          ))}
        </span>
      ) : null}
      {lines ? (
        <span className="seg" role="group" aria-label="Line">
          {(["solid", "dashed", "dotted"] as const).map((style) => (
            <button key={style} type="button" aria-pressed={(drawing.style ?? "solid") === style} title={style[0].toUpperCase() + style.slice(1)} onClick={() => onChange({ ...drawing, style })}>
              {style === "solid" ? "──" : style === "dashed" ? "╌╌" : "┈┈"}
            </button>
          ))}
        </span>
      ) : null}
      {drawing.kind === "text" ? (
        <input
          className="drawing-text-field" value={text ?? drawing.text ?? ""} maxLength={120} aria-label="Note"
          // The note the reader has just placed: they will want to write it.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={focusText}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setText(event.target.value)} onBlur={commitText}
          onKeyDown={(event) => { if (event.key === "Enter") { commitText(); event.currentTarget.blur(); } if (event.key === "Escape") { setText(null); event.currentTarget.blur(); } }}
        />
      ) : null}
      {alert ? (
        <button type="button" aria-pressed={alert.on} title={alert.on ? "Remove the alert on this line" : "Alert when the price crosses this line (ALRT, and by email if on)"} onClick={alert.toggle}>
          {alert.on ? "Alert on" : "Alert"}
        </button>
      ) : null}
      <button type="button" aria-pressed={drawing.locked === true} title={drawing.locked ? "Unlock" : "Lock in place"} onClick={() => onChange({ ...drawing, locked: !drawing.locked })}>
        {drawing.locked ? "Unlock" : "Lock"}
      </button>
      <button type="button" title="Duplicate" onClick={onClone}>Copy</button>
      <button type="button" className="drawing-delete" title="Delete · Del" onClick={onDelete}>Delete</button>
    </div>
  );
}
