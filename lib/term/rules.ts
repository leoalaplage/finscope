import { bollinger, ema, macd, patternsAt, rsi, sma, stochastic, type Bars, type Line, type Pattern } from "@/lib/io/indicators";
import { averageTrueRange } from "@/lib/io/technicals";
import {
  adx, aroon, chaikinMoneyFlow, cci, donchian, hullMa, keltner, moneyFlowIndex, parabolicSar, roc, squeeze, stochRsi, supertrend, williamsR,
} from "@/lib/io/indicators-extra";

/**
 * The terminal's rules: what the scanner looks for and what a backtest trades.
 *
 * One vocabulary for both. A condition compares a field — a price, an
 * average, an oscillator, a candle pattern — with another field or a number,
 * at one bar; a rule is conditions that all hold. The scanner asks it of the
 * last bar of every company, the backtest of every bar of one, so a rule that
 * found a company this morning can be tested on its last twenty-five years
 * without being written twice.
 *
 * Everything here is pure: bars in, numbers out.
 */

export const PATTERN_FIELDS: Pattern[] = ["bullEngulfing", "bearEngulfing", "hammer", "shootingStar", "doji", "morningStar", "eveningStar"];

export type Field =
  | "close" | "open" | "high" | "low"
  | "ema20" | "ema50" | "ema200" | "sma50" | "sma200"
  | "bbUpper" | "bbMiddle" | "bbLower"
  | "rsi14" | "macd" | "macdSignal" | "macdHist" | "stochK" | "stochD"
  | "atr14" | "atrPct"
  | "volume" | "volume20" | "volumeRatio"
  | "chg1" | "chg5" | "chg20" | "chg60" | "chg126" | "chg252" | "chgYtd" | "rsRating"
  | "high52" | "low52" | "fromHigh52" | "fromLow52" | "fromEma200" | "fromSma50"
  | "adx14" | "plusDi" | "minusDi" | "aroonUp" | "aroonDown" | "hma21" | "supertrend" | "psar"
  | "kcUpper" | "kcLower" | "dcUpper" | "dcLower"
  | "cci20" | "willr14" | "roc12" | "stochRsiK" | "stochRsiD" | "mfi14" | "cmf20" | "squeezeMomentum"
  | Pattern | SignalField;

/** Yes-or-no readings, asked with "appears" like a candle pattern. */
export type SignalField = "supertrendUp" | "supertrendFlipUp" | "supertrendFlipDown" | "squeezeOn" | "squeezeFired";
export const SIGNAL_FIELDS: SignalField[] = ["supertrendUp", "supertrendFlipUp", "supertrendFlipDown", "squeezeOn", "squeezeFired"];

export type Unit = "price" | "percent" | "index" | "volume" | "ratio" | "pattern";

export interface FieldSpec { key: Field; name: string; group: string; unit: Unit }

