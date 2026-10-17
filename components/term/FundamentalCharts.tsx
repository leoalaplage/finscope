"use client";

import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useWidth } from "./use-width";
import { BrandLogo } from "@/components/BrandLogo";
import type { IoCompanyView } from "@/lib/io/view";
import type { SegmentData } from "@/lib/segments/build";
import { segmentCharts } from "@/lib/segments/charts";
import { formatUnit, currencySymbol } from "@/components/io/format";
import {
  PRESETS, RANGES, axisFor, buildPreset,
  type Axis, type AxisUnit, type ChartData, type Frequency, type Preset, type RangeId,
} from "@/lib/term/fundamental-charts";

/**
 * GF: a gallery of ready-made fundamental charts for the company on screen
 * (lib/term/fundamental-charts.ts) — bars and lines on one or two axes, with
 * a grid, a legend and a crosshair that states every figure of the period
 * under the pointer.
 *
 * Unlike the document site's plots, these are drawn at the pixel size of
 * their box, measured, so the axis labels are real text at a real size.
 */

const FREQUENCIES: Array<{ id: Frequency; name: string }> = [
  { id: "quarterly", name: "Quarterly" },
  { id: "annual", name: "Annual" },
  { id: "ttm", name: "TTM" },
];

export function FundamentalCharts({ view }: { view: IoCompanyView }) {
  const [frequency, setFrequency] = useState<Frequency>("ttm");
  const [range, setRange] = useState<RangeId>("10Y");
  const [wide, setWide] = useState<string | null>(null);
  const backlog = useBacklog(view.company.ticker, view.company.cik);
  const currency = view.basis?.currency ?? view.company.currency;

  const segments = useSegments(view.company.ticker);
  const charts = useMemo(() => [
    ...PRESETS
      .map((preset) => ({ preset, data: buildPreset(preset, view, frequency, range, backlog ?? new Map()) }))
      .filter((chart): chart is { preset: Preset; data: ChartData } => chart.data != null),
    // The segments' own charts, once they are read (lib/segments/charts.ts).
    ...(segments ? segmentCharts(segments, frequency, range) : []),
  ], [view, frequency, range, backlog, segments]);

  return (
    <div className="t-gf">
      <div className="t-gf-bar">
        <div className="seg" role="group" aria-label="Periods">
          {FREQUENCIES.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={frequency === entry.id} onClick={() => setFrequency(entry.id)}>{entry.name}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={range === entry.id} onClick={() => setRange(entry.id)}>{entry.id}</button>
          ))}
        </div>
        <span className="t-dim">{charts.length} charts · filed figures, {currency} · hover a period for its figures</span>
      </div>
      <div className="t-gf-grid">
        {charts.map(({ preset, data }) => (
          <figure key={preset.id} className="t-gf-card" data-wide={wide === preset.id || undefined}>
            <figcaption>
              <h3>{preset.title}</h3>
              <button
                type="button" className="t-chip"
                aria-pressed={wide === preset.id}
                aria-label={wide === preset.id ? `Shrink ${preset.title}` : `Enlarge ${preset.title}`}
                onClick={() => setWide(wide === preset.id ? null : preset.id)}
              >{wide === preset.id ? "−" : "+"}</button>
            </figcaption>
            <ComboChart preset={preset} data={data} currency={currency} height={wide === preset.id ? 380 : 230} />
            <ul className="t-gf-legend">
              {data.series.map((entry) => (
                <li key={entry.spec.id} data-kind={entry.spec.kind} style={{ "--key": entry.spec.color } as CSSProperties}>
                  <i aria-hidden="true" />{entry.spec.label}{preset.right && entry.spec.axis === "right" ? <span className="t-dim"> (right)</span> : null}
                </li>
              ))}
            </ul>
          </figure>
        ))}
      </div>
      {!charts.length ? <p className="t-empty">This company files too little to draw these charts.</p> : null}
    </div>
  );
}

/** The company's segments, or null until they arrive or where it has none. */
function useSegments(ticker: string): SegmentData | null {
  const [answer, setAnswer] = useState<{ ticker: string; data: SegmentData | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/segments/${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<SegmentData> : null))
      .then((data) => { if (!controller.signal.aborted) setAnswer({ ticker, data }); })
      .catch(() => { /* Without them the segment charts are simply not offered. */ });
    return () => controller.abort();
  }, [ticker]);
  return answer?.ticker === ticker ? answer.data : null;
}

