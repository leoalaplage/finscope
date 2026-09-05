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
 * A row of periods, at the size a small multiple has for it.
 *
 * A negative bar is drawn as an outline rather than a filled block. On a site
 * with one ink that is the only honest way to separate the two directions at a
 * glance, and it reads correctly in a screenshot, in print and to a reader who
 * sees no colour at all.
 */
export function Bars({ values }: { values: Array<number | null> }) {
  const extent = extentOf(values, true);
  if (!extent) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <BarMarks values={values} extent={extent} active={null} />
    </svg>
  );
}

export interface PricePoint { date: string; value: number }

export type Shape = "area" | "bars";

/**
 * The one big chart, in whichever shape the measure asks for.
 *
 * A crosshair and nothing else. The reader's pointer names a period and the
 * readout above the chart states it: no tooltip box following the cursor, no
 * second axis appearing on hover, no annotation layer.
 *
 * The two shapes count their positions differently and the pointer has to agree
 * with what is drawn. A line's points sit *on* both edges, so the nearest one
 * is the rounded fraction of the gaps between them; a bar occupies a slot, so
 * the one under the pointer is the fraction floored across the slots. Getting
 * that wrong is invisible on a wide chart and obvious on a narrow one.
 */
export function Figure({
  points,
  shape,
  onHover,
  projectedFrom,
}: {
  points: PricePoint[];
  shape: Shape;
  onHover: (index: number | null) => void;
  /**
   * The index from which the bars stop being filed and start being implied.
   *
   * Everything before it happened and is drawn solid; everything from it on is
   * arithmetic on an assumption and is drawn as an outline. One row of bars,
   * two kinds of claim, told apart the way this site tells a negative bar from
   * a positive one — by whether it is filled — so it survives one ink, a
   * screenshot and a reader who sees no colour.
   */
  projectedFrom?: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const values = useMemo(() => points.map((point) => point.value), [points]);
  // Bars stand on zero; an area is free to crop to the band the values occupy.
  const extent = useMemo(() => extentOf(values, shape === "bars"), [values, shape]);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0 || points.length === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const index = shape === "bars"
      ? Math.min(points.length - 1, Math.floor(fraction * points.length))
      : Math.round(fraction * (points.length - 1));
    setCursor(index);
    onHover(index);
  };
  const leave = () => { setCursor(null); onHover(null); };

  if (!extent) return null;
  const active = cursor == null ? null : points[cursor] ?? null;
  const slot = W / Math.max(points.length, 1);
  const cursorX = shape === "bars"
    ? slot * (cursor ?? 0) + slot / 2
    : xOf(cursor ?? 0, points.length);

  return (
    <div
      className="plot price-chart"
      ref={frame}
      onPointerMove={move}
      onPointerLeave={leave}
      onPointerDown={move}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {shape === "bars" ? (
          <BarMarks values={values} extent={extent} active={cursor} projectedFrom={projectedFrom} />
        ) : (
          <>
            <path className="plot-area" d={`${segments(values, extent)} L${W} ${H} L0 ${H} Z`} />
            <path className="plot-line" d={segments(values, extent)} vectorEffect="non-scaling-stroke" />
          </>
        )}
        {active ? (
          <line className="plot-cursor" x1={cursorX} x2={cursorX} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      {active && shape !== "bars" ? (
        <div className="plot-axis">
          {/*
            * The dot is HTML rather than an SVG circle, which would be drawn as
            * an ellipse by the same stretch that keeps the line honest.
            */}
          <span
            className="plot-dot-mark"
            style={{
              left: `${((cursor as number) / Math.max(points.length - 1, 1)) * 100}%`,
              top: `${((extent.max - active.value) / (extent.max - extent.min)) * 100}%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The bars of the big chart, with the hovered one told apart by weight alone. */
function BarMarks({
  values, extent, active, projectedFrom,
}: {
  values: Array<number | null>;
  extent: Extent;
  active: number | null;
  projectedFrom?: number;
}) {
  const zero = yOf(0, extent);
  const slot = W / Math.max(values.length, 1);
  const width = Math.max(slot * 0.6, 1.5);
  return (
    <>
      {values.map((value, index) => {
        if (value == null || !Number.isFinite(value)) return null;
        const y = yOf(value, extent);
        const top = Math.min(y, zero);
        const height = Math.max(Math.abs(y - zero), 1);
        const x = slot * index + (slot - width) / 2;
        const projected = projectedFrom != null && index >= projectedFrom;
        const outlined = value < 0 || projected;
        const className = value < 0
          ? "plot-bar-neg"
          : projected
            ? `plot-bar-projected${index === active ? " plot-bar-active-outline" : ""}`
            : index === active ? "plot-bar plot-bar-active" : "plot-bar";
        return outlined
          ? <rect key={index} className={className} x={x} y={top} width={width} height={height} vectorEffect="non-scaling-stroke" />
          : <rect key={index} className={className} x={x} y={top} width={width} height={height} />;
      })}
      {extent.min < 0 ? <line className="plot-base" x1={0} x2={W} y1={zero} y2={zero} vectorEffect="non-scaling-stroke" /> : null}
    </>
  );
}

/**
 * A line on a shared frame, and whether it is the one being drawn *of*.
 *
 * `area` fills the band under a series, which is what the share price chart
 * does with the one line it draws. On a frame carrying two, filling one of them
 * says which is the subject and which is the thing it is being held against
 * without a legend, a colour or a word: a portfolio is the picture, the index
 * beside it is a reference.
 */
export interface Series { label: string; points: PricePoint[]; area?: boolean }

/**
 * Several companies on one axis, told apart without a second colour.
 *
 * This is the hard case for a monochrome site, and dashes are the answer that
 * has always worked in print: five stroke patterns, plus each line's name set
 * at the end of it where the eye already is. A legend in a corner would make
 * the reader look away from the chart and match a swatch to a word; a label on
 * the line itself is read where the line ends.
 *
 * Everything is drawn against one extent, because two scales sharing a frame
 * put their crossing point wherever the axes were placed rather than where the
 * data crosses. Levels of different sizes are indexed by the caller before they
 * get here; a rate needs no indexing and gets none.
 */
export function MultiLine({
  series,
  scale = "linear",
  onHover,
}: {
  series: Series[];
  /**
   * Logarithmic wherever the lines have been rebased.
   *
   * Indexing puts every company at 100 and then lets them run: NVIDIA reaches
   * 2,500 while its neighbours sit near 150, and on a linear axis the other
   * lines are flat against the floor. A log scale is the standard answer
   * because it makes equal *rates* equal slopes, which is exactly the
   * comparison an indexed chart is for — doubling looks the same wherever it
   * starts. A value at or below zero cannot sit on such an axis and is drawn
   * as a gap, the same way any missing figure is.
   */
  scale?: "linear" | "log";
  onHover: (index: number | null) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const placed = useMemo(
    () => series.map((entry) => entry.points.map((point) => (scale === "log" ? (point.value > 0 ? Math.log10(point.value) : null) : point.value))),
    [series, scale],
  );
  const length = Math.max(...series.map((entry) => entry.points.length), 0);
  const extent = useMemo(() => extentOf(placed.flat(), false), [placed]);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0 || length === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const index = Math.round(fraction * (length - 1));
    setCursor(index);
    onHover(index);
  };
  const leave = () => { setCursor(null); onHover(null); };

  if (!extent || length < 2) return null;
  const cursorX = xOf(cursor ?? 0, length);

  return (
    <div className="plot price-chart" ref={frame} onPointerMove={move} onPointerLeave={leave} onPointerDown={move}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {/* Every fill first, so a stroke is never drawn under another series'
            band — with two of them that is the difference between a dashed line
            you can follow and one that disappears for half the chart. */}
        {series.map((entry, index) => {
          const path = entry.area ? segments(placed[index], extent) : "";
          if (!path) return null;
          const length = placed[index].length;
          const first = placed[index].findIndex((value) => value != null);
          const last = length - 1 - [...placed[index]].reverse().findIndex((value) => value != null);
          return (
            <path
              key={`${entry.label}-area`}
              className="plot-area"
              d={`${path} L${xOf(last, length).toFixed(2)} ${H} L${xOf(first, length).toFixed(2)} ${H} Z`}
            />
          );
        })}
        {series.map((entry, index) => (
          <path
            key={entry.label}
            className={`plot-line plot-stroke-${index % 5}`}
            d={segments(placed[index], extent)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {cursor != null ? (
          <line className="plot-cursor" x1={cursorX} x2={cursorX} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      <div className="plot-axis">
        {series.map((entry, index) => {
          const last = placed[index].at(-1);
          if (last == null) return null;
          return (
            <span
              key={entry.label}
              className="plot-name"
              style={{ top: `${((extent.max - last) / (extent.max - extent.min)) * 100}%` }}
            >
              <span className={`plot-swatch plot-stroke-${index % 5}`} />
              {entry.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}


export interface AxisSeries { label: string; points: PricePoint[]; axis: 0 | 1 }

/**
 * Two or three measures on one frame, read against two scales.
 *
 * This is the one place on the site where a second value axis is overlaid, and
 * it is worth naming what that costs: where two lines cross means nothing at
 * all. Two independent scales can be slid past each other until any two series
 * touch anywhere, so the crossing point is a property of the axes rather than
 * of the business. What survives is each line's own shape — where it turned,
 * how steadily it moved — and both axes are written out so a reader can see
 * what they are reading against.
 *
 * Series sharing a unit share an axis and are therefore genuinely comparable
 * with each other; that comparison is real.
 */
export function MultiAxis({
  series,
  onHover,
}: {
  series: AxisSeries[];
  onHover: (index: number | null) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const extents = useMemo(() => ([0, 1] as const).map((axis) =>
    extentOf(series.filter((entry) => entry.axis === axis).flatMap((entry) => entry.points.map((point) => point.value)), false)),
    [series]);
  const length = Math.max(...series.map((entry) => entry.points.length), 0);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0 || length === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const index = Math.round(fraction * (length - 1));
    setCursor(index);
    onHover(index);
  };

  if (!extents[0] || length < 2) return null;
  const cursorX = xOf(cursor ?? 0, length);

  return (
    <div
      className="plot price-chart"
      ref={frame}
      onPointerMove={move}
      onPointerLeave={() => { setCursor(null); onHover(null); }}
      onPointerDown={move}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {series.map((entry, index) => {
          const extent = extents[entry.axis] ?? extents[0];
          if (!extent) return null;
          return (
            <path
              key={entry.label}
              className={`plot-line plot-stroke-${index % 5}`}
              d={segments(entry.points.map((point) => point.value), extent)}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {cursor != null ? (
          <line className="plot-cursor" x1={cursorX} x2={cursorX} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
    </div>
  );
}

/** The band each axis covers, so a reader can see what they are reading against. */
export function axisExtents(series: AxisSeries[]): Array<{ min: number; max: number } | null> {
  return ([0, 1] as const).map((axis) =>
    extentOf(series.filter((entry) => entry.axis === axis).flatMap((entry) => entry.points.map((point) => point.value)), false));
}