export const FIELDS: FieldSpec[] = [
  { key: "close", name: "Close", group: "Price", unit: "price" },
  { key: "open", name: "Open", group: "Price", unit: "price" },
  { key: "high", name: "High", group: "Price", unit: "price" },
  { key: "low", name: "Low", group: "Price", unit: "price" },
  { key: "ema20", name: "EMA 20", group: "Averages", unit: "price" },
  { key: "ema50", name: "EMA 50", group: "Averages", unit: "price" },
  { key: "ema200", name: "EMA 200", group: "Averages", unit: "price" },
  { key: "sma50", name: "SMA 50", group: "Averages", unit: "price" },
  { key: "sma200", name: "SMA 200", group: "Averages", unit: "price" },
  { key: "bbUpper", name: "Bollinger upper", group: "Averages", unit: "price" },
  { key: "bbMiddle", name: "Bollinger middle", group: "Averages", unit: "price" },
  { key: "bbLower", name: "Bollinger lower", group: "Averages", unit: "price" },
  { key: "rsi14", name: "RSI 14", group: "Momentum", unit: "index" },
  { key: "macd", name: "MACD", group: "Momentum", unit: "price" },
  { key: "macdSignal", name: "MACD signal", group: "Momentum", unit: "price" },
  { key: "macdHist", name: "MACD histogram", group: "Momentum", unit: "price" },
  { key: "stochK", name: "Stochastic %K", group: "Momentum", unit: "index" },
  { key: "stochD", name: "Stochastic %D", group: "Momentum", unit: "index" },
  { key: "atr14", name: "ATR 14", group: "Volatility", unit: "price" },
  { key: "atrPct", name: "ATR % of price", group: "Volatility", unit: "percent" },
  { key: "volume", name: "Volume", group: "Volume", unit: "volume" },
  { key: "volume20", name: "Volume, 20-bar average", group: "Volume", unit: "volume" },
  { key: "volumeRatio", name: "Volume ÷ 20-bar average", group: "Volume", unit: "ratio" },
  { key: "chg1", name: "Change, 1 bar %", group: "Returns", unit: "percent" },
  { key: "chg5", name: "Change, 5 bars %", group: "Returns", unit: "percent" },
  { key: "chg20", name: "Change, 20 bars %", group: "Returns", unit: "percent" },
  { key: "chg60", name: "Change, 60 bars %", group: "Returns", unit: "percent" },
  { key: "chg126", name: "Change, 126 bars (6 months on days) %", group: "Returns", unit: "percent" },
  { key: "chg252", name: "Change, 252 bars (1 year on days) %", group: "Returns", unit: "percent" },
  { key: "chgYtd", name: "Change, year to date %", group: "Returns", unit: "percent" },
  { key: "rsRating", name: "RS rating 1–99 (S&P 500 scan only)", group: "Returns", unit: "index" },
  { key: "high52", name: "52-week high", group: "Range", unit: "price" },
  { key: "low52", name: "52-week low", group: "Range", unit: "price" },
  { key: "fromHigh52", name: "From 52-week high %", group: "Range", unit: "percent" },
  { key: "fromLow52", name: "From 52-week low %", group: "Range", unit: "percent" },
  { key: "fromEma200", name: "From EMA 200 %", group: "Range", unit: "percent" },
  { key: "fromSma50", name: "From SMA 50 %", group: "Range", unit: "percent" },
  { key: "adx14", name: "ADX 14", group: "Trend", unit: "index" },
  { key: "plusDi", name: "+DI 14", group: "Trend", unit: "index" },
  { key: "minusDi", name: "−DI 14", group: "Trend", unit: "index" },
  { key: "aroonUp", name: "Aroon up 25", group: "Trend", unit: "index" },
  { key: "aroonDown", name: "Aroon down 25", group: "Trend", unit: "index" },
  { key: "hma21", name: "Hull MA 21", group: "Averages", unit: "price" },
  { key: "supertrend", name: "Supertrend 10 · 3", group: "Trend", unit: "price" },
  { key: "psar", name: "Parabolic SAR", group: "Trend", unit: "price" },
  { key: "kcUpper", name: "Keltner upper", group: "Channels", unit: "price" },
  { key: "kcLower", name: "Keltner lower", group: "Channels", unit: "price" },
  { key: "dcUpper", name: "Donchian high 20", group: "Channels", unit: "price" },
  { key: "dcLower", name: "Donchian low 20", group: "Channels", unit: "price" },
  { key: "cci20", name: "CCI 20", group: "Momentum", unit: "index" },
  { key: "willr14", name: "Williams %R 14", group: "Momentum", unit: "index" },
  { key: "roc12", name: "Rate of change 12 %", group: "Momentum", unit: "percent" },
  { key: "stochRsiK", name: "Stochastic RSI %K", group: "Momentum", unit: "index" },
  { key: "stochRsiD", name: "Stochastic RSI %D", group: "Momentum", unit: "index" },
  { key: "mfi14", name: "Money flow index 14", group: "Volume", unit: "index" },
  { key: "cmf20", name: "Chaikin money flow 20", group: "Volume", unit: "ratio" },
  { key: "squeezeMomentum", name: "Squeeze momentum", group: "Channels", unit: "price" },
  { key: "supertrendUp", name: "Supertrend is up", group: "Signals", unit: "pattern" },
  { key: "supertrendFlipUp", name: "Supertrend turns up", group: "Signals", unit: "pattern" },
  { key: "supertrendFlipDown", name: "Supertrend turns down", group: "Signals", unit: "pattern" },
  { key: "squeezeOn", name: "Squeeze is on", group: "Signals", unit: "pattern" },
  { key: "squeezeFired", name: "Squeeze fires", group: "Signals", unit: "pattern" },
  { key: "bullEngulfing", name: "Bullish engulfing", group: "Patterns", unit: "pattern" },
  { key: "bearEngulfing", name: "Bearish engulfing", group: "Patterns", unit: "pattern" },
  { key: "hammer", name: "Hammer", group: "Patterns", unit: "pattern" },
  { key: "shootingStar", name: "Shooting star", group: "Patterns", unit: "pattern" },
  { key: "doji", name: "Doji", group: "Patterns", unit: "pattern" },
  { key: "morningStar", name: "Morning star", group: "Patterns", unit: "pattern" },
  { key: "eveningStar", name: "Evening star", group: "Patterns", unit: "pattern" },
];

