import type { Study } from "./technicals";

/**
 * The settings of each study a reader can change — periods, multipliers,
 * steps — with the defaults the platforms use and the bounds that keep a
 * value meaningful. A chart keeps only what differs from the default, so a
 * stored workspace stays small and a new default reaches everyone who never
 * changed it. Pure.
 */

export interface ParamSpec { label: string; value: number; min: number; max: number; step: number }
export type StudyParams = Partial<Record<Study, number[]>>;

const period = (label: string, value: number, max = 500): ParamSpec => ({ label, value, min: 1, max, step: 1 });
const factor = (label: string, value: number, step = 0.1, max = 10): ParamSpec => ({ label, value, min: step, max, step });

export const STUDY_PARAMS: Partial<Record<Study, ParamSpec[]>> = {
  ema: [period("Fast", 20), period("Medium", 50), period("Slow", 200)],
  sma: [period("Fast", 50), period("Slow", 200)],
  bollinger: [period("Period", 20), factor("Width", 2)],
  ichimoku: [period("Conversion", 9), period("Base", 26), period("Leading", 52)],
  keltner: [period("Period", 20), factor("ATR ×", 2), period("ATR", 10)],
  donchian: [period("Period", 20)],
  supertrend: [period("ATR", 10), factor("Multiplier", 3)],
  psar: [factor("Step", 0.02, 0.01, 1), factor("Maximum", 0.2, 0.01, 1)],
  hma: [period("Period", 21)],
  vprofile: [{ label: "Rows", value: 24, min: 6, max: 80, step: 1 }],
  rsi: [period("Period", 14)],
  macd: [period("Fast", 12), period("Slow", 26), period("Signal", 9)],
  stoch: [period("%K", 14), period("Smooth", 3), period("%D", 3)],
  atr: [period("Period", 14)],
  adx: [period("Period", 14)],
  squeeze: [period("Period", 20)],
  stochrsi: [period("Period", 14), period("Smooth", 3), period("%D", 3)],
  willr: [period("Period", 14)],
  cci: [period("Period", 20)],
  roc: [period("Period", 12)],
  aroon: [period("Period", 25)],
  cmf: [period("Period", 20)],
  mfi: [period("Period", 14)],
};

/** A study's settings: the reader's where they are valid, the defaults elsewhere. */
export function paramsOf(params: StudyParams | undefined, study: Study): number[] {
  const specs = STUDY_PARAMS[study] ?? [];
  const stored = params?.[study];
  return specs.map((spec, index) => {
    const value = stored?.[index];
    if (typeof value !== "number" || !Number.isFinite(value)) return spec.value;
    const stepped = spec.step >= 1 ? Math.round(value) : Math.round(value / spec.step) * spec.step;
    return Number(Math.min(spec.max, Math.max(spec.min, stepped)).toFixed(4));
  });
}

/** True when every setting is the default. */
export const isDefault = (params: StudyParams | undefined, study: Study) =>
  paramsOf(params, study).every((value, index) => value === STUDY_PARAMS[study]![index].value);

/** Settings checked on the way in from storage: unknown studies and defaults dropped. */
export function cleanParams(value: unknown): StudyParams {
  if (typeof value !== "object" || value == null) return {};
  const out: StudyParams = {};
  for (const [study, list] of Object.entries(value as Record<string, unknown>)) {
    if (!(study in STUDY_PARAMS) || !Array.isArray(list)) continue;
    const kept = paramsOf({ [study]: list } as StudyParams, study as Study);
    if (!isDefault({ [study]: kept } as StudyParams, study as Study)) out[study as Study] = kept;
  }
  return out;
}

/** Settings with one study's replaced; back to the defaults, it is forgotten. */
export function withParams(params: StudyParams | undefined, study: Study, values: number[] | null): StudyParams {
  const next = { ...(params ?? {}) };
  if (values == null) { delete next[study]; return next; }
  const kept = paramsOf({ [study]: values } as StudyParams, study);
  if (isDefault({ [study]: kept } as StudyParams, study)) delete next[study]; else next[study] = kept;
  return next;
}

const NAMES: Partial<Record<Study, (values: number[]) => string>> = {
  ema: (v) => `EMA ${v.join(" · ")}`,
  sma: (v) => `SMA ${v.join(" · ")}`,
  bollinger: ([p, w]) => `Bollinger ${p} · ${w}`,
  ichimoku: (v) => `Ichimoku ${v.join(" · ")}`,
  keltner: ([p, m]) => `Keltner channel ${p} · ${m} ATR`,
  donchian: ([p]) => `Donchian channel ${p}`,
  supertrend: (v) => `Supertrend ${v.join(" · ")}`,
  psar: (v) => `Parabolic SAR ${v.join(" · ")}`,
  hma: ([p]) => `Hull MA ${p}`,
  rsi: ([p]) => `RSI ${p}`,
  macd: (v) => `MACD ${v.join(" · ")}`,
  stoch: (v) => `Stochastic ${v.join(" · ")}`,
  atr: ([p]) => `ATR ${p}`,
  adx: ([p]) => `ADX / DMI ${p}`,
  squeeze: ([p]) => `TTM squeeze ${p}`,
  stochrsi: (v) => `Stochastic RSI ${v.join(" · ")}`,
  willr: ([p]) => `Williams %R ${p}`,
  cci: ([p]) => `CCI ${p}`,
  roc: ([p]) => `Rate of change ${p}`,
  aroon: ([p]) => `Aroon ${p}`,
  cmf: ([p]) => `Chaikin money flow ${p}`,
  mfi: ([p]) => `Money flow index ${p}`,
};

/** A study's name with its settings, as the side panel and the panes write it; `fallback` for the studies without any. */
export function studyName(study: Study, params: StudyParams | undefined, fallback: string): string {
  const name = NAMES[study];
  return name ? name(paramsOf(params, study)) : fallback;
}