/** Backlog by balance-sheet date, or null until it arrives; empty for a filer that states none. */
function useBacklog(ticker: string, cik: string): Map<string, number> | null {
  const [answer, setAnswer] = useState<{ cik: string; points: Map<string, number> } | null>(null);
  useEffect(() => {
    if (!cik) return;
    const controller = new AbortController();
    fetch(`/api/io/${encodeURIComponent(ticker)}/backlog?cik=${Number(cik)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ points?: Array<{ end: string; value: number }> }> : null))
      .then((body) => { if (!controller.signal.aborted) setAnswer({ cik, points: new Map((body?.points ?? []).map((point) => [point.end, point.value])) }); })
      .catch(() => { /* Without it the backlog chart is simply not offered. */ });
    return () => controller.abort();
  }, [ticker, cik]);
  return answer?.cik === cik ? answer.points : null;
}

/* --- The chart ---------------------------------------------------------- */

const PAD = { top: 10, bottom: 22, left: 50, right: 10, rightAxis: 48 };
const LABEL_GAP = 52;

/** Decimal places a step needs to be written exactly: 2.5 needs one, 0.25 two. */
const placesFor = (step: number) => {
  for (let places = 0; places < 4; places += 1) if (Math.abs(step * 10 ** places - Math.round(step * 10 ** places)) < 1e-6) return places;
  return 4;
};

/** A tick, in the fewest characters that still tell the ticks apart. */
function tickText(value: number, unit: AxisUnit, axis: Axis, currency: string): string {
  const step = axis.ticks.length > 1 ? Math.abs(axis.ticks[1] - axis.ticks[0]) : 1;
  const sign = value < 0 ? "−" : "";
  const size = Math.abs(value);
  if (value === 0) return "0";
  switch (unit) {
    case "percent": return `${sign}${(size * 100).toFixed(placesFor(step * 100))}%`;
    case "ratio": return `${sign}${size.toFixed(placesFor(step))}×`;
    case "perShare": return `${sign}${currencySymbol(currency)}${size.toFixed(placesFor(step))}`;
    default: {
      const top = Math.max(...axis.ticks.map(Math.abs));
      const [scale, suffix] = top >= 1e12 ? [1e12, "T"] : top >= 1e9 ? [1e9, "B"] : top >= 1e6 ? [1e6, "M"] : top >= 1e3 ? [1e3, "K"] : [1, ""];
      return `${sign}${(size / scale).toFixed(placesFor(step / scale))}${suffix}`;
    }
  }
}

export function ComboChart({ preset, data, currency, height }: { preset: Preset; data: ChartData; currency: string; height: number }) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const bars = data.series.filter((entry) => entry.spec.kind === "bar");
  const lines = data.series.filter((entry) => entry.spec.kind === "line");
  const onAxis = (side: "left" | "right") => data.series.filter((entry) => entry.spec.axis === side);
  const left = axisFor(onAxis("left").flatMap((entry) => entry.values), onAxis("left").some((entry) => entry.spec.kind === "bar") || preset.left === "currency");
  const hasRight = onAxis("right").length > 0;
  const right = hasRight ? axisFor(onAxis("right").flatMap((entry) => entry.values), onAxis("right").some((entry) => entry.spec.kind === "bar")) : null;

  const count = data.labels.length;
  const plotLeft = PAD.left;
  const plotRight = Math.max(plotLeft + 10, width - (hasRight ? PAD.rightAxis : PAD.right));
  const plotTop = PAD.top;
  const plotBottom = height - PAD.bottom;
  const slot = (plotRight - plotLeft) / Math.max(count, 1);
  const centre = (index: number) => plotLeft + slot * (index + 0.5);
  const yOf = (value: number, axis: Axis) => plotBottom - ((value - axis.min) / (axis.max - axis.min || 1)) * (plotBottom - plotTop);
  const axisOf = (side: "left" | "right") => (side === "right" ? right : left);

  // A label every few periods, counted back from the latest so it is always named.
  const every = Math.max(1, Math.ceil(LABEL_GAP / Math.max(slot, 1)));
  const labelled = (index: number) => (count - 1 - index) % every === 0;

  const group = Math.min(slot * 0.74, 64);
  const barWidth = bars.length ? Math.max(1, group / bars.length - (bars.length > 1 ? 1 : 0)) : 0;

  const pick = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - box.left) / Math.max(box.width, 1)) * count);
    setHover(Math.min(count - 1, Math.max(0, index)));
  };

  const ready = width > 0 && left != null;
  const zero = left && left.min < 0 && left.max >= 0 ? yOf(0, left) : null;

  return (
    <div className="t-gf-plot" ref={ref} style={{ height }}>
      {ready ? (
        <svg width={width} height={height} role="img" aria-label={`${preset.title}: ${data.series.map((entry) => entry.spec.label).join(", ")}, ${data.labels[0]} to ${data.labels.at(-1)}`}>
          {preset.shadeNegative && zero != null ? (
            <rect className="t-gf-negative" x={plotLeft} y={zero} width={plotRight - plotLeft} height={plotBottom - zero} />
          ) : null}
          {left.ticks.map((tick) => (
            <g key={`l${tick}`}>
              <line className="t-gf-rule" x1={plotLeft} x2={plotRight} y1={yOf(tick, left)} y2={yOf(tick, left)} />
              <text className="t-gf-tick" x={plotLeft - 6} y={yOf(tick, left) + 3.5} textAnchor="end">{tickText(tick, preset.left, left, currency)}</text>
            </g>
          ))}
          {right ? right.ticks.map((tick) => (
            <text key={`r${tick}`} className="t-gf-tick" x={plotRight + 6} y={yOf(tick, right) + 3.5}>{tickText(tick, preset.right ?? "ratio", right, currency)}</text>
          )) : null}
          {data.labels.map((label, index) => (labelled(index) ? (
            <g key={`x${index}`}>
              <line className="t-gf-rule" x1={centre(index)} x2={centre(index)} y1={plotTop} y2={plotBottom} />
              <text className="t-gf-tick" x={centre(index)} y={height - 6} textAnchor="middle">{label}</text>
            </g>
          ) : null))}
          {hover != null ? <rect className="t-gf-hover" x={centre(hover) - slot / 2} y={plotTop} width={slot} height={plotBottom - plotTop} /> : null}
          {zero != null || left.min === 0 ? <line className="t-gf-zero" x1={plotLeft} x2={plotRight} y1={zero ?? plotBottom} y2={zero ?? plotBottom} /> : null}

          {bars.map((entry, barIndex) => {
            const axis = axisOf(entry.spec.axis);
            if (!axis) return null;
            const base = yOf(Math.min(Math.max(0, axis.min), axis.max), axis);
            return (
              <g key={entry.spec.id} fill={entry.spec.color}>
                {entry.values.map((value, index) => {
                  if (value == null) return null;
                  const y = yOf(value, axis);
                  const x = centre(index) - group / 2 + barIndex * (barWidth + (bars.length > 1 ? 1 : 0)) + (bars.length > 1 ? 0.5 : (group - barWidth) / 2);
                  return <rect key={index} x={x} y={Math.min(y, base)} width={barWidth} height={Math.max(1, Math.abs(base - y))} rx={Math.min(2, barWidth / 4)} fill={entry.colors?.[index] ?? undefined} opacity={hover == null || hover === index ? 1 : 0.55} />;
                })}
              </g>
            );
          })}
          {lines.map((entry) => {
            const axis = axisOf(entry.spec.axis);
            if (!axis) return null;
            let open = false;
            const path = entry.values.map((value, index) => {
              if (value == null) { open = false; return ""; }
              const command = `${open ? "L" : "M"}${centre(index).toFixed(1)} ${yOf(value, axis).toFixed(1)}`;
              open = true;
              return command;
            }).join("");
            const dots = count <= 48;
            return (
              <g key={entry.spec.id} stroke={entry.spec.color} fill={entry.spec.color}>
                <path d={path} fill="none" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
                {entry.values.map((value, index) => (value == null || (!dots && index !== hover) ? null : (
                  <circle key={index} cx={centre(index)} cy={yOf(value, axis)} r={index === hover ? 4 : 2.6} strokeWidth={0} />
                )))}
              </g>
            );
          })}
          {/* Tenqay's mark in the plot's corner, as on every chart, faint and under the pointer's notice. */}
          <BrandLogo decorative className="t-gf-brand" x={plotRight - 66} y={plotTop + 4} width={62} height={16} />
          <rect className="t-gf-catch" x={plotLeft} y={plotTop} width={plotRight - plotLeft} height={plotBottom - plotTop}
            onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)} />
        </svg>
      ) : null}
      {ready && hover != null ? (
        <div className="t-gf-tip" style={centre(hover) > width / 2 ? { right: width - centre(hover) + slot / 2 + 6 } : { left: centre(hover) + slot / 2 + 6 }}>
          <b>{data.names[hover]}</b>
          {data.series.map((entry) => (
            <span key={entry.spec.id}>
              <i style={{ background: entry.colors?.[hover] ?? entry.spec.color }} />
              {entry.spec.label}
              <em>{formatUnit(entry.values[hover], entry.spec.axis === "right" ? preset.right ?? preset.left : preset.left, currency)}</em>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