export const FIELD_OF: Record<Field, FieldSpec> = Object.fromEntries(FIELDS.map((spec) => [spec.key, spec])) as Record<Field, FieldSpec>;
const FIELD_KEYS = new Set<string>(FIELDS.map((spec) => spec.key));

/** A year of sessions, for the 52-week range on daily bars. */
const YEAR = 252;

const change = (values: number[], back: number): Line =>
  values.map((value, index) => (index >= back && values[index - back] ? (value / values[index - back] - 1) * 100 : null));

const rolling = (values: number[], period: number, pick: (a: number, b: number) => number): Line =>
  values.map((_, index) => {
    if (index < period - 1) return null;
    let found = values[index];
    for (let back = index - period + 1; back < index; back++) found = pick(found, values[back]);
    return found;
  });

/** The move since the last close of the previous calendar year, on every bar. */
function sinceYearStart(bars: Bars): Line {
  let base: number | null = null;
  let year = -1;
  return bars.c.map((close, index) => {
    const at = new Date(bars.t[index] * 1000).getUTCFullYear();
    if (at !== year) {
      base = index > 0 ? bars.c[index - 1] : null;
      year = at;
    }
    return base ? (close / base - 1) * 100 : null;
  });
}

const ratio = (a: Line, b: Line, minus = 1): Line => a.map((value, index) => (value == null || !b[index] ? null : (value / b[index]! - minus) * (minus ? 100 : 1)));

