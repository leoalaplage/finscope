"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { layoutMap, moveColor, SECTOR_HEADER } from "@/lib/term/heatmap-layout";
import { axisFor } from "@/lib/term/fundamental-charts";
import { ABSENT, shortDate } from "@/components/io/format";
import { useWidth } from "./use-width";

/**
 * The drawings PORT is made of: the book against the index with its
 * drawdown underneath, a treemap of the holdings, horizontal bars, a
 * correlation matrix and a calendar of monthly returns. Each is drawn at the
 * pixel size of its box.
 */

const pct = (value: number | null | undefined, places = 1) =>
  value == null || !Number.isFinite(value) ? ABSENT : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(places)}%`;

/* --- Performance against the index ------------------------------------- */

export interface PerfPoint { date: string; book: number; index: number; under: number }

export interface TradeMark { date: string; kind: "buy" | "sell"; label: string }

/** Where each dated trade falls on a series' points: the first point on or after it. */
function placeMarks(dates: string[], marks: TradeMark[]) {
  const placed = new Map<number, TradeMark[]>();
  for (const mark of marks) {
    const index = dates.findIndex((date) => date >= mark.date);
    if (index < 0) continue;
    placed.set(index, [...(placed.get(index) ?? []), mark]);
  }
  return [...placed.entries()];
}

export function PerfChart({ points, label, height = 300, marks = [] }: { points: PerfPoint[]; label: string; height?: number; marks?: TradeMark[] }) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const under = 70;
  const top = 8; const left = 6; const right = 52; const bottom = 18;
  const plotHeight = height - under - bottom - top - 10;
  const changes = points.flatMap((point) => [point.book / 100 - 1, point.index / 100 - 1]);
  const axis = axisFor(changes, true, 5);
  const depth = Math.min(-0.01, ...points.map((point) => point.under));
  const x = (index: number) => left + (index / Math.max(points.length - 1, 1)) * (width - left - right);
  const y = (change: number) => top + (1 - (change - axis!.min) / (axis!.max - axis!.min || 1)) * plotHeight;
  const underTop = top + plotHeight + 10;
  const yu = (value: number) => underTop + (value / depth) * under;
  const path = (read: (point: PerfPoint) => number) => points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(read(point)).toFixed(1)}`).join("");
  const at = hover ?? points.length - 1;
  const current = points[at];
  const pick = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - box.left) / box.width) * (points.length - 1)))));
  };
  const labels = width > 0 ? Math.max(2, Math.floor((width - left - right) / 90)) : 0;

  return (
    <div className="t-pf-perf" ref={ref}>
      {current ? (
        <div className="t-pf-readout">
          <span className="t-dim">{shortDate(current.date)}</span>
          <span><i className="t-pf-key t-pf-key-book" />Portfolio <b data-dir={current.book >= 100 ? "up" : "down"}>{pct(current.book / 100 - 1)}</b></span>
          <span><i className="t-pf-key t-pf-key-index" />{label} <b data-dir={current.index >= 100 ? "up" : "down"}>{pct(current.index / 100 - 1)}</b></span>
          <span className="t-dim">Spread <b data-dir={current.book >= current.index ? "up" : "down"}>{pct((current.book - current.index) / 100)}</b></span>
          <span className="t-dim">Drawdown <b data-dir="down">{pct(current.under)}</b></span>
        </div>
      ) : null}
      {width > 0 && axis && points.length > 1 ? (
        <svg width={width} height={height} role="img" aria-label={`Portfolio against the ${label}, rebased, with its drawdown`}>
          {axis.ticks.map((tick) => (
            <g key={tick}>
              <line className="t-gf-rule" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
              <text className="t-gf-tick" x={width - right + 6} y={y(tick) + 3.5}>{pct(tick, 0)}</text>
            </g>
          ))}
          <line className="t-gf-zero" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
          <path className="t-pf-area" d={`${path((point) => point.book / 100 - 1)}L${x(points.length - 1)} ${y(axis.min)}L${x(0)} ${y(axis.min)}Z`} />
          <path className="t-pf-index" d={path((point) => point.index / 100 - 1)} />
          <path className="t-pf-book" d={path((point) => point.book / 100 - 1)} />
          {/* Underwater: how far below its running peak the book stood. */}
          <text className="t-gf-tick" x={left + 2} y={underTop - 2}>DRAWDOWN</text>
          <path className="t-pf-under" d={`M${x(0)} ${underTop}${points.map((point, index) => `L${x(index).toFixed(1)} ${yu(point.under).toFixed(1)}`).join("")}L${x(points.length - 1)} ${underTop}Z`} />
          <text className="t-gf-tick" x={width - right + 6} y={underTop + under}>{pct(depth, 0)}</text>
          {Array.from({ length: labels }, (_, step) => Math.round((step / Math.max(labels - 1, 1)) * (points.length - 1))).map((index) => (
            <text key={index} className="t-gf-tick" x={x(index)} y={height - 4} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{shortDate(points[index].date)}</text>
          ))}
          {/* Buys and sales, as triangles along the foot of the plot. */}
          {placeMarks(points.map((point) => point.date), marks).map(([index, here]) => {
            const sells = here.some((mark) => mark.kind === "sell"); const buys = here.some((mark) => mark.kind === "buy");
            const cx = x(index); const base = top + plotHeight;
            return (
              <g key={index}>
                <title>{here.map((mark) => mark.label).join("\n")}</title>
                {buys ? <path className="t-pf-mark-buy" d={`M${cx - 4} ${base - 1}L${cx + 4} ${base - 1}L${cx} ${base - 8}Z`} /> : null}
                {sells ? <path className="t-pf-mark-sell" d={`M${cx - 4} ${base - 12}L${cx + 4} ${base - 12}L${cx} ${base - 5}Z`} /> : null}
              </g>
            );
          })}
          {hover != null ? <line className="t-pf-cursor" x1={x(hover)} x2={x(hover)} y1={top} y2={underTop + under} /> : null}
          <rect className="t-gf-catch" x={left} y={top} width={Math.max(0, width - left - right)} height={underTop + under - top}
            onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)} />
        </svg>
      ) : <div style={{ height }} className="t-empty">{points.length ? "" : "Reading prices…"}</div>}
    </div>
  );
}

