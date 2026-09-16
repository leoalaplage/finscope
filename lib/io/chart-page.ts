import type { CandleInterval } from "../adapters/candles";

/**
 * What the chart page remembers and how its controls relate, kept apart from
 * the drawing so each rule can be tested.
 */

export const INTERVAL_LABELS: Record<CandleInterval, string> = { "5m": "5m", "15m": "15m", "1h": "1H", "1d": "1D", "1wk": "1W", "1mo": "1M" };

/** Days of history each interval can be asked for; see lib/adapters/candles.ts. */
const INTERVAL_DAYS: Record<CandleInterval, number> = { "5m": 60, "15m": 60, "1h": 730, "1d": Infinity, "1wk": Infinity, "1mo": Infinity };

export const RANGES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "All"] as const;
export type ChartRange = (typeof RANGES)[number];

const RANGE_DAYS: Record<Exclude<ChartRange, "YTD" | "All">, number> = { "1D": 1, "5D": 5, "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "5Y": 1827 };

/**
 * The interval a range is drawn at when the one in hand cannot draw it.
 *
 * A day of monthly candles is one candle and five years of five-minute ones
 * do not exist, so pressing such a range moves the interval to one that has
 * it — and leaves a workable pair alone, since the reader chose both.
 */
export function intervalForRange(range: ChartRange, current: CandleInterval, now = new Date()): CandleInterval {
  if (range === "1D") return current === "5m" || current === "15m" ? current : "5m";
  if (range === "5D") return current === "5m" || current === "15m" || current === "1h" ? current : "15m";
  const days = range === "All" ? Infinity : range === "YTD" ? dayOfYear(now) : RANGE_DAYS[range];
  if (days > INTERVAL_DAYS[current]) return "1d";
  // Fewer than about twenty candles is not a chart.
  if (current === "1mo" && days < 700) return "1d";
  if (current === "1wk" && days < 140) return "1d";
  return current;
}

function dayOfYear(now: Date) {
  return Math.ceil((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86_400_000) || 1;
}

/**
 * The first bar time a range shows, given the last one.
 *
 * Times are the exchange's wall clock expressed as UTC seconds, so a day is a
 * calendar day at the exchange. "1D" is the last session, however long ago it
 * was, and "5D" the last five sessions.
 */
export function rangeStart(range: ChartRange, times: number[]): number | null {
  if (!times.length) return null;
  const last = times[times.length - 1];
  if (range === "All") return times[0];
  if (range === "1D" || range === "5D") {
    const sessions = range === "1D" ? 1 : 5;
    let seen = 0;
    let day = Math.floor(last / 86_400);
    for (let index = times.length - 1; index >= 0; index--) {
      const current = Math.floor(times[index] / 86_400);
      if (current !== day) { seen++; day = current; }
      if (seen === sessions) return times[index + 1];
    }
    return times[0];
  }
  const end = new Date(last * 1000);
  if (range === "YTD") return Date.UTC(end.getUTCFullYear(), 0, 1) / 1000;
  return last - RANGE_DAYS[range] * 86_400;
}

/* ---- Indicators ------------------------------------------------------ */

export type IndicatorKind = "sma" | "ema" | "bb" | "vwap" | "rsi" | "macd" | "stoch" | "atr" | "volume";

export interface Indicator {
  id: string;
  kind: IndicatorKind;
  /** The window, where the indicator has one. */
  period: number;
  color: string;
}

export const INDICATOR_NAMES: Record<IndicatorKind, string> = {
  sma: "SMA", ema: "EMA", bb: "Bollinger Bands", vwap: "VWAP", rsi: "RSI", macd: "MACD", stoch: "Stochastic", atr: "ATR", volume: "Volume",
};

/** Drawn over the price, sharing its scale, rather than in a pane of their own. */
export const OVERLAYS: ReadonlySet<IndicatorKind> = new Set(["sma", "ema", "bb", "vwap", "volume"]);

export const DEFAULT_PERIODS: Record<IndicatorKind, number> = { sma: 50, ema: 21, bb: 20, vwap: 0, rsi: 14, macd: 12, stoch: 14, atr: 14, volume: 0 };

/** Whether a reader can change the window. MACD is fixed at 12, 26, 9. */
export const HAS_PERIOD: ReadonlySet<IndicatorKind> = new Set(["sma", "ema", "bb", "rsi", "stoch", "atr"]);

export const LINE_COLORS = ["#f5a524", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#ef4444", "#84cc16", "#06b6d4"];

export const DEFAULT_INDICATORS: Indicator[] = [
  { id: "volume", kind: "volume", period: 0, color: "" },
  { id: "sma-50", kind: "sma", period: 50, color: LINE_COLORS[0] },
  { id: "sma-200", kind: "sma", period: 200, color: LINE_COLORS[1] },
];

/** A new indicator of a kind, with a colour the others are not using. */
export function addIndicator(list: Indicator[], kind: IndicatorKind): Indicator[] {
  if ((kind === "volume" || kind === "vwap") && list.some((item) => item.kind === kind)) return list;
  const used = new Set(list.map((item) => item.color));
  const color = LINE_COLORS.find((candidate) => !used.has(candidate)) ?? LINE_COLORS[list.length % LINE_COLORS.length];
  let id = kind as string;
  for (let n = 2; list.some((item) => item.id === id); n++) id = `${kind}-${n}`;
  return [...list, { id, kind, period: DEFAULT_PERIODS[kind], color: kind === "volume" ? "" : color }];
}

export const clampPeriod = (value: number) => Math.min(500, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));

/* ---- What is kept between visits -------------------------------------- */

export type ChartStyle = "candles" | "hollow" | "bars" | "heikin" | "line" | "area";

export const STYLE_NAMES: Record<ChartStyle, string> = {
  candles: "Candles", hollow: "Hollow candles", bars: "Bars", heikin: "Heikin Ashi", line: "Line", area: "Area",
};

export interface ChartSettings { style: ChartStyle; indicators: Indicator[]; log: boolean; interval: CandleInterval }

export const DEFAULT_SETTINGS: ChartSettings = { style: "candles", indicators: DEFAULT_INDICATORS, log: false, interval: "1d" };

const KINDS = new Set<string>(Object.keys(INDICATOR_NAMES));
const STYLES = new Set<string>(Object.keys(STYLE_NAMES));
const INTERVALS = new Set<string>(Object.keys(INTERVAL_LABELS));

/** Settings as stored, with anything unreadable replaced by the default rather than trusted. */
export function readSettings(text: string | null): ChartSettings {
  if (!text) return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(text) as Partial<ChartSettings>;
    const indicators = Array.isArray(raw.indicators)
      ? raw.indicators
        .filter((item): item is Indicator => !!item && typeof item.id === "string" && KINDS.has(item.kind))
        .map((item) => ({ id: item.id, kind: item.kind, period: HAS_PERIOD.has(item.kind) ? clampPeriod(item.period) : DEFAULT_PERIODS[item.kind], color: typeof item.color === "string" ? item.color : "" }))
      : DEFAULT_INDICATORS;
    return {
      style: STYLES.has(raw.style as string) ? raw.style! : DEFAULT_SETTINGS.style,
      indicators,
      log: raw.log === true,
      interval: INTERVALS.has(raw.interval as string) ? raw.interval! : DEFAULT_SETTINGS.interval,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/* ---- Drawings --------------------------------------------------------- */

export interface Anchor { time: number; price: number }

export type Drawing =
  | { id: string; type: "fib"; a: Anchor; b: Anchor }
  | { id: string; type: "trend"; a: Anchor; b: Anchor }
  | { id: string; type: "hline"; a: Anchor };

export type Tool = "cursor" | "fib" | "trend" | "hline";

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const anchor = (value: unknown): value is Anchor => !!value && finite((value as Anchor).time) && finite((value as Anchor).price);

export function readDrawings(text: string | null): Drawing[] {
  if (!text) return [];
  try {
    const raw = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is Drawing => {
      if (!item || typeof item.id !== "string" || !anchor(item.a)) return false;
      if (item.type === "hline") return true;
      return (item.type === "fib" || item.type === "trend") && anchor(item.b);
    }).slice(0, 200);
  } catch {
    return [];
  }
}