/** Every field over every bar, aligned with the bars by index. */
export function computeSeries(bars: Bars): Record<Field, Line> {
  const { c } = bars;
  const bands = bollinger(c);
  const momentum = macd(c);
  const stoch = stochastic(bars);
  const atr = averageTrueRange(bars) as Line;
  const volume: Line = bars.v ? bars.v.map((value) => value) : c.map(() => null);
  const volume20 = bars.v ? sma(bars.v, 20) : c.map(() => null);
  const high52 = rolling(bars.h, Math.min(YEAR, bars.h.length), Math.max);
  const low52 = rolling(bars.l, Math.min(YEAR, bars.l.length), Math.min);
  const ema200 = ema(c, 200);
  const sma50 = sma(c, 50);
  const trend = sma(c, 10);
  const patterns = c.map((_, index) => new Set(patternsAt(bars, index, trend)));

  const series = {
    close: [...c], open: [...bars.o], high: [...bars.h], low: [...bars.l],
    ema20: ema(c, 20), ema50: ema(c, 50), ema200, sma50, sma200: sma(c, 200),
    bbUpper: bands.upper, bbMiddle: bands.middle, bbLower: bands.lower,
    rsi14: rsi(c), macd: momentum.macd, macdSignal: momentum.signal, macdHist: momentum.histogram,
    stochK: stoch.k, stochD: stoch.d,
    atr14: atr, atrPct: atr.map((value, index) => (value == null ? null : (value / c[index]) * 100)),
    volume, volume20, volumeRatio: ratio(volume, volume20, 0),
    chg1: change(c, 1), chg5: change(c, 5), chg20: change(c, 20), chg60: change(c, 60), chg126: change(c, 126), chg252: change(c, YEAR),
    // A rank against the rest of the index, so it exists only where the index is scanned (app/api/scan).
    rsRating: c.map(() => null),
    chgYtd: sinceYearStart(bars),
    high52, low52,
    fromHigh52: ratio(c, high52), fromLow52: ratio(c, low52), fromEma200: ratio(c, ema200), fromSma50: ratio(c, sma50),
  } as Record<Field, Line>;
  for (const pattern of PATTERN_FIELDS) series[pattern] = patterns.map((found) => (found.has(pattern) ? 1 : 0));

  // The rest of the toolkit (lib/io/indicators-extra.ts).
  const dmi = adx(bars), arn = aroon(bars), trail = supertrend(bars), sar = parabolicSar(bars);
  const kc = keltner(bars), dc = donchian(bars), sq = squeeze(bars), srsi = stochRsi(c);
  Object.assign(series, {
    adx14: dmi.adx, plusDi: dmi.plus, minusDi: dmi.minus, aroonUp: arn.up, aroonDown: arn.down,
    hma21: hullMa(c), supertrend: trail.line, psar: sar.line,
    kcUpper: kc.upper, kcLower: kc.lower, dcUpper: dc.upper, dcLower: dc.lower,
    cci20: cci(bars), willr14: williamsR(bars), roc12: roc(c), stochRsiK: srsi.k, stochRsiD: srsi.d,
    mfi14: moneyFlowIndex(bars), cmf20: chaikinMoneyFlow(bars), squeezeMomentum: sq.momentum,
    supertrendUp: trail.up.map((up) => (up == null ? null : up ? 1 : 0)),
    supertrendFlipUp: trail.up.map((up, index) => (up == null || trail.up[index - 1] == null ? null : up && !trail.up[index - 1] ? 1 : 0)),
    supertrendFlipDown: trail.up.map((up, index) => (up == null || trail.up[index - 1] == null ? null : !up && trail.up[index - 1] ? 1 : 0)),
    squeezeOn: sq.on.map((on) => (on == null ? null : on ? 1 : 0)),
    squeezeFired: sq.on.map((on, index) => (on == null || sq.on[index - 1] == null ? null : !on && sq.on[index - 1] ? 1 : 0)),
  });
  return series;
}

export type Operator = ">" | "<" | "crossesAbove" | "crossesBelow" | "is";

export const OPERATORS: { key: Operator; name: string }[] = [
  { key: ">", name: "is above" },
  { key: "<", name: "is below" },
  { key: "crossesAbove", name: "crosses above" },
  { key: "crossesBelow", name: "crosses below" },
  { key: "is", name: "appears" },
];

/** A field compared with another field or with a number; a pattern only appears. */
export interface Condition { left: Field; op: Operator; right?: Field | number }

/** A field's value `back` bars before the bar being asked about. */
export type Reader = (field: Field, back: number) => number | null;

export function holds(condition: Condition, read: Reader): boolean {
  if (condition.op === "is") return read(condition.left, 0) === 1;
  const side = (back: number) => (typeof condition.right === "number" ? condition.right : condition.right ? read(condition.right, back) : null);
  const left = read(condition.left, 0);
  const right = side(0);
  if (left == null || right == null) return false;
  if (condition.op === ">") return left > right;
  if (condition.op === "<") return left < right;
  const leftBefore = read(condition.left, 1);
  const rightBefore = side(1);
  if (leftBefore == null || rightBefore == null) return false;
  return condition.op === "crossesAbove" ? left > right && leftBefore <= rightBefore : left < right && leftBefore >= rightBefore;
}

/** Every condition at once; an empty rule holds nowhere rather than everywhere. */
export const allHold = (conditions: Condition[], read: Reader) => conditions.length > 0 && conditions.every((condition) => holds(condition, read));