/* --- Treemap ----------------------------------------------------------- */

export interface MapHolding { ticker: string; sector: string; value: number; change: number | null; weight: number }

export function HoldingsMap({ items, height = 300 }: { items: MapHolding[]; height?: number }) {
  const { ref, width } = useWidth();
  const placed = width > 0 ? layoutMap(items.map((item) => ({ ...item, industry: item.sector, cap: item.value })), { x: 0, y: 0, width, height }, { industries: false }) : [];
  return (
    <div className="t-heat-map t-pf-map" ref={ref} style={{ height }}>
      {placed.map((sector) => (
        <div key={sector.name}>
          {sector.header ? <div className="t-pf-map-sector" style={{ left: sector.x, top: sector.y, width: sector.width, height: SECTOR_HEADER }}>{sector.name}</div> : null}
          {sector.industries.flatMap((industry) => industry.tiles).map((tile) => {
            const large = tile.width > 70 && tile.height > 36;
            return (
              <a
                key={tile.item.ticker} className="t-heat-tile" href={`/t/s/${encodeURIComponent(tile.item.ticker)}`}
                title={`${tile.item.ticker} · ${(tile.item.weight * 100).toFixed(1)}% of the book · ${pct(tile.item.change, 2)} today`}
                style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height, background: moveColor(tile.item.change == null ? null : tile.item.change * 100, 3), fontSize: large ? 13 : 10 }}
              >
                {tile.width > 28 && tile.height > 14 ? <b>{tile.item.ticker}</b> : null}
                {large ? <span>{(tile.item.weight * 100).toFixed(1)}% · {pct(tile.item.change, 2)}</span> : null}
              </a>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* --- Horizontal bars --------------------------------------------------- */

export interface BarRow { label: string; value: number; note?: string; href?: string; color?: string }

/** The terminal's eight series colours, by position. */
export const paletteColor = (index: number) => `var(--c${(index % 8) + 1})`;

/**
 * Bars from a zero line, left for negatives and right for positives, scaled to the largest.
 * "sign" colours them by direction, "plain" in one colour, "palette" one colour a bar —
 * the row's own where it has one, so a holding keeps its colour from chart to chart.
 */
export function Bars({ rows, format, tone = "sign" }: { rows: BarRow[]; format: (value: number) => string; tone?: "sign" | "plain" | "palette" }) {
  const reach = Math.max(1e-12, ...rows.map((row) => Math.abs(row.value)));
  const signed = rows.some((row) => row.value < 0);
  return (
    <div className="t-pf-bars" data-signed={signed || undefined}>
      {rows.map((row, index) => (
        <div className="t-pf-bar" key={row.label} title={row.note}>
          <span className="t-pf-bar-label">{row.href ? <a href={row.href}>{row.label}</a> : row.label}</span>
          <span className="t-pf-bar-track">
            <i
              data-dir={tone !== "sign" ? undefined : row.value < 0 ? "down" : "up"}
              style={{
                ...(signed
                  ? { width: `${(Math.abs(row.value) / reach) * 50}%`, left: row.value < 0 ? `${50 - (Math.abs(row.value) / reach) * 50}%` : "50%" }
                  : { width: `${(Math.abs(row.value) / reach) * 100}%`, left: 0 }),
                ...(tone === "palette" ? { background: row.color ?? paletteColor(index) } : {}),
              }}
            />
          </span>
          <span className="t-pf-bar-value" data-dir={tone !== "sign" ? undefined : row.value < 0 ? "down" : row.value > 0 ? "up" : undefined}>{format(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* --- Correlation ------------------------------------------------------- */

/** Blue for moving apart, red for moving together, at full strength at one. */
const correlationColor = (value: number | null) => {
  if (value == null) return "transparent";
  const strength = Math.min(1, Math.abs(value));
  return value >= 0 ? `rgba(255, 81, 73, ${0.12 + strength * 0.6})` : `rgba(78, 168, 255, ${0.12 + strength * 0.6})`;
};

export function CorrelationMatrix({ tickers, matrix }: { tickers: string[]; matrix: Array<Array<number | null>> }) {
  return (
    <div className="t-pf-corr">
      <table>
        <thead><tr><th />{tickers.map((ticker) => <th key={ticker} scope="col">{ticker}</th>)}</tr></thead>
        <tbody>
          {tickers.map((row, i) => (
            <tr key={row}>
              <th scope="row">{row}</th>
              {tickers.map((column, j) => (
                <td key={column} style={{ background: i === j ? "var(--raise)" : correlationColor(matrix[i][j]) }} title={`${row} / ${column}`}>
                  {i === j ? "" : matrix[i][j] == null ? ABSENT : matrix[i][j]!.toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --- Monthly returns --------------------------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function MonthlyReturns({ months, years = 8 }: { months: Array<{ year: number; month: number; value: number }>; years?: number }) {
  const byYear = new Map<number, Map<number, number>>();
  for (const entry of months) {
    const row = byYear.get(entry.year) ?? new Map<number, number>();
    row.set(entry.month, entry.value);
    byYear.set(entry.year, row);
  }
  const shown = [...byYear.keys()].sort((a, b) => b - a).slice(0, years);
  return (
    <div className="sheet t-pf-months">
      <table>
        <thead><tr><th className="key">%</th>{MONTHS.map((month) => <th key={month}>{month}</th>)}<th>Year</th></tr></thead>
        <tbody>
          {shown.map((year) => {
            const row = byYear.get(year)!;
            const total = [...row.values()].reduce((product, value) => product * (1 + value), 1) - 1;
            return (
              <tr key={year}>
                <th className="key" scope="row">{year}</th>
                {MONTHS.map((_, index) => {
                  const value = row.get(index + 1);
                  return <td key={index} style={{ background: value == null ? undefined : moveColor(value * 100, 8) }}>{value == null ? "" : (value * 100).toFixed(1)}</td>;
                })}
                <td className="t-pf-year" data-dir={total >= 0 ? "up" : "down"}>{(total * 100).toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --- A sparkline for a table cell -------------------------------------- */

export function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const low = Math.min(...values); const high = Math.max(...values);
  const span = high - low || 1;
  const d = values.map((value, index) => `${index ? "L" : "M"}${((index / (values.length - 1)) * 64).toFixed(1)} ${(18 - ((value - low) / span) * 16 - 1).toFixed(1)}`).join("");
  return <svg className="t-spark" viewBox="0 0 64 18" aria-hidden="true" data-trend={values[values.length - 1] >= values[0] ? "up" : "down"}><path d={d} /></svg>;
}

/* --- Money in against what it is worth --------------------------------- */

const compactMoney = (value: number) => {
  const size = Math.abs(value);
  const text = size >= 1e9 ? `${(size / 1e9).toFixed(1)}B` : size >= 1e6 ? `${(size / 1e6).toFixed(1)}M` : size >= 1e3 ? `${(size / 1e3).toFixed(size >= 1e5 ? 0 : 1)}K` : size.toFixed(0);
  return `${value < 0 ? "−" : ""}$${text}`;
};

/**
 * The book's value against the money put into it, net of sales. The gap
 * between the two is the gain; a step in the invested line is a trade.
 */
export function CapitalChart({ values, invested, marks = [], height = 240 }: {
  values: Array<{ date: string; value: number }>; invested: Array<{ date: string; value: number }>; marks?: TradeMark[]; height?: number;
}) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const top = 8; const left = 6; const right = 56; const bottom = 18;
  const investedAt = (date: string) => { let found = 0; for (const point of invested) { if (point.date > date) break; found = point.value; } return found; };
  const rows = values.map((point) => ({ date: point.date, value: point.value, invested: investedAt(point.date) }));
  const axis = axisFor(rows.flatMap((row) => [row.value, row.invested]), true, 4);
  const x = (index: number) => left + (index / Math.max(rows.length - 1, 1)) * (width - left - right);
  const y = (value: number) => top + (1 - (value - axis!.min) / (axis!.max - axis!.min || 1)) * (height - top - bottom);
  const at = hover ?? rows.length - 1;
  const current = rows[at];
  const pick = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(rows.length - 1, Math.round(((event.clientX - box.left) / box.width) * (rows.length - 1)))));
  };
  const labels = width > 0 ? Math.max(2, Math.floor((width - left - right) / 90)) : 0;
  return (
    <div className="t-pf-perf" ref={ref}>
      {current ? (
        <div className="t-pf-readout">
          <span className="t-dim">{shortDate(current.date)}</span>
          <span><i className="t-pf-key t-pf-key-book" />Value <b>{compactMoney(current.value)}</b></span>
          <span><i className="t-pf-key t-pf-key-invested" />Net invested <b>{compactMoney(current.invested)}</b></span>
          <span className="t-dim">Gain <b data-dir={current.value >= current.invested ? "up" : "down"}>{compactMoney(current.value - current.invested)}</b></span>
        </div>
      ) : null}
      {width > 0 && axis && rows.length > 1 ? (
        <svg width={width} height={height} role="img" aria-label="The book's value against the money put into it">
          {axis.ticks.map((tick) => (
            <g key={tick}>
              <line className="t-gf-rule" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
              <text className="t-gf-tick" x={width - right + 6} y={y(tick) + 3.5}>{compactMoney(tick)}</text>
            </g>
          ))}
          <path className="t-pf-area" d={`${rows.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(row.value).toFixed(1)}`).join("")}L${x(rows.length - 1)} ${y(Math.max(0, axis.min))}L${x(0)} ${y(Math.max(0, axis.min))}Z`} />
          <path className="t-pf-book" d={rows.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(row.value).toFixed(1)}`).join("")} />
          <path className="t-pf-invested" d={rows.map((row, index) => `${index ? `L${x(index).toFixed(1)} ${y(rows[index - 1].invested).toFixed(1)}L` : "M"}${x(index).toFixed(1)} ${y(row.invested).toFixed(1)}`).join("")} />
          {placeMarks(rows.map((row) => row.date), marks).map(([index, here]) => (
            <g key={index}>
              <title>{here.map((mark) => mark.label).join("\n")}</title>
              <circle cx={x(index)} cy={y(rows[index].invested)} r={3} className={here.some((mark) => mark.kind === "sell") ? "t-pf-mark-sell" : "t-pf-mark-buy"} />
            </g>
          ))}
          {Array.from({ length: labels }, (_, step) => Math.round((step / Math.max(labels - 1, 1)) * (rows.length - 1))).map((index) => (
            <text key={index} className="t-gf-tick" x={x(index)} y={height - 4} textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}>{shortDate(rows[index].date)}</text>
          ))}
          {hover != null ? <line className="t-pf-cursor" x1={x(hover)} x2={x(hover)} y1={top} y2={height - bottom} /> : null}
          <rect className="t-gf-catch" x={left} y={top} width={Math.max(0, width - left - right)} height={height - top - bottom}
            onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)} />
        </svg>
      ) : <div style={{ height }} className="t-empty">Reading prices…</div>}
    </div>
  );
}
