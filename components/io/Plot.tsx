"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Every chart on this site, drawn as plainly as the data allows.
 *
 * No grid, no axis rules, no legend, no tick ladder. A price line is one
 * stroke; a series of years is a row of bars and the two figures at its ends.
 * What a reader wants from a chart here is the shape and the last value, and
 * everything drawn that is not one of those two is furniture.
 *
 * The geometry is a fixed 1000×300 box stretched to whatever width the
 * container has, so nothing measures the DOM and no chart re-renders on a
 * resize. Strokes opt out of that stretch with `vector-effect`, so a line is
 * 1.25px wide at every width. Nothing inside an SVG here is text — text cannot
 * survive a non-uniform stretch — so labels are HTML positioned over the plot,
 * which also means they are selectable and read by a screen reader in order.
 */

const W = 1000;
const H = 300;

export interface Extent { min: number; max: number }

function extentOf(values: Array<number | null>, includeZero: boolean): Extent | null {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!known.length) return null;
  let min = Math.min(...known);
  let max = Math.max(...known);
  if (includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (min === max) { min -= Math.abs(min || 1) * 0.05; max += Math.abs(max || 1) * 0.05; }
  return { min, max };
}

const xOf = (index: number, length: number) => (length < 2 ? W / 2 : (index / (length - 1)) * W);
const yOf = (value: number, extent: Extent) => H - ((value - extent.min) / (extent.max - extent.min)) * H;

/** One `M…L…` run per unbroken stretch, so a gap in the data is a gap in the line. */
function segments(values: Array<number | null>, extent: Extent): string {
  const parts: string[] = [];
  let open = false;
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) { open = false; return; }
    const point = `${xOf(index, values.length).toFixed(2)} ${yOf(value, extent).toFixed(2)}`;
    parts.push(`${open ? "L" : "M"}${point}`);
    open = true;
  });
  return parts.join(" ");
}

export function Line({ values, area = false, extent: given }: { values: Array<number | null>; area?: boolean; extent?: Extent }) {
  const extent = given ?? extentOf(values, false);
  if (!extent) return null;
  const path = segments(values, extent);
  if (!path) return null;
  const first = values.findIndex((value) => value != null);
  const last = values.length - 1 - [...values].reverse().findIndex((value) => value != null);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {area ? (
        <path
          className="plot-area"
          d={`${path} L${xOf(last, values.length).toFixed(2)} ${H} L${xOf(first, values.length).toFixed(2)} ${H} Z`}
        />
      ) : null}
      <path className="plot-line" d={path} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * A row of years.
 *
 * A negative bar is drawn as an outline rather than a filled block. On a site
 * with one ink that is the only honest way to separate the two directions at a
 * glance, and it reads correctly in a screenshot, in print and to a reader who
 * sees no colour at all.
 */
export function Bars({ values }: { values: Array<number | null> }) {
  const extent = extentOf(values, true);
  if (!extent) return null;
  const zero = yOf(0, extent);
  const slot = W / Math.max(values.length, 1);
  const width = Math.max(slot * 0.58, 1.5);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {values.map((value, index) => {
        if (value == null || !Number.isFinite(value)) return null;
        const y = yOf(value, extent);
        const top = Math.min(y, zero);
        const height = Math.max(Math.abs(y - zero), 1);
        const x = slot * index + (slot - width) / 2;
        return value < 0
          ? <rect key={index} className="plot-bar-neg" x={x} y={top} width={width} height={height} vectorEffect="non-scaling-stroke" />
          : <rect key={index} className="plot-bar" x={x} y={top} width={width} height={height} />;
      })}
      {extent.min < 0 ? <line className="plot-base" x1={0} x2={W} y1={zero} y2={zero} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}

export interface PricePoint { date: string; value: number }

/**
 * The price line, with a crosshair and nothing else.
 *
 * The reader's pointer names a session and the readout above the chart states
 * it. That is the whole interaction: no tooltip box following the cursor, no
 * second axis appearing on hover, no annotation layer.
 */
export function PriceLine({
  points,
  onHover,
}: {
  points: PricePoint[];
  onHover: (index: number | null) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const values = useMemo(() => points.map((point) => point.value), [points]);
  const extent = useMemo(() => extentOf(values, false), [values]);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0 || points.length === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const index = Math.round(fraction * (points.length - 1));
    setCursor(index);
    onHover(index);
  };
  const leave = () => { setCursor(null); onHover(null); };

  if (!extent) return null;
  const active = cursor == null ? null : points[cursor];

  return (
    <div
      className="plot price-chart"
      ref={frame}
      onPointerMove={move}
      onPointerLeave={leave}
      onPointerDown={move}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path
          className="plot-area"
          d={`${segments(values, extent)} L${W} ${H} L0 ${H} Z`}
        />
        <path className="plot-line" d={segments(values, extent)} vectorEffect="non-scaling-stroke" />
        {active ? (
          <line
            className="plot-cursor"
            x1={xOf(cursor as number, points.length)}
            x2={xOf(cursor as number, points.length)}
            y1={0}
            y2={H}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      {active ? (
        <div
          className="plot-axis"
          style={{
            // The dot is HTML rather than an SVG circle, which would be drawn
            // as an ellipse by the same stretch that keeps the line honest.
            "--x": `${((cursor as number) / Math.max(points.length - 1, 1)) * 100}%`,
            "--y": `${((extent.max - active.value) / (extent.max - extent.min)) * 100}%`,
          } as React.CSSProperties}
        >
          <span
            style={{
              position: "absolute", left: "var(--x)", top: "var(--y)",
              width: 7, height: 7, marginLeft: -3.5, marginTop: -3.5,
              borderRadius: "50%", background: "var(--bg)", border: "1.5px solid var(--ink)",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