export const fieldsOf = (conditions: Condition[]): Field[] =>
  [...new Set(conditions.flatMap((condition) => [condition.left, ...(typeof condition.right === "string" ? [condition.right] : [])]))];

/** Conditions read back from storage or a link, with anything unknown dropped. */
export function cleanConditions(value: unknown): Condition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Condition[] => {
    const raw = item as Partial<Condition>;
    if (!raw || !FIELD_KEYS.has(raw.left as string) || !OPERATORS.some((op) => op.key === raw.op)) return [];
    const left = raw.left as Field;
    if (raw.op === "is") return FIELD_OF[left].unit === "pattern" ? [{ left, op: "is" }] : [];
    if (typeof raw.right === "number" && Number.isFinite(raw.right)) return [{ left, op: raw.op!, right: raw.right }];
    if (FIELD_KEYS.has(raw.right as string)) return [{ left, op: raw.op!, right: raw.right as Field }];
    return [];
  });
}

/* --- The scanner's view: the last two bars of every field ---------------- */

export type Snapshot = Partial<Record<Field, [number | null, number | null]>>;

/** Four significant figures: enough to compare, a third of the bytes. */
const trim = (value: number | null) => (value == null || !Number.isFinite(value) ? null : Number(value.toPrecision(5)));

export function snapshotOf(series: Record<Field, Line>, index?: number): Snapshot {
  const at = index ?? series.close.length - 1;
  const out: Snapshot = {};
  for (const spec of FIELDS) out[spec.key] = [trim(series[spec.key][at] ?? null), trim(series[spec.key][at - 1] ?? null)];
  return out;
}

export const readSnapshot = (snapshot: Snapshot): Reader => (field, back) => snapshot[field]?.[back] ?? null;
export const readSeries = (series: Record<Field, Line>, index: number): Reader => (field, back) => series[field][index - back] ?? null;

/* --- Presets ------------------------------------------------------------- */

export interface Preset { name: string; conditions: Condition[] }

export const SCAN_PRESETS: Preset[] = [
  { name: "Oversold: RSI below 30", conditions: [{ left: "rsi14", op: "<", right: 30 }] },
  { name: "Golden cross: SMA 50 crosses above SMA 200", conditions: [{ left: "sma50", op: "crossesAbove", right: "sma200" }] },
  { name: "Uptrend pullback: above EMA 200, RSI below 40", conditions: [{ left: "close", op: ">", right: "ema200" }, { left: "rsi14", op: "<", right: 40 }] },
  { name: "Near the 52-week high (within 2%)", conditions: [{ left: "fromHigh52", op: ">", right: -2 }] },
  { name: "MACD crosses above its signal", conditions: [{ left: "macd", op: "crossesAbove", right: "macdSignal" }] },
  { name: "Volume surge: twice the 20-bar average, up day", conditions: [{ left: "volumeRatio", op: ">", right: 2 }, { left: "chg1", op: ">", right: 0 }] },
  { name: "Below the lower Bollinger band", conditions: [{ left: "close", op: "<", right: "bbLower" }] },
  { name: "Bullish engulfing above EMA 50", conditions: [{ left: "bullEngulfing", op: "is" }, { left: "close", op: ">", right: "ema50" }] },
  { name: "Leaders: RS rating 80+, above EMA 50", conditions: [{ left: "rsRating", op: ">", right: 79 }, { left: "close", op: ">", right: "ema50" }] },
];

