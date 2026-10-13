"use client";

import { useId, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CandleInterval } from "@/lib/adapters/candles";
import { dateText } from "@/lib/io/candle-chart";
import { niceStep } from "@/lib/term/fundamental-charts";
import { useSize } from "./use-width";
import type { AreaSeries } from "@/lib/term/area-price";

/**
 * The price as a line over the period, measured against the close before it
 * (lib/term/area-price.ts): a dashed line at that reference, the area above it
 * green and below it red, and the scale in percent from it — the move is the
 * reading, the level is in the readout. The period's own open is drawn as a
 * quieter line, so the night's gap is in the picture as well as in the number.
 */

const PAD = { top: 12, right: 64, bottom: 22, left: 8 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const number = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value: number, places = 2) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places })}`;

/** An axis label: the time within a session, the day within weeks, the month beyond. Candle times are the exchange's clock as UTC. */
function tickText(time: number, interval: CandleInterval, spanDays: number): string {
  const date = new Date(time * 1000);
  if (spanDays <= 1.5) return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  if (spanDays <= 120 || interval !== "1wk") return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
}

export function AreaPrice({ series: shown, interval, label }: { series: AreaSeries; interval: CandleInterval; label: string }) {
  const { ref, width, height } = useSize();
  const [hover, setHover] = useState<number | null>(null);
  const clip = `area-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  if (!shown.c.length || shown.baseline == null || shown.baseline <= 0) {
    return <p className="t-empty">{shown.c.length ? "Reference price unavailable." : "Reading prices…"}</p>;
  }
  const baseline = shown.baseline;
  const reference = shown.reference === "open" ? "the open" : shown.reference === "prior close" ? "the close before" : "previous close";
  const referenceLabel = shown.reference === "open" ? "Open" : shown.reference === "prior close" ? "Close before" : "Prev close";
  // The open, where it is not the reference itself.
  const open = shown.reference !== "open" && shown.open != null && shown.open > 0 && Math.abs(shown.open / baseline - 1) > 1e-6 ? shown.open : null;
  const box = { width: Math.max(0, width), height: Math.max(0, height) };
  const n = shown.c.length;
  // The selected reference is zero on the percentage scale.
  const pct = (value: number) => (value / baseline - 1) * 100;
  const moves = shown.c.map(pct);
  const low = Math.min(0, ...moves, ...(open != null ? [pct(open)] : []));
  const high = Math.max(0, ...moves, ...(open != null ? [pct(open)] : []));
  const step = niceStep((high - low) || 0.1, 5);
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Math.abs(tick) < step / 1e6 ? 0 : tick);
  const places = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;

  const plotRight = box.width - PAD.right;
  const plotBottom = box.height - PAD.bottom;
  const x = (index: number) => PAD.left + (index / Math.max(n - 1, 1)) * (plotRight - PAD.left);
  const y = (move: number) => PAD.top + (1 - (move - min) / (max - min || 1)) * (plotBottom - PAD.top);
  const base = y(0);
  const line = moves.map((move, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(move).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)} ${base.toFixed(1)}L${x(0).toFixed(1)} ${base.toFixed(1)}Z`;

  const last = shown.c[n - 1];
  const change = last - shown.baseline;
  const spanDays = (shown.t[n - 1] - shown.t[0]) / 86_400;
  const labels = Math.max(2, Math.floor((plotRight - PAD.left) / 90));
  const every = Math.max(1, Math.ceil(n / labels));
  const active = hover == null ? n - 1 : Math.min(hover, n - 1);

  const pick = (event: ReactPointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHover(Math.min(n - 1, Math.max(0, Math.round(((event.clientX - rect.left) / Math.max(rect.width, 1)) * (n - 1)))));
  };

  return (
    <div className="t-area">
      <div className="t-area-readout">
        <span className="t-area-time">{dateText(shown.t[active], interval)}</span>
        <b>{number(shown.c[active])}</b>
        <span data-dir={shown.c[active] - shown.baseline >= 0 ? "up" : "down"}>
          {signed(shown.c[active] - shown.baseline)} ({signed(((shown.c[active] - shown.baseline) / shown.baseline) * 100)}%)
        </span>
        <span className="t-dim">from {reference} {number(shown.baseline)}</span>
      </div>
      <div className="t-area-plot" ref={ref}>
        {width > 0 && height > 40 && n > 0 ? (
          <svg width={box.width} height={box.height} role="img"
            aria-label={`${label}: ${number(last)}, ${signed((change / shown.baseline) * 100)}% from ${reference} at ${number(shown.baseline)}`}>
            <defs>
              <clipPath id={`${clip}-up`}><rect x={0} y={0} width={box.width} height={Math.max(0, base)} /></clipPath>
              <clipPath id={`${clip}-down`}><rect x={0} y={base} width={box.width} height={Math.max(0, box.height - base)} /></clipPath>
            </defs>
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="t-area-rule" x1={PAD.left} x2={plotRight} y1={y(tick)} y2={y(tick)} />
                {tick !== 0 ? <text className="t-area-tick" x={plotRight + 6} y={y(tick) + 3.5}>{signed(tick, places)}%</text> : null}
              </g>
            ))}
            {shown.t.map((time, index) => ((n - 1 - index) % every === 0 ? (
              <text key={time} className="t-area-tick" x={x(index)} y={box.height - 6} textAnchor="middle">{tickText(time, interval, spanDays)}</text>
            ) : null))}
            <path d={area} className="t-area-fill-up" clipPath={`url(#${clip}-up)`} />
            <path d={area} className="t-area-fill-down" clipPath={`url(#${clip}-down)`} />
            <path d={line} className="t-area-line-up" clipPath={`url(#${clip}-up)`} />
            <path d={line} className="t-area-line-down" clipPath={`url(#${clip}-down)`} />
            {n === 1 ? <circle cx={x(0)} cy={y(moves[0])} r={3.5} className={shown.c[0] >= baseline ? "t-area-dot-up" : "t-area-dot-down"} /> : null}
            {open != null ? (
              <g>
                <line className="t-area-dayopen" x1={PAD.left} x2={plotRight} y1={y(pct(open))} y2={y(pct(open))} />
                <text className="t-area-dayopen-label" x={plotRight - 4} y={y(pct(open)) - 4} textAnchor="end">Open {number(open)}</text>
              </g>
            ) : null}
            {/* The reference price, labelled on the axis. */}
            <line className="t-area-open" x1={PAD.left} x2={plotRight} y1={base} y2={base} />
            <rect className="t-area-open-tag" x={plotRight + 1} y={base - 8} width={PAD.right - 2} height={16} />
            <text className="t-area-open-text" x={plotRight + 6} y={base + 3.5}>{(0).toFixed(places)}%</text>
            <text className="t-area-open-label" x={PAD.left + 4} y={base - 5}>{referenceLabel} {number(shown.baseline)}</text>
            {hover != null ? (
              <g>
                <line className="t-area-cross" x1={x(active)} x2={x(active)} y1={PAD.top} y2={plotBottom} />
                <circle cx={x(active)} cy={y(moves[active])} r={3.5} className={shown.c[active] >= shown.baseline ? "t-area-dot-up" : "t-area-dot-down"} />
              </g>
            ) : null}
            <rect className="t-area-catch" x={PAD.left} y={PAD.top} width={Math.max(0, plotRight - PAD.left)} height={Math.max(0, plotBottom - PAD.top)}
              onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)} />
          </svg>
        ) : null}
      </div>
    </div>
  );
}
