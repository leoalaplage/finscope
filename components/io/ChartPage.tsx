"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AreaSeries, BarSeries, CandlestickSeries, createChart, CrosshairMode, HistogramSeries, LineSeries, LineStyle, PriceScaleMode,
  type IChartApi, type IPrimitivePaneRenderer, type IPrimitivePaneView, type ISeriesApi, type ISeriesPrimitive,
  type MouseEventParams, type SeriesAttachedParameter, type SeriesType, type Time, type UTCTimestamp,
} from "lightweight-charts";
import type { Candles, CandleInterval } from "@/lib/adapters/candles";
import { CANDLE_INTERVALS } from "@/lib/adapters/candles";
import {
  addIndicator, clampPeriod, HAS_PERIOD, INDICATOR_NAMES, INTERVAL_LABELS, intervalForRange,
  OVERLAYS, RANGES, rangeStart, readDrawings, readSettings, STYLE_NAMES,
  type Anchor, type ChartRange, type ChartSettings, type ChartStyle, type Drawing, type Indicator, type IndicatorKind, type Tool,
} from "@/lib/io/chart-page";
import {
  atr, autoSwing, bollinger, ema, fibonacciLevels, heikinAshi, macd, rsi, sma, stochastic, vwap,
  type Bar, type Line, type Swing,
} from "@/lib/io/indicators";
import { useRememberedCompany } from "./remembered";
import { Search } from "./Search";
import { readTheme, subscribeTheme } from "./theme";

/**
 * A price chart to work on, in the manner of a trading terminal.
 *
 * Candles at intervals from five minutes to a month, the usual indicators over
 * the price or in panes beneath it, and three drawing tools — a Fibonacci
 * retracement, a trend line, a horizontal level. Drawn by TradingView's own
 * open-source charting library; the data is Yahoo's, through this site's
 * cache (app/api/candles), and every indicator is computed here, over the
 * whole history, so a 200-day average is right on the first bar shown.
 *
 * What a reader sets up is kept on this device: the style, the interval and
 * the indicators for every chart, and the drawings for each symbol.
 */

const SETTINGS_KEY = "finscope.chart.v1";
const DRAWINGS_KEY = (symbol: string) => `finscope.chart.drawings.${symbol}`;
const STORE_EVENT = "finscope:chart-store";

function subscribeStore(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(STORE_EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(STORE_EVENT, notify); };
}
function readStore(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* kept for this visit only */ }
  window.dispatchEvent(new Event(STORE_EVENT));
}
function subscribeAddress(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener(STORE_EVENT, notify);
  return () => { window.removeEventListener("popstate", notify); window.removeEventListener(STORE_EVENT, notify); };
}

const subscribeNothing = () => () => {};

interface Palette { bg: string; ink: string; ink3: string; line: string; lineStrong: string; gain: string; loss: string; plot: string; raise: string }

/** The site's tokens are set on its `.io` shell, not on the document root. */
function readPalette(): Palette {
  const style = getComputedStyle(document.querySelector(".io") ?? document.documentElement);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: get("--bg", "#000"), ink: get("--ink", "#fafafa"), ink3: get("--ink-3", "#85858e"),
    line: get("--line", "#1c1c1f"), lineStrong: get("--line-strong", "#33333a"),
    gain: get("--gain", "#26a69a"), loss: get("--loss", "#ef5350"), plot: get("--plot", "#fafafa"), raise: get("--raise", "#0a0a0b"),
  };
}

/** A colour with some transparency, for fills. Accepts #rgb and #rrggbb; anything else is returned as it is. */
function tint(color: string, alpha: number) {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return color;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const priceText = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  return value.toLocaleString("en-US", { minimumFractionDigits: abs >= 1 ? 2 : 4, maximumFractionDigits: abs >= 1 ? 2 : 4 });
};
const changeText = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(value) >= 0.1 ? 2 : 4 });
const volumeText = (value: number | null | undefined) => {
  if (value == null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
};

/* ---- Time and position -------------------------------------------------- */

/** The fractional bar position of a time, extrapolated past either end at the last spacing. */
function logicalOfTime(times: number[], time: number): number | null {
  const n = times.length;
  if (!n) return null;
  if (n === 1) return 0;
  if (time <= times[0]) return (time - times[0]) / (times[1] - times[0]);
  if (time >= times[n - 1]) return n - 1 + (time - times[n - 1]) / (times[n - 1] - times[n - 2]);
  let low = 0, high = n - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle] <= time) low = middle; else high = middle;
  }
  return low + (time - times[low]) / (times[high] - times[low]);
}