export interface StrategyPreset { name: string; entry: Condition[]; exit: Condition[] }

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    name: "Golden cross: SMA 50 over SMA 200, out on the death cross",
    entry: [{ left: "sma50", op: "crossesAbove", right: "sma200" }],
    exit: [{ left: "sma50", op: "crossesBelow", right: "sma200" }],
  },
  {
    name: "RSI mean reversion: in below 30, out above 55",
    entry: [{ left: "rsi14", op: "<", right: 30 }],
    exit: [{ left: "rsi14", op: ">", right: 55 }],
  },
  {
    name: "Trend: EMA 20 crosses EMA 50, out below EMA 50",
    entry: [{ left: "ema20", op: "crossesAbove", right: "ema50" }],
    exit: [{ left: "close", op: "crossesBelow", right: "ema50" }],
  },
  {
    name: "MACD: line over signal above EMA 200, out on the cross down",
    entry: [{ left: "macd", op: "crossesAbove", right: "macdSignal" }, { left: "close", op: ">", right: "ema200" }],
    exit: [{ left: "macd", op: "crossesBelow", right: "macdSignal" }],
  },
  {
    name: "Bollinger bounce: in below the lower band, out at the middle",
    entry: [{ left: "close", op: "<", right: "bbLower" }],
    exit: [{ left: "close", op: ">", right: "bbMiddle" }],
  },
];

/* --- Backtest ------------------------------------------------------------ */

export interface BacktestOptions {
  /** Exit when the price falls this fraction below entry, e.g. 0.08. */
  stopLoss?: number | null;
  /** Exit when the price rises this fraction above entry. */
  takeProfit?: number | null;
  /** Cost of each side, in basis points of what is traded. */
  costBps?: number;
}

export interface Trade {
  entryIndex: number; entryTime: number; entryPrice: number;
  exitIndex: number; exitTime: number; exitPrice: number;
  /** After costs. */
  return: number;
  bars: number;
  reason: "rule" | "stop" | "target" | "open";
}

export interface BacktestResult {
  start: number;
  trades: Trade[];
  /** The strategy's value on every bar from `start`, starting at 1. */
  equity: number[];
  /** Holding the stock over the same bars, starting at 1. */
  benchmark: number[];
  totalReturn: number;
  cagr: number | null;
  maxDrawdown: number;
  benchmarkReturn: number;
  benchmarkCagr: number | null;
  benchmarkDrawdown: number;
  winRate: number | null;
  averageTrade: number | null;
  profitFactor: number | null;
  exposure: number;
  bestTrade: number | null;
  worstTrade: number | null;
}

function drawdown(curve: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const value of curve) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

const YEAR_SECONDS = 365.25 * 86_400;
const annualised = (growth: number, seconds: number) => (seconds > YEAR_SECONDS / 4 && growth > 0 ? growth ** (YEAR_SECONDS / seconds) - 1 : null);

/**
 * Long only, all in, one position at a time.
 *
 * A rule is read on a bar's close and acted on at the next bar's open, so no
 * trade uses a price it could not have known. A stop or target is checked on
 * every bar after entry against its low and high, filled at the level — or at
 * the open, when the bar gaps through it — and a bar that touches both is
 * counted as the stop, the cautious reading. A position still open on the last
 * bar is valued at its close and marked open. Costs come off each side.
 */
