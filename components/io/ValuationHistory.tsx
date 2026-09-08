"use client";

import { historicalValuationRange } from "@/lib/io/valuation-range";
import { ABSENT, percent, ratio } from "./format";
import { VALUATION_METRICS, type ValuationHistoryState } from "./valuation-series";

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
 *
 * A row is a control, like every other table on this page: it sends its measure
 * to the chart at the top. Five numbers across — a range, a median, a
 * percentile, twice over — are the summary of a shape, and the shape is what
 * answers the question the row is asked for: whether a company sat at thirty
 * times for a decade and is at forty now, or whether forty is where it has
 * always been.
 */
export function ValuationHistory({
  state,
  selected,
  onSelect,
}: {
  state: ValuationHistoryState;
  selected: string[];
  onSelect: (metric: string | null) => void;
}) {
  const asOf = state.current?.date ?? state.history.at(-1)?.date ?? new Date().toISOString().slice(0, 10);

  if (!state.periods.length) return null;

  return (
    <section className="section valuation-history" id="valuation-history">
      <div className="section-head">
        <h2 className="label">Valuation history</h2>
        <span className="label">{state.usesTrailing ? "TTM" : "Annual"} · filing-date prices</span>
      </div>

      {state.loading ? (
        <p className="price-chart plot-empty num faint">Reading historical valuation</p>
      ) : state.failed ? (
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
              {VALUATION_METRICS.map((metric) => {
                const now = state.current?.metrics[metric.key] ?? null;
                const five = historicalValuationRange(state.history, metric.key, now, 5, asOf);
                const ten = historicalValuationRange(state.history, metric.key, now, 10, asOf);
                const chosen = selected.includes(metric.key);
                return (
                  <tr key={metric.key} data-selected={chosen}>
                    <th className="key" scope="row">
                      <button type="button" className="key-open" aria-pressed={chosen} onClick={() => onSelect(chosen ? null : metric.key)}>
                        {metric.short}
                      </button>
                    </th>
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