function timeOfLogical(times: number[], logical: number): number | null {
  const n = times.length;
  if (!n) return null;
  if (n === 1) return times[0];
  const index = Math.round(logical);
  if (index <= 0) return times[0] + (logical) * (times[1] - times[0]);
  if (index >= n - 1) return times[n - 1] + (logical - (n - 1)) * (times[n - 1] - times[n - 2]);
  return times[index];
}

/* ---- Drawings on the canvas ---------------------------------------------- */

interface Scene {
  drawings: Drawing[];
  pending: Drawing | null;
  auto: Swing | null;
  times: number[];
  palette: Palette | null;
}

const FIB_COLORS = ["#787b86", "#f23645", "#ff9800", "#4caf50", "#089981", "#00bcd4", "#787b86", "#2962ff", "#9c27b0"];

type DrawTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

class DrawingLayer implements ISeriesPrimitive<Time> {
  scene: Scene = { drawings: [], pending: null, auto: null, times: [], palette: null };
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;
  private readonly view: IPrimitivePaneView = { zOrder: () => "top", renderer: () => ({ draw: (target) => this.draw(target) }) };

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.redraw = param.requestUpdate;
  }
  detached() { this.chart = null; this.series = null; this.redraw = null; }
  paneViews() { return [this.view]; }
  updateAllViews() { /* positions are read at draw time */ }

  update(scene: Partial<Scene>) {
    this.scene = { ...this.scene, ...scene };
    this.redraw?.();
  }

  private x(time: number) {
    const logical = logicalOfTime(this.scene.times, time);
    if (logical == null || !this.chart) return null;
    return this.chart.timeScale().logicalToCoordinate(logical as never);
  }
  private y(price: number) {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  private draw(target: DrawTarget) {
    const palette = this.scene.palette;
    if (!palette) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.textBaseline = "bottom";
      if (this.scene.auto) this.fib({ id: "auto", type: "fib", a: this.scene.auto.from, b: this.scene.auto.to }, ctx, mediaSize.width, true);
      for (const drawing of [...this.scene.drawings, ...(this.scene.pending ? [this.scene.pending] : [])]) {
        if (drawing.type === "fib") this.fib(drawing, ctx, mediaSize.width, false);
        else if (drawing.type === "trend") this.trend(drawing, ctx, palette);
        else this.hline(drawing, ctx, mediaSize.width, palette);
      }
      ctx.restore();
    });
  }

  private fib(drawing: Extract<Drawing, { type: "fib" }>, ctx: CanvasRenderingContext2D, width: number, auto: boolean) {
    const xa = this.x(drawing.a.time), xb = this.x(drawing.b.time);
    if (xa == null || xb == null) return;
    const left = Math.min(xa, xb);
    const levels = fibonacciLevels(drawing.a.price, drawing.b.price, true);
    const ys = levels.map((level) => this.y(level.price));
    // Shade between neighbouring levels, the way platforms do, faintly.
    for (let index = 0; index < levels.length - 1; index++) {
      const top = ys[index], bottom = ys[index + 1];
      if (top == null || bottom == null) continue;
      ctx.fillStyle = tint(FIB_COLORS[index % FIB_COLORS.length], auto ? 0.04 : 0.08);
      ctx.fillRect(left, Math.min(top, bottom), width - left, Math.abs(bottom - top));
    }
    levels.forEach((level, index) => {
      const y = ys[index];
      if (y == null) return;
      const color = FIB_COLORS[index % FIB_COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(auto ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(left, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(`${(level.ratio * 100).toFixed(1).replace(/\.0$/, "")}% (${priceText(level.price)})`, left + 4, y - 2);
    });
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = FIB_COLORS[0];
    ctx.beginPath();
    const ya = this.y(drawing.a.price), yb = this.y(drawing.b.price);
    if (ya != null && yb != null) { ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  private trend(drawing: Extract<Drawing, { type: "trend" }>, ctx: CanvasRenderingContext2D, palette: Palette) {
    const xa = this.x(drawing.a.time), xb = this.x(drawing.b.time);
    const ya = this.y(drawing.a.price), yb = this.y(drawing.b.price);
    if (xa == null || xb == null || ya == null || yb == null) return;
    ctx.strokeStyle = "#2962ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xa, ya);
    ctx.lineTo(xb, yb);
    ctx.stroke();
    ctx.fillStyle = palette.bg;
    ctx.strokeStyle = "#2962ff";
    ctx.lineWidth = 1.5;
    for (const [x, y] of [[xa, ya], [xb, yb]]) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }

  private hline(drawing: Extract<Drawing, { type: "hline" }>, ctx: CanvasRenderingContext2D, width: number, palette: Palette) {
    const y = this.y(drawing.a.price);
    if (y == null) return;
    ctx.strokeStyle = palette.ink3;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = palette.ink3;
    ctx.fillText(priceText(drawing.a.price), 4, y - 2);
  }
}

/* ---- Indicators as series ------------------------------------------------ */

interface Computed { id: string; label: string; color: string; values: Array<{ name: string; line: Line; color: string }> }

function compute(indicator: Indicator, bars: Bar[], intraday: boolean, palette: Palette): Computed {
  const closes: Line = bars.map((bar) => bar.close);
  const label = HAS_PERIOD.has(indicator.kind) ? `${INDICATOR_NAMES[indicator.kind]} ${indicator.period}` : INDICATOR_NAMES[indicator.kind];
  const one = (line: Line, color = indicator.color) => ({ id: indicator.id, label, color, values: [{ name: label, line, color }] });
  switch (indicator.kind) {
    case "sma": return one(sma(closes, indicator.period));
    case "ema": return one(ema(closes, indicator.period));
    case "rsi": return one(rsi(closes, indicator.period));
    case "atr": return one(atr(bars, indicator.period));
    case "vwap": {
      // Restarted each session intraday; over daily bars, anchored at each year.
      const line = vwap(bars, (bar) => (intraday ? Math.floor(bar.time / 86_400) : new Date(bar.time * 1000).getUTCFullYear()));
      return { ...one(line), label: intraday ? "VWAP" : "VWAP (yearly)" };
    }
    case "bb": {
      const bands = bollinger(closes, indicator.period, 2);
      return { id: indicator.id, label: `${label}, 2`, color: indicator.color, values: [
        { name: "Upper", line: bands.upper, color: indicator.color },
        { name: "Basis", line: bands.middle, color: tint(indicator.color, 0.6) },
        { name: "Lower", line: bands.lower, color: indicator.color },
      ] };
    }
    case "macd": {
      const result = macd(closes, 12, 26, 9);
      return { id: indicator.id, label: "MACD 12, 26, 9", color: indicator.color, values: [
        { name: "Histogram", line: result.histogram, color: palette.ink3 },
        { name: "MACD", line: result.macd, color: "#2962ff" },
        { name: "Signal", line: result.signal, color: "#ff6d00" },
      ] };
    }
    case "stoch": {
      const result = stochastic(bars, indicator.period, 3, 3);
      return { id: indicator.id, label: `Stoch ${indicator.period}, 3, 3`, color: indicator.color, values: [
        { name: "%K", line: result.k, color: "#2962ff" },
        { name: "%D", line: result.d, color: "#ff6d00" },
      ] };
    }
    case "volume": return { id: indicator.id, label: "Volume", color: palette.ink3, values: [{ name: "Volume", line: bars.map((bar) => bar.volume), color: palette.ink3 }] };
  }
}

const asTime = (seconds: number) => seconds as UTCTimestamp;
const points = (bars: Bar[], line: Line) => {
  const out: Array<{ time: UTCTimestamp; value: number }> = [];
  line.forEach((value, index) => { if (value != null && Number.isFinite(value)) out.push({ time: asTime(bars[index].time), value }); });
  return out;
};

/* ---- The page ------------------------------------------------------------ */

type Load = { key: string; candles: Candles | null; error: string | null };

export function ChartPage({ initial }: { initial: string }) {
  const search = useSyncExternalStore(subscribeAddress, () => window.location.search, () => "");
  const asked = new URLSearchParams(search).get("s")?.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "") ?? "";
  const remembered = useRememberedCompany();
  const symbol = asked || remembered || initial;

  const storedSettings = useSyncExternalStore(subscribeStore, () => readStore(SETTINGS_KEY), () => null);
  const settings = useMemo(() => readSettings(storedSettings), [storedSettings]);
  const setSettings = useCallback((change: Partial<ChartSettings>) => writeStore(SETTINGS_KEY, { ...settings, ...change }), [settings]);

  const storedDrawings = useSyncExternalStore(subscribeStore, () => readStore(DRAWINGS_KEY(symbol)), () => null);
  const drawings = useMemo(() => readDrawings(storedDrawings), [storedDrawings]);
  const setDrawings = useCallback((next: Drawing[]) => writeStore(DRAWINGS_KEY(symbol), next), [symbol]);

  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark");
  const interval = settings.interval;
  const key = `${symbol}:${interval}`;
  const [load, setLoad] = useState<Load>({ key: "", candles: null, error: null });
  const loading = load.key !== key;
  const candles = loading ? null : load.candles;

  const [range, setRange] = useState<{ key: string; range: ChartRange } | null>(null);
  const [tool, setTool] = useState<Tool>("cursor");
  const [pending, setPending] = useState<Drawing | null>(null);
  const [autoFib, setAutoFib] = useState(false);
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const layerRef = useRef<DrawingLayer>(new DrawingLayer());
  const [autoSwingState, setAutoSwing] = useState<Swing | null>(null);

  /* Data. */
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/candles/${encodeURIComponent(symbol)}?interval=${interval}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as Partial<Candles> & { error?: string };
        if (!response.ok) throw new Error(body?.error ?? `The server answered ${response.status}.`);
        if (!body.t?.length) throw new Error(`No price history for ${symbol}.`);
        setLoad({ key, candles: body as Candles, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ key, candles: null, error: error instanceof Error ? error.message : "Unreachable." });
      });
    return () => controller.abort();
  }, [key, symbol, interval]);

  const bars = useMemo<Bar[]>(() => {
    if (!candles) return [];
    return candles.t.map((time, index) => ({ time, open: candles.o[index], high: candles.h[index], low: candles.l[index], close: candles.c[index], volume: candles.v[index] }));
  }, [candles]);
  const times = useMemo(() => bars.map((bar) => bar.time), [bars]);
  const intraday = interval === "5m" || interval === "15m" || interval === "1h";

  // Null on the server and through hydration, so the first render matches the
  // prerendered document; read from the page's own tokens after that.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const palette = useMemo(() => (hydrated ? readPalette() : null),
    // The palette is the theme's; reading it again when the theme changes is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, hydrated]);

  const computed = useMemo(() => (palette ? settings.indicators.map((indicator) => compute(indicator, bars, intraday, palette)) : []), [settings.indicators, bars, intraday, palette]);

  /* The chart itself, once. */
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      autoSize: true,
      crosshair: { mode: CrosshairMode.Normal },
      layout: { attributionLogo: true, panes: { separatorColor: "transparent", enableResize: true } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 6 },
    });
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; mainRef.current = null; seriesRef.current = []; };
  }, []);

  /* Colours. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !palette) return;
    chart.applyOptions({
      layout: { background: { color: palette.bg }, textColor: palette.ink3, fontSize: 11, panes: { separatorColor: palette.line } },
      grid: { vertLines: { color: palette.line }, horzLines: { color: palette.line } },
      crosshair: { vertLine: { color: palette.ink3, labelBackgroundColor: palette.lineStrong }, horzLine: { color: palette.ink3, labelBackgroundColor: palette.lineStrong } },
    });
    layerRef.current.update({ palette });
  }, [palette]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      rightPriceScale: { mode: settings.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { timeVisible: intraday, secondsVisible: false },
    });
  }, [settings.log, intraday]);

  /* Series: rebuilt whenever what is drawn changes. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !palette) return;
    const keep = mainRef.current ? chart.timeScale().getVisibleLogicalRange() : null;
    if (mainRef.current) mainRef.current.detachPrimitive(layerRef.current);
    for (const series of seriesRef.current) chart.removeSeries(series);
    seriesRef.current = [];
    mainRef.current = null;
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);
    if (!bars.length) return;

    const style: ChartStyle = settings.style;
    const shown = style === "heikin" ? heikinAshi(bars) : bars;
    const ohlc = shown.map((bar) => ({ time: asTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close }));
    const up = palette.gain, down = palette.loss;
    let main: ISeriesApi<SeriesType>;
    if (style === "line") {
      main = chart.addSeries(LineSeries, { color: palette.plot, lineWidth: 2 });
      main.setData(shown.map((bar) => ({ time: asTime(bar.time), value: bar.close })));
    } else if (style === "area") {
      main = chart.addSeries(AreaSeries, { lineColor: palette.plot, topColor: tint("#2962ff", 0.28), bottomColor: tint("#2962ff", 0.02), lineWidth: 2 });
      main.setData(shown.map((bar) => ({ time: asTime(bar.time), value: bar.close })));
    } else if (style === "bars") {
      main = chart.addSeries(BarSeries, { upColor: up, downColor: down, thinBars: false });
      main.setData(ohlc);
    } else {
      const hollow = style === "hollow";
      main = chart.addSeries(CandlestickSeries, {
        upColor: hollow ? "rgba(0,0,0,0)" : up, downColor: down,
        borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
      });
      main.setData(ohlc);
    }
    main.attachPrimitive(layerRef.current);
    mainRef.current = main;
    const made: ISeriesApi<SeriesType>[] = [main];

    let pane = 0;
    settings.indicators.forEach((indicator, index) => {
      const result = computed[index];
      if (!result) return;
      if (indicator.kind === "volume") {
        const volume = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
        volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        volume.setData(bars.flatMap((bar) => bar.volume == null ? [] : [{
          time: asTime(bar.time), value: bar.volume, color: tint(bar.close >= bar.open ? up : down, 0.45),
        }]));
        made.push(volume);
        return;
      }
      const target = OVERLAYS.has(indicator.kind) ? 0 : ++pane;
      for (const value of result.values) {
        if (value.name === "Histogram") {
          const histogram = chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, target);
          histogram.setData(points(bars, value.line).map((point) => ({ ...point, color: tint(point.value >= 0 ? up : down, 0.6) })));
          made.push(histogram);
          continue;
        }
        const line = chart.addSeries(LineSeries, {
          color: value.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: target !== 0 || indicator.kind !== "bb",
          crosshairMarkerVisible: false, title: target === 0 ? "" : value.name === result.label ? "" : value.name,
        }, target);
        line.setData(points(bars, value.line));
        made.push(line);
        if (value.name === result.values[0].name) {
          const guides = indicator.kind === "rsi" ? [70, 30] : indicator.kind === "stoch" ? [80, 20] : indicator.kind === "macd" ? [0] : [];
          for (const price of guides) line.createPriceLine({ price, color: palette.lineStrong, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
        }
      }
    });
    seriesRef.current = made;
    const panes = chart.panes();
    panes.forEach((item, index) => item.setStretchFactor(index === 0 ? 3 : 1));

    if (keep) chart.timeScale().setVisibleLogicalRange(keep);
  }, [bars, computed, settings.style, settings.indicators, palette]);

  /* What part of the history is shown: a chosen range, or the last hundred and fifty bars. */
  const rangeKey = range?.key === key ? range.range : null;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !times.length) return;
    if (rangeKey) {
      const from = rangeStart(rangeKey, times);
      const first = from == null ? 0 : Math.max(0, Math.floor(logicalOfTime(times, from) ?? 0));
      chart.timeScale().setVisibleLogicalRange({ from: first - 0.5, to: times.length - 1 + 3 });
    } else {
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, times.length - 150), to: times.length - 1 + 6 });
    }
  }, [times, rangeKey]);

  /* Automatic Fibonacci, on whatever is on screen. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !autoFib || !bars.length) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visible = chart.timeScale().getVisibleLogicalRange();
        if (!visible) return;
        const from = Math.max(0, Math.ceil(visible.from)), to = Math.min(bars.length - 1, Math.floor(visible.to));
        setAutoSwing(autoSwing(bars.slice(from, to + 1)));
      });
    };
    measure();
    chart.timeScale().subscribeVisibleLogicalRangeChange(measure);
    return () => { cancelAnimationFrame(frame); chart.timeScale().unsubscribeVisibleLogicalRangeChange(measure); };
  }, [autoFib, bars]);

  useEffect(() => {
    layerRef.current.update({ drawings, pending, auto: autoFib ? autoSwingState : null, times });
  }, [drawings, pending, autoFib, autoSwingState, times]);

  /* Pointer: the legend follows it, and the drawing tools take their anchors from it. */
  const anchorAt = useCallback((param: MouseEventParams<Time>): Anchor | null => {
    const series = mainRef.current;
    if (!param.point || param.logical == null || !series) return null;
    const price = series.coordinateToPrice(param.point.y);
    const time = timeOfLogical(times, param.logical);
    if (price == null || time == null) return null;
    // Near a candle's high or low, the anchor goes to it, as it does on the platforms.
    const bar = bars[Math.round(param.logical)];
    if (bar) {
      for (const level of [bar.high, bar.low]) {
        const y = series.priceToCoordinate(level);
        if (y != null && Math.abs(y - param.point.y) < 8) return { time, price: level };
      }
    }
    return { time, price };
  }, [times, bars]);

  /*
   * One subscription for the life of the chart, reading the latest state from
   * refs. Subscribing again on every change meant a new handler for every
   * pointer move while a drawing was in progress, and a click could land
   * between one handler leaving and the next arriving.
   */
  const live = useRef({ tool, pending, drawings, anchorAt, setDrawings });
  useEffect(() => { live.current = { tool, pending, drawings, anchorAt, setDrawings }; });

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onMove = (param: MouseEventParams<Time>) => {
      setHover(param.logical == null || !param.point ? null : Math.round(param.logical));
      const { pending: drawing, anchorAt: at } = live.current;
      if (!drawing || drawing.type === "hline") return;
      const point = at(param);
      if (point) {
        const next = { ...drawing, b: point };
        live.current.pending = next;
        setPending(next);
      }
    };
    const onClick = (param: MouseEventParams<Time>) => {
      const { tool: current, pending: drawing, drawings: list, anchorAt: at, setDrawings: save } = live.current;
      if (current === "cursor") return;
      const point = at(param);
      if (!point) return;
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      if (current === "hline") {
        save([...list, { id, type: "hline", a: point }]);
        live.current.tool = "cursor";
        setTool("cursor");
        return;
      }
      if (!drawing) {
        const started: Drawing = { id, type: current, a: point, b: point };
        live.current.pending = started;
        setPending(started);
        return;
      }
      save([...list, drawing.type === "hline" ? drawing : { ...drawing, b: point }]);
      live.current.pending = null;
      live.current.tool = "cursor";
      setPending(null);
      setTool("cursor");
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    // Two clicks in quick succession reach the chart as a double click and
    // not as a second click; placing two anchors fast is still two anchors.
    chart.subscribeDblClick(onClick);
    return () => { chart.unsubscribeCrosshairMove(onMove); chart.unsubscribeClick(onClick); chart.unsubscribeDblClick(onClick); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPending(null); setTool("cursor"); setMenu(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = (next: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("s", next.toUpperCase());
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(STORE_EVENT));
    setPending(null);
  };

  const pickTool = (next: Tool) => {
    setPending(null);
    setTool((current) => (current === next ? "cursor" : next));
  };

  const pickRange = (next: ChartRange) => {
    const nextInterval = intervalForRange(next, interval);
    if (nextInterval !== interval) setSettings({ interval: nextInterval });
    setRange({ key: `${symbol}:${nextInterval}`, range: next });
  };

  const updateIndicator = (id: string, change: Partial<Indicator>) =>
    setSettings({ indicators: settings.indicators.map((item) => (item.id === id ? { ...item, ...change } : item)) });

  /* Legend. */
  const index = hover != null && hover >= 0 && hover < bars.length ? hover : bars.length - 1;
  const bar = bars[index];
  const before = bars[index - 1];
  const change = bar && before ? bar.close - before.close : null;
  const changePct = change != null && before ? change / before.close : null;
  const last = bars.at(-1);
  const lastChange = last && bars.at(-2) ? last.close - bars.at(-2)!.close : null;
  const tone = (value: number | null) => (value == null ? undefined : value >= 0 ? "good" : "bad");

  return (
    <main className="wrap chart-route" id="main-content" tabIndex={-1}>
      <header className="chart-head">
        <div className="chart-title">
          <h1>{symbol}</h1>
          <span className="dim">{candles ? [candles.name !== candles.symbol ? candles.name : null, candles.exchange, candles.currency].filter(Boolean).join(" · ") : ""}</span>
        </div>
        {last ? (
          <div className="chart-last">
            <span className="chart-price">{priceText(last.close)}</span>
            <span className="chart-change" data-tone={tone(lastChange)}>
              {lastChange == null ? "" : `${lastChange >= 0 ? "+" : ""}${changeText(lastChange)} (${lastChange >= 0 ? "+" : ""}${((lastChange / bars.at(-2)!.close) * 100).toFixed(2)}%)`}
            </span>
          </div>
        ) : null}
        <div className="chart-search"><Search onPick={choose} /></div>
      </header>

      <div className="chart-toolbar" role="toolbar" aria-label="Chart controls">
        <div className="chart-group" role="group" aria-label="Interval">
          {CANDLE_INTERVALS.map((item: CandleInterval) => (
            <button type="button" key={item} aria-pressed={interval === item} onClick={() => { setSettings({ interval: item }); setPending(null); }}>{INTERVAL_LABELS[item]}</button>
          ))}
        </div>
        <label className="chart-select">
          <span className="sr-only">Chart style</span>
          <select value={settings.style} onChange={(event) => setSettings({ style: event.target.value as ChartStyle })}>
            {(Object.keys(STYLE_NAMES) as ChartStyle[]).map((style) => <option key={style} value={style}>{STYLE_NAMES[style]}</option>)}
          </select>
        </label>
        <div className="chart-menu">
          <button type="button" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>Indicators <span aria-hidden="true">{menu ? "−" : "+"}</span></button>
          {menu ? (
            <div className="chart-menu-panel" role="menu">
              {(Object.keys(INDICATOR_NAMES) as IndicatorKind[]).map((kind) => (
                <button type="button" role="menuitem" key={kind} onClick={() => { setSettings({ indicators: addIndicator(settings.indicators, kind) }); setMenu(false); }}>
                  {INDICATOR_NAMES[kind]}
                  <span className="dim">{OVERLAYS.has(kind) ? "on price" : "own pane"}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="chart-group" role="group" aria-label="Drawing tools">
          <button type="button" aria-pressed={tool === "fib"} onClick={() => pickTool("fib")} title="Fibonacci retracement: click the start of the move, then its end">Fib</button>
          <button type="button" aria-pressed={tool === "trend"} onClick={() => pickTool("trend")} title="Trend line: click two points">Trend</button>
          <button type="button" aria-pressed={tool === "hline"} onClick={() => pickTool("hline")} title="Horizontal level: click a price">Level</button>
          <button type="button" aria-pressed={autoFib} onClick={() => setAutoFib((on) => !on)} title="Fibonacci on the highest high and lowest low in view">Auto Fib</button>
          <button type="button" disabled={!drawings.length} onClick={() => setDrawings(drawings.slice(0, -1))} title="Remove the last drawing">Undo</button>
          <button type="button" disabled={!drawings.length} onClick={() => setDrawings([])}>Clear</button>
        </div>
        <div className="chart-group" role="group" aria-label="Scale">
          <button type="button" aria-pressed={settings.log} onClick={() => setSettings({ log: !settings.log })} title="Logarithmic price scale">Log</button>
        </div>
      </div>

      {settings.indicators.length ? (
        <ul className="chart-chips" aria-label="Indicators on the chart">
          {settings.indicators.map((indicator, position) => {
            const result = computed[position];
            return (
              <li key={indicator.id}>
                {indicator.kind !== "volume" && indicator.kind !== "macd" && indicator.kind !== "stoch" ? (
                  <input type="color" aria-label={`${INDICATOR_NAMES[indicator.kind]} colour`} value={/^#[0-9a-f]{6}$/i.test(indicator.color) ? indicator.color : "#f5a524"} onChange={(event) => updateIndicator(indicator.id, { color: event.target.value })} />
                ) : null}
                <span>{INDICATOR_NAMES[indicator.kind]}</span>
                {HAS_PERIOD.has(indicator.kind) ? (
                  <input
                    type="number" min={1} max={500} inputMode="numeric" aria-label={`${INDICATOR_NAMES[indicator.kind]} period`}
                    defaultValue={indicator.period} key={`${indicator.id}-${indicator.period}`}
                    onBlur={(event) => updateIndicator(indicator.id, { period: clampPeriod(Number(event.target.value)) })}
                    onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                  />
                ) : null}
                <span className="chart-chip-values">
                  {result?.values.map((value) => (
                    <span key={value.name} style={{ color: value.color || undefined }}>
                      {indicator.kind === "volume" ? volumeText(value.line[index]) : priceText(value.line[index])}
                    </span>
                  ))}
                </span>
                <button type="button" aria-label={`Remove ${result?.label ?? INDICATOR_NAMES[indicator.kind]}`} onClick={() => setSettings({ indicators: settings.indicators.filter((item) => item.id !== indicator.id) })}>×</button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="chart-frame" data-tool={tool}>
        {bar ? (
          <div className="chart-legend" aria-live="off">
            <span className="dim">{new Date(bar.time * 1000).toISOString().slice(0, intraday ? 16 : 10).replace("T", " ")}</span>
            <span>O <b data-tone={tone(bar.close - bar.open)}>{priceText(bar.open)}</b></span>
            <span>H <b data-tone={tone(bar.close - bar.open)}>{priceText(bar.high)}</b></span>
            <span>L <b data-tone={tone(bar.close - bar.open)}>{priceText(bar.low)}</b></span>
            <span>C <b data-tone={tone(bar.close - bar.open)}>{priceText(bar.close)}</b></span>
            {change != null ? <b data-tone={tone(change)}>{change >= 0 ? "+" : ""}{changeText(change)} ({changePct! >= 0 ? "+" : ""}{(changePct! * 100).toFixed(2)}%)</b> : null}
            <span>Vol <b>{volumeText(bar.volume)}</b></span>
          </div>
        ) : null}
        {tool !== "cursor" ? (
          <div className="chart-hint">
            {tool === "hline" ? "Click a price to place a level." : pending ? "Click the second point." : tool === "fib" ? "Click where the move starts." : "Click the first point."} Esc cancels.
          </div>
        ) : null}
        <div className="chart-canvas" ref={container} />
        {loading || load.error ? (
          <div className="chart-state">{loading ? `Loading ${symbol}…` : load.error}</div>
        ) : null}
      </div>

      <div className="chart-ranges" role="group" aria-label="Range">
        {RANGES.map((item) => (
          <button type="button" key={item} aria-pressed={rangeKey === item} onClick={() => pickRange(item)}>{item}</button>
        ))}
        <span className="dim chart-source">
          {candles ? `Yahoo Finance · ${intraday ? `exchange time${candles.timezone ? ` (${candles.timezone})` : ""}` : "split-adjusted"}` : ""}
        </span>
      </div>
      <p className="stat-note chart-note">
        Research information only, not investment advice. Drawings and indicators are kept on this device. The chart is drawn with
        {" "}<a href="https://www.tradingview.com/lightweight-charts/" rel="noreferrer" target="_blank">TradingView Lightweight Charts</a>.
      </p>
    </main>
  );
}