export function backtest(bars: Bars, series: Record<Field, Line>, entry: Condition[], exit: Condition[], options: BacktestOptions = {}): BacktestResult | null {
  const used = fieldsOf([...entry, ...exit]);
  const count = bars.c.length;
  // The first bar on which every field used, and the bar before it, exist.
  let start = used.length ? -1 : 1;
  for (let index = 1; index < count && start < 0; index++) {
    if (used.every((field) => series[field][index] != null && series[field][index - 1] != null)) start = index;
  }
  if (start < 0 || start >= count - 1) return null;

  const cost = (options.costBps ?? 0) / 10_000;
  const trades: Trade[] = [];
  const equity: number[] = [];
  let cash = 1;
  let held: { index: number; price: number; units: number } | null = null;
  let pending: "buy" | "sell" | null = null;
  let barsHeld = 0;

  const close = (index: number, price: number, reason: Trade["reason"]) => {
    if (!held) return;
    const proceeds = held.units * price * (1 - cost);
    trades.push({
      entryIndex: held.index, entryTime: bars.t[held.index], entryPrice: held.price,
      exitIndex: index, exitTime: bars.t[index], exitPrice: price,
      return: proceeds / (held.units * held.price / (1 - cost)) - 1, bars: index - held.index, reason,
    });
    cash = proceeds;
    held = null;
  };

  for (let index = start; index < count; index++) {
    const open = bars.o[index];
    if (pending === "buy" && !held) {
      held = { index, price: open, units: (cash * (1 - cost)) / open };
      cash = 0;
    } else if (pending === "sell" && held) {
      close(index, open, "rule");
    }
    pending = null;

    if (held) {
      const position = held as { index: number; price: number; units: number };
      const stop = options.stopLoss ? position.price * (1 - options.stopLoss) : null;
      const target = options.takeProfit ? position.price * (1 + options.takeProfit) : null;
      if (stop != null && bars.l[index] <= stop) close(index, Math.min(open, stop), "stop");
      else if (target != null && bars.h[index] >= target) close(index, Math.max(open, target), "target");
    }

    const value = held ? (held as { units: number }).units * bars.c[index] : cash;
    equity.push(value);
    if (held) barsHeld++;

    if (index === count - 1) break;
    const read = readSeries(series, index);
    if (!held && allHold(entry, read)) pending = "buy";
    else if (held && allHold(exit, read)) pending = "sell";
  }
  if (held) close(count - 1, bars.c[count - 1], "open");

  const benchmark = bars.c.slice(start).map((value) => value / bars.o[start]);
  const seconds = bars.t[count - 1] - bars.t[start];
  // Hit rate and profit factor count closed trades; a position still open has not won or lost yet.
  const finished = trades.filter((trade) => trade.reason !== "open");
  const wins = finished.filter((trade) => trade.return > 0);
  const gains = wins.reduce((sum, trade) => sum + trade.return, 0);
  const losses = finished.filter((trade) => trade.return <= 0).reduce((sum, trade) => sum - trade.return, 0);
  const totalReturn = equity[equity.length - 1] - 1;
  const benchmarkReturn = benchmark[benchmark.length - 1] - 1;
  return {
    start, trades, equity, benchmark,
    totalReturn, cagr: annualised(1 + totalReturn, seconds), maxDrawdown: drawdown(equity),
    benchmarkReturn, benchmarkCagr: annualised(1 + benchmarkReturn, seconds), benchmarkDrawdown: drawdown(benchmark),
    winRate: finished.length ? wins.length / finished.length : null,
    averageTrade: trades.length ? trades.reduce((sum, trade) => sum + trade.return, 0) / trades.length : null,
    profitFactor: losses > 0 ? gains / losses : null,
    exposure: equity.length ? barsHeld / equity.length : 0,
    bestTrade: trades.length ? Math.max(...trades.map((trade) => trade.return)) : null,
    worstTrade: trades.length ? Math.min(...trades.map((trade) => trade.return)) : null,
  };
}

/**
 * The RS rating: where a member's weighted return over three, six and twelve
 * months ranks in the index, from 1 to 99 — 99 has beaten 99% of it. The last
 * quarter weighs most, as in the ratings traders know; a member short of a
 * year of history is left unrated. Done for the last bar and the one before,
 * so a rule can ask for a rating that has just crossed a line.
 */
export function rsRatings(rows: Array<{ values: Snapshot }>): Array<[number | null, number | null]> {
  const score = (values: Snapshot, back: 0 | 1) => {
    const quarter = values.chg60?.[back];
    const half = values.chg126?.[back];
    const year = values.chg252?.[back];
    return quarter == null || half == null || year == null ? null : 0.4 * quarter + 0.3 * half + 0.3 * year;
  };
  const rank = (back: 0 | 1) => {
    const scores = rows.map((row) => score(row.values, back));
    const known = scores.filter((value): value is number => value != null).sort((a, b) => a - b);
    return scores.map((value) => {
      if (value == null || !known.length) return null;
      let below = 0;
      while (below < known.length && known[below] < value) below++;
      return Math.max(1, Math.min(99, Math.round((below / known.length) * 100)));
    });
  };
  const now = rank(0);
  const before = rank(1);
  return rows.map((_, index) => [now[index], before[index]]);
}
