"use client";

import { historicalValuationRange, type HistoricalValuationRange } from "@/lib/io/valuation-range";
import { ABSENT, percent, ratio } from "./format";
import { VALUATION_METRICS, type ValuationHistoryState } from "./valuation-series";

const write = (value: number | null, asPercent: boolean) => value == null
  ? ABSENT
  : asPercent ? percent(value, 2) : ratio(value, 1);

/**
 * Where today sits in the decade behind it, drawn rather than tabulated.
 *
 * This was seven columns of figures: a range, a median and a percentile, twice
 * over, for six measures. Every one of those numbers was true and the question
 * they answer is a shape — whether a company sat at thirty times for ten years
 * and is at forty now, or whether forty is simply where it lives. Reading a
 * shape out of "23.0× – 41.0× · 28.9× · 90%" is work the page can do instead.
 *
 * So each measure is a line. The decade it has traded in is the rule, the last
 * five years are the heavier segment inside it, the median is a tick, and today
 * is the mark you look for. Nothing here is a colour: the bar is one ink at
 * three weights, which is the same way the rest of the site says near and far.
 *
 * The scale is stretched to hold today when today is outside everything before
 * it. A company at a multiple it has never traded at should not have its mark
 * pinned to the end of the bar as though it had merely reached the top of the
 * range — the mark sits outside the band, which is the finding.
 *
 * The name is still a control, as every row on this page is: it sends the
 * measure to the chart at the top, where the whole series is drawn.
 */

interface Scale { from: number; to: number }

/** Where a value falls on the drawn scale, as a fraction, or nothing. */
function at(scale: Scale, value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const span = scale.to - scale.from;
  return span <= 0 ? 0.5 : (value - scale.from) / span;
}

const place = (fraction: number) => `${(100 * Math.min(1, Math.max(0, fraction))).toFixed(2)}%`;

/**
 * The ends of the drawn line.
 *
 * The decade decides it, widened for today where today is beyond it, and then
 * padded by a twentieth so a mark sitting on an end is still a mark and not a
 * cut edge.
 */
function scaleFor(ten: HistoricalValuationRange, now: number | null): Scale | null {
  const points = [ten.low, ten.high, now].filter((value): value is number => value != null && Number.isFinite(value));
  if (points.length < 2) return null;
  const from = Math.min(...points);
  const to = Math.max(...points);
  const pad = (to - from) * 0.05 || Math.abs(to) * 0.05 || 1;
  return { from: from - pad, to: to + pad };
}

function Line({ ten, five, now, asPercent, label }: {
  ten: HistoricalValuationRange;
  five: HistoricalValuationRange;
  now: number | null;
  asPercent: boolean;
  label: string;
}) {
  const scale = scaleFor(ten, now);
  if (!scale) return <div className="range-line range-line-absent">{ABSENT}</div>;

  const band = (range: HistoricalValuationRange) => {
    const low = at(scale, range.low);
    const high = at(scale, range.high);
    if (low == null || high == null) return null;
    return { left: place(low), width: `${Math.max(0.6, 100 * (Math.min(1, high) - Math.max(0, low))).toFixed(2)}%` };
  };
  const decade = band(ten);
  const recent = band(five);
  const median = at(scale, ten.median);
  const mark = at(scale, now);

  return (
    <div
      className="range-line"
      role="img"
      aria-label={
        `${label}: today ${write(now, asPercent)}, ten-year range ${write(ten.low, asPercent)} to ${write(ten.high, asPercent)}`
        + (ten.median == null ? "" : `, median ${write(ten.median, asPercent)}`)
        + (ten.percentile == null ? "" : `, above ${percent(ten.percentile, 0)} of the decade`)
      }
    >
      <span className="range-rule" />
      {decade ? <span className="range-band range-decade" style={decade} /> : null}
      {recent ? <span className="range-band range-recent" style={recent} /> : null}
      {median == null ? null : <span className="range-median" style={{ left: place(median) }} />}
      {mark == null ? null : <span className="range-now" style={{ left: place(mark) }} />}
      <span className="range-ends">
        <i>{write(ten.low, asPercent)}</i>
        <i>{write(ten.high, asPercent)}</i>
      </span>
    </div>
  );
}

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
        <h2 className="label">Valuation and capital returned</h2>
        <span className="label">{state.usesTrailing ? "TTM" : "Annual"} · filing-date prices</span>
      </div>

      {state.loading ? (
        <p className="price-chart plot-empty num faint">Reading historical valuation</p>
      ) : state.failed ? (
        <p className="stat-note">Historical prices are temporarily unavailable. Current valuation remains unchanged.</p>
      ) : (
        <>
          <ul className="range-list">
            {VALUATION_METRICS.map((metric, index) => {
              const now = state.current?.metrics[metric.key] ?? null;
              const five = historicalValuationRange(state.history, metric.key, now, 5, asOf);
              const ten = historicalValuationRange(state.history, metric.key, now, 10, asOf);
              const chosen = selected.includes(metric.key);
              const opens = index > 0 && metric.group !== VALUATION_METRICS[index - 1].group;
              return (
                <li className="range-row" key={metric.key} data-selected={chosen} data-opens={opens || undefined}>
                  <button type="button" className="range-name" aria-pressed={chosen} onClick={() => onSelect(chosen ? null : metric.key)}>
                    {metric.short}
                  </button>
                  <span className="range-value" data-empty={now == null}>{write(now, metric.percent)}</span>
                  <Line ten={ten} five={five} now={now} asPercent={metric.percent} label={metric.label} />
                  {/* The one figure the picture cannot state exactly: how much
                      of the decade is below where the company stands today. */}
                  <span className="range-percentile" data-empty={ten.percentile == null}>
                    {ten.percentile == null ? ABSENT : `${percent(ten.percentile, 0)} of 10y below`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="stat-note range-legend">
            The rule is the ten years of filed multiples behind this company, the heavier
            segment the last five, the tick the ten-year median, and the mark today. Each
            historical point is priced on the first session after that filing became public.
          </p>
        </>
      )}
    </section>
  );
}
