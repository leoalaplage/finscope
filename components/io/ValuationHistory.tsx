"use client";

import { useEffect, useMemo, useState } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import {
  historicalValuationPoint,
  historicalValuationRange,
  type HistoricalValuationMetric,
  type HistoricalValuationPoint,
  type ValuationPrice,
} from "@/lib/io/valuation-range";
import type { PricePoint } from "@/lib/types";
import type { IoQuote } from "./quote";
import { ABSENT, percent, ratio } from "./format";

interface PriceAnswer {
  key: string;
  points: Record<string, ValuationPrice | null>;
  failed: boolean;
}

const METRICS: Array<{ key: HistoricalValuationMetric; label: string; percent: boolean }> = [
  { key: "enterpriseToFreeCashFlow", label: "EV / FCF", percent: false },
  { key: "priceToFreeCashFlow", label: "P / FCF", percent: false },
  { key: "freeCashFlowYield", label: "FCF yield", percent: true },
];

const usable = (period: IoPeriod) => period.valuationBasis != null
  && period.values.freeCashFlow != null
  && period.values.freeCashFlow > 0;

const write = (value: number | null, asPercent: boolean) => value == null
  ? ABSENT
  : asPercent ? percent(value, 2) : ratio(value, 1);

const writeRange = (low: number | null, high: number | null, asPercent: boolean) =>
  low == null || high == null ? ABSENT : `${write(low, asPercent)} – ${write(high, asPercent)}`;

/**
 * Current valuation against the ranges investors could actually have observed.
 *
 * Each historical price is the first session on or after the corresponding
 * filing date. The fundamentals therefore never reach backwards in time, and
 * no estimate is mixed into the SEC series.
 */
export function ValuationHistory({ view, quote }: { view: IoCompanyView; quote: IoQuote | null }) {
  const usesTrailing = view.trailing.length > 0;
  const source = usesTrailing ? view.trailing : view.annual;
  const periods = useMemo(() => {
    const latest = source.at(-1)?.end;
    if (!latest) return [];
    const cutoff = new Date(`${latest}T00:00:00Z`);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 10);
    const from = cutoff.toISOString().slice(0, 10);
    return source.filter((period) => period.end >= from && usable(period));
  }, [source]);
  const dates = useMemo(() => [...new Set(periods.map((period) => period.filingDate))].sort(), [periods]);
  const key = `${view.company.ticker}|${dates.join(",")}`;
  const [answer, setAnswer] = useState<PriceAnswer | null>(null);
  const currentAnswer = answer?.key === key ? answer : null;

  useEffect(() => {
    if (!dates.length) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/prices/${encodeURIComponent(view.company.ticker)}?dates=${encodeURIComponent(dates.join(","))}&published=1`,
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
  }, [dates, key, view.company.ticker]);

  const history = useMemo<HistoricalValuationPoint[]>(() => {
    if (!currentAnswer || currentAnswer.failed) return [];
    return periods.flatMap((period) => {
      const price = currentAnswer.points[period.filingDate];
      const point = price ? historicalValuationPoint(period, price) : null;
      return point ? [point] : [];
    });
  }, [currentAnswer, periods]);

  const currentPeriod = [...periods].reverse().find(usable) ?? null;
  const currentPrice = quote?.price != null && quote.currency
    ? { price: quote.price, date: quote.asOf?.slice(0, 10) ?? new Date().toISOString().slice(0, 10), currency: quote.currency }
    : null;
  const current = currentPeriod && currentPrice ? historicalValuationPoint(currentPeriod, currentPrice) : null;
  const asOf = current?.date ?? history.at(-1)?.date ?? new Date().toISOString().slice(0, 10);

  if (!periods.length || !currentPeriod) return null;

  return (
    <section className="section valuation-history" id="valuation-history">
      <div className="section-head">
        <h2 className="label">Valuation history</h2>
        <span className="label">{usesTrailing ? "TTM" : "Annual"} · filing-date prices</span>
      </div>

      {!currentAnswer ? (
        <p className="price-chart plot-empty num faint">Reading historical valuation</p>
      ) : currentAnswer.failed ? (
        <p className="stat-note">Historical prices are temporarily unavailable. Current valuation remains unchanged.</p>
      ) : (
        <div className="sheet valuation-history-sheet">
          <table>
            <thead>
              <tr>
                <th className="key" scope="col">Metric</th>
                <th scope="col">Current</th>
                <th scope="col">5Y range</th>
                <th scope="col">5Y median</th>
                <th scope="col">5Y percentile</th>
                <th scope="col">10Y range</th>
                <th scope="col">10Y median</th>
                <th scope="col">10Y percentile</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => {
                const now = current?.metrics[metric.key] ?? null;
                const five = historicalValuationRange(history, metric.key, now, 5, asOf);
                const ten = historicalValuationRange(history, metric.key, now, 10, asOf);
                return (
                  <tr key={metric.key}>
                    <th className="key" scope="row">{metric.label}</th>
                    <td data-empty={now == null}>{write(now, metric.percent)}</td>
                    <td data-empty={five.low == null} title={`${five.observations} observations`}>{writeRange(five.low, five.high, metric.percent)}</td>
                    <td data-empty={five.median == null}>{write(five.median, metric.percent)}</td>
                    <td data-empty={five.percentile == null}>{five.percentile == null ? ABSENT : percent(five.percentile, 0)}</td>
                    <td data-empty={ten.low == null} title={`${ten.observations} observations`}>{writeRange(ten.low, ten.high, metric.percent)}</td>
                    <td data-empty={ten.median == null}>{write(ten.median, metric.percent)}</td>
                    <td data-empty={ten.percentile == null}>{ten.percentile == null ? ABSENT : percent(ten.percentile, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
