"use client";

import { useEffect, useMemo, useState } from "react";
import type { IoCompanyView, IoMetric, IoPeriod } from "@/lib/io/view";
import {
  historicalValuationPoint,
  type HistoricalValuationMetric,
  type HistoricalValuationPoint,
  type ValuationPrice,
} from "@/lib/io/valuation-range";
import type { PricePoint } from "@/lib/types";
import type { IoQuote } from "./quote";

/**
 * The three valuation multiples as a history, read once for the whole page.
 *
 * They are not filed measures. A filer publishes free cash flow and a share
 * count; what it costs is a fact about the market, and pairing the two is this
 * application's own arithmetic. That is why they live here rather than in
 * `view.metrics` — and why, once struck, they have to behave exactly like a
 * filed measure everywhere else: the table below the chart states their ranges,
 * the chart at the top draws them, and both must be looking at one series read
 * once. Two readers of the same figures making two requests for the same prices
 * is how two answers to one question get onto one page.
 */

/** The three, shaped as the chart's own measures so nothing has to special-case them. */
export const VALUATION_METRICS: Array<IoMetric & { key: HistoricalValuationMetric; percent: boolean }> = [
  { key: "enterpriseToFreeCashFlow", label: "EV / free cash flow", short: "EV / FCF", unit: "ratio", formula: "Enterprise value ÷ trailing free cash flow, at each filing date", percent: false },
  { key: "priceToFreeCashFlow", label: "Price / free cash flow", short: "P / FCF", unit: "ratio", formula: "Market capitalisation ÷ trailing free cash flow, at each filing date", percent: false },
  { key: "freeCashFlowYield", label: "Free cash flow yield", short: "FCF yield", unit: "percent", formula: "Trailing free cash flow ÷ market capitalisation, at each filing date", percent: true },
];

const KEYS = new Set<string>(VALUATION_METRICS.map((metric) => metric.key));

/** Whether a chart key is one of these rather than one the company filed. */
export const isValuationMetric = (key: string): key is HistoricalValuationMetric => KEYS.has(key);

/** A period can carry a multiple only if it has a basis and positive cash flow. */
export const valuationUsable = (period: IoPeriod) => period.valuationBasis != null
  && period.values.freeCashFlow != null
  && period.values.freeCashFlow > 0;

export interface ValuationHistoryState {
  /** The periods the multiples could be struck for, newest last. */
  periods: IoPeriod[];
  /** One point per filing date, in date order. */
  history: HistoricalValuationPoint[];
  /** The same, struck from the live quote against the newest period. */
  current: HistoricalValuationPoint | null;
  /** Whether the trailing series was used, for the caption to name it. */
  usesTrailing: boolean;
  loading: boolean;
  failed: boolean;
}

interface PriceAnswer { key: string; points: Record<string, ValuationPrice | null>; failed: boolean }

export function useValuationHistory(view: IoCompanyView | null, quote: IoQuote | null): ValuationHistoryState {
  const usesTrailing = (view?.trailing.length ?? 0) > 0;
  const source = useMemo(
    () => (view ? (usesTrailing ? view.trailing : view.annual) : []),
    [view, usesTrailing],
  );
  const periods = useMemo(() => {
    const latest = source.at(-1)?.end;
    if (!latest) return [];
    const cutoff = new Date(`${latest}T00:00:00Z`);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 10);
    const from = cutoff.toISOString().slice(0, 10);
    return source.filter((period) => period.end >= from && valuationUsable(period));
  }, [source]);

  /*
   * Priced on the day the figures became public, not on the day they were last
   * republished. `filingDate` names the filing each value was read out of, and
   * that is the newest one to carry it — a quarter reappears as a comparative
   * in the following year's report, so for Apple it ran about four hundred days
   * after the period rather than thirty-four. Every historical multiple was
   * therefore a year-old set of figures against a year-newer price, which for a
   * growing company inflates every one of them: Apple's ten-year median P/FCF
   * read 29.6× where it should read 25.2×, and today's multiple sat at the 77th
   * percentile of its own decade instead of the 95th.
   */
  const dates = useMemo(() => [...new Set(periods.map((period) => period.publishedAt))].sort(), [periods]);
  const ticker = view?.company.ticker ?? "";
  const key = `${ticker}|${dates.join(",")}`;
  const [answer, setAnswer] = useState<PriceAnswer | null>(null);
  const current = answer?.key === key ? answer : null;

  useEffect(() => {
    if (!dates.length || !ticker) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/prices/${encodeURIComponent(ticker)}?dates=${encodeURIComponent(dates.join(","))}&published=1`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { points?: Array<{ requestedDate: string; point?: PricePoint | null }> };
        const points: Record<string, ValuationPrice | null> = {};
        for (const item of body.points ?? []) {
          const point = item.point;
          const price = point?.priceClose ?? point?.close ?? null;
          points[item.requestedDate] = point && price != null ? { price, date: point.date, currency: point.currency } : null;
        }
        if (!controller.signal.aborted) setAnswer({ key, points, failed: false });
      } catch {
        if (!controller.signal.aborted) setAnswer({ key, points: {}, failed: true });
      }
    })();
    return () => controller.abort();
  }, [dates, key, ticker]);

  const history = useMemo<HistoricalValuationPoint[]>(() => {
    if (!current || current.failed) return [];
    return periods.flatMap((period) => {
      const price = current.points[period.publishedAt];
      const point = price ? historicalValuationPoint(period, price) : null;
      return point ? [point] : [];
    });
  }, [current, periods]);

  const newest = [...periods].reverse().find(valuationUsable) ?? null;
  const live = quote?.price != null && quote.currency
    ? { price: quote.price, date: quote.asOf?.slice(0, 10) ?? new Date().toISOString().slice(0, 10), currency: quote.currency }
    : null;

  return {
    periods,
    history,
    current: newest && live ? historicalValuationPoint(newest, live) : null,
    usesTrailing,
    loading: dates.length > 0 && current == null,
    failed: current?.failed ?? false,
  };
}

/**
 * One multiple as a line, newest point last.
 *
 * The filing dates are the days each figure became knowable, and today's quote
 * against the newest period is the end of it. Nothing sits between two filings,
 * because a multiple only moves when the price or the filing does — and the
 * price here is read once per filing precisely so that no point is a price the
 * market had not yet seen.
 */
export function valuationPoints(
  state: ValuationHistoryState,
  metric: HistoricalValuationMetric,
): Array<{ date: string; value: number; label: string }> {
  return [...state.history, ...(state.current ? [state.current] : [])]
    .flatMap((point) => {
      const value = point.metrics[metric];
      return value == null ? [] : [{ date: point.date, value, label: point.periodLabel }];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}
