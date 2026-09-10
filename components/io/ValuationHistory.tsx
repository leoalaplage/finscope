"use client";

import { useState } from "react";
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
 * So each measure is a line. The window it has traded in is the band, the
 * median is a tick, and today is the mark you look for. Nothing here is a
 * colour: the bar is one ink at three weights, which is the same way the rest
 * of the site says near and far.
 *
 * Five years or ten, chosen once for the whole list. Both were drawn at once
 * for a while, one band inside the other, and the two readings argued: a
 * company cheap against its decade and dear against its last five years had
 * two marks' worth of meaning in one. The window is a question the reader asks,
 * so it is a control rather than a layer.
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
 * The chosen window decides them, widened for today where today is beyond it,
 * and then padded by a twentieth so a mark sitting on an end is still a mark
 * and not a cut edge.
 */
function scaleFor(window: HistoricalValuationRange, now: number | null): Scale | null {
  const points = [window.low, window.high, now].filter((value): value is number => value != null && Number.isFinite(value));
  if (points.length < 2) return null;
  const from = Math.min(...points);
  const to = Math.max(...points);
  const pad = (to - from) * 0.05 || Math.abs(to) * 0.05 || 1;
  return { from: from - pad, to: to + pad };
}

function Line({ range, now, asPercent, label, years }: {
  range: HistoricalValuationRange;
  now: number | null;
  asPercent: boolean;
  label: string;
  years: number;
}) {
  const scale = scaleFor(range, now);
  if (!scale) return <div className="range-line range-line-absent">{ABSENT}</div>;

  const low = at(scale, range.low);
  const high = at(scale, range.high);
  const band = low == null || high == null ? null : {
    left: place(low),
    width: `${Math.max(0.6, 100 * (Math.min(1, high) - Math.max(0, low))).toFixed(2)}%`,
  };
  const median = at(scale, range.median);
  const mark = at(scale, now);

  return (
    <div
      className="range-line"
      role="img"
      aria-label={
        `${label}: today ${write(now, asPercent)}, ${years}-year range ${write(range.low, asPercent)} to ${write(range.high, asPercent)}`
        + (range.median == null ? "" : `, median ${write(range.median, asPercent)}`)
        + (range.percentile == null ? "" : `, above ${percent(range.percentile, 0)} of it`)
      }
    >
      <span className="range-rule" />
      {band ? <span className="range-band" style={band} /> : null}
      {median == null ? null : <span className="range-median" style={{ left: place(median) }} />}
      {mark == null ? null : <span className="range-now" style={{ left: place(mark) }} />}
      <span className="range-ends">
        <i>{write(range.low, asPercent)}</i>
        <i>{write(range.high, asPercent)}</i>
      </span>
    </div>
  );
}

/** The two windows the filings can answer for, and the one on screen. */
const WINDOWS = [5, 10] as const;

export function ValuationHistory({
  state,
  selected,
  onSelect,
}: {
  state: ValuationHistoryState;
  selected: string[];
  onSelect: (metric: string | null) => void;
}) {
  const [years, setYears] = useState<(typeof WINDOWS)[number]>(10);
  const asOf = state.current?.date ?? state.history.at(-1)?.date ?? new Date().toISOString().slice(0, 10);

  if (!state.periods.length) return null;

  const rows = (group: "price" | "return") => VALUATION_METRICS.filter((metric) => metric.group === group).map((metric) => {
    const now = state.current?.metrics[metric.key] ?? null;
    const range = historicalValuationRange(state.history, metric.key, now, years, asOf);
    const chosen = selected.includes(metric.key);
    return (
      <li className="range-row" key={metric.key} data-selected={chosen}>
        <button type="button" className="range-name" aria-pressed={chosen} onClick={() => onSelect(chosen ? null : metric.key)}>
          {metric.short}
        </button>
        <span className="range-value" data-empty={now == null}>{write(now, metric.percent)}</span>
        <Line range={range} now={now} asPercent={metric.percent} label={metric.label} years={years} />
        {/* The one figure the picture cannot state exactly: how much of the
            window sits below where the company stands today. */}
        <span className="range-percentile" data-empty={range.percentile == null}>
          {range.percentile == null ? ABSENT : `${percent(range.percentile, 0)} of ${years}y below`}
        </span>
      </li>
    );
  });

  return (
    <section className="section valuation-history" id="valuation-history">
      <div className="section-head">
        <h2 className="label">Valuation and capital returned</h2>
        <div className="range-controls">
          <div className="seg">
            {WINDOWS.map((window) => (
              <button type="button" key={window} aria-pressed={years === window} onClick={() => setYears(window)}>
                {window}Y
              </button>
            ))}
          </div>
          <span className="label">{state.usesTrailing ? "TTM" : "Annual"} · filing-date prices</span>
        </div>
      </div>

      {state.loading ? (
        <p className="price-chart plot-empty num faint">Reading historical valuation</p>
      ) : state.failed ? (
        <p className="stat-note">Historical prices are temporarily unavailable. Current valuation remains unchanged.</p>
      ) : (
        <>
          {/*
            * Two lists, not one list with a rule through it.
            *
            * What a company costs and what it hands back are different
            * questions, and a heavier border between two rows read as a table
            * that had been cut rather than two groups. Each is named.
            */}
          <div className="range-group">
            <h3 className="label">What it costs</h3>
            <ul className="range-list">{rows("price")}</ul>
          </div>
          <div className="range-group">
            <h3 className="label">What it returns</h3>
            <ul className="range-list">{rows("return")}</ul>
          </div>
        </>
      )}
    </section>
  );
}
