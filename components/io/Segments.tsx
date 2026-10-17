"use client";

import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { SegmentData } from "@/lib/segments/build";
import { RESIDUAL_ID, backlogCards, segmentChart, segmentRows, segmentViews, periodLabel, type SegmentChart, type SegmentPeriodicity } from "@/lib/segments/view";
import { useWidth } from "@/components/term/use-width";
import { ABSENT, money, shortDate } from "./format";

/**
 * The company in slices, as its filings state them (lib/segments): revenue by
 * segment, inside a segment, by product and by region; operating income and
 * margin by segment; backlog by segment. Each cut is drawn stacked only where
 * its lines add up to the reported total, and says so.
 */

const RESIDUAL_COLOR = "#6b7280";
const COLORS = ["#4ea8ff", "#f5a524", "#2fbf71", "#e5484d", "#a78bfa", "#14b8a6", "#f472b6", "#94a3b8", "#eab308", "#60a5fa", "#fb923c", "#22c55e"];

const pct = (value: number | null, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(places)}%`);
const share = (value: number | null) => (value == null ? ABSENT : `${(value * 100).toFixed(1)}%`);
const dir = (value: number | null) => (value == null || value === 0 ? undefined : value > 0 ? "up" : "down");

export function Segments({ ticker }: { ticker: string; cik?: string }) {
  const [answer, setAnswer] = useState<{ ticker: string; data: SegmentData | null; failed?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [viewId, setViewId] = useState<string | null>(null);
  const [periodicity, setPeriodicity] = useState<SegmentPeriodicity>("quarterly");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/segments/${encodeURIComponent(ticker)}`, { signal: controller.signal, cache: attempt ? "reload" : "default" })
      .then(async (response) => ({ data: response.ok ? await response.json() as SegmentData : null, failed: response.status >= 500 }))
      .then(({ data, failed }) => { if (!controller.signal.aborted) setAnswer({ ticker, data, failed }); })
      .catch(() => { if (!controller.signal.aborted) setAnswer({ ticker, data: null, failed: true }); });
    return () => controller.abort();
  }, [ticker, attempt]);

  const data = answer?.ticker === ticker ? answer.data : undefined;
  const views = useMemo(() => (data ? segmentViews(data) : []), [data]);
  const backlog = useMemo(() => (data ? backlogCards(data) : []), [data]);
  if (data === undefined) return <section className="section segments"><p className="stat-note">Reading the segments from the company&apos;s recent filings… the first reading takes a few seconds.</p></section>;
  if (!data && answer?.failed) {
    return (
      <section className="section segments">
        <p className="stat-note">EDGAR did not answer just now — it turns away some requests from shared cloud addresses. <button type="button" className="segments-retry" onClick={() => setAttempt((count) => count + 1)}>Try again</button></p>
      </section>
    );
  }
  if (!data || !views.length) {
    return <section className="section segments"><p className="stat-note">This company&apos;s filings do not break its revenue down by segment, product or region in a form that can be read.</p></section>;
  }
  const view = views.find((entry) => entry.id === viewId) ?? views[0];
  const revenue = segmentChart(data, view, periodicity, "revenue");
  const income = view.axis === "business" && !view.parent ? segmentChart(data, view, periodicity, "operatingIncome") : null;
  const rows = segmentRows(data, view, periodicity);
  const latest = rows.find((row) => row.latest)?.latest;
  const hasIncome = rows.some((row) => row.operatingIncome != null);
  const hasBacklog = rows.some((row) => row.backlog != null);
  const colorOf = new Map((revenue?.series ?? []).map((line, index) => [line.id, line.id === RESIDUAL_ID ? RESIDUAL_COLOR : COLORS[index % COLORS.length]]));
  const extra = rows.filter((row) => !colorOf.has(row.id));
  extra.forEach((row, index) => colorOf.set(row.id, COLORS[(colorOf.size + index) % COLORS.length]));

  return (
    <section className="section segments" aria-label="Segments">
      <div className="segments-bar">
        <div className="seg" role="group" aria-label="Cut">
          {views.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={entry.id === view.id} onClick={() => setViewId(entry.id)}>{entry.title}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Periods">
          {(["quarterly", "annual"] as const).map((entry) => (
            <button key={entry} type="button" aria-pressed={periodicity === entry} onClick={() => setPeriodicity(entry)}>{entry === "quarterly" ? "Quarterly" : "Annual"}</button>
          ))}
        </div>
      </div>

      {backlog.length ? (
        <div className="segments-backlog">
          {backlog.map((card) => (
            <div key={card.id} className="stat">
              <div className="label">Backlog · {card.label}</div>
              <div className="stat-value">{money(card.latest.value, data.currency)}</div>
              <p className="stat-note">
                At {shortDate(card.latest.end)}
                {card.yearAgo ? <> · <span data-dir={dir(card.latest.value / card.yearAgo.value - 1)}>{pct(card.latest.value / card.yearAgo.value - 1, 0)}</span> on a year</> : null}
                {card.coverage != null && card.coverage >= 0.1 ? <> · {card.coverage.toFixed(1)}× its last 12 months&apos; revenue</> : null}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="segments-charts">
        {revenue ? <SegmentPlot title={`Revenue · ${view.title.toLowerCase()}`} chart={revenue} colorOf={colorOf} currency={data.currency} /> : null}
        {income ? <SegmentPlot title="Operating income by segment" chart={income} colorOf={new Map(income.series.map((line, index) => [line.id, line.id === RESIDUAL_ID ? RESIDUAL_COLOR : colorOf.get(line.id.replace(/^operatingIncome:/, "revenue:")) ?? COLORS[index % COLORS.length]]))} currency={data.currency} /> : null}
      </div>

      <div className="sheet segments-table">
        <table>
          <caption className="label">{view.title} · {latest ? `${periodicity === "quarterly" ? "quarter" : "year"} to ${shortDate(latest.end)}` : ""}</caption>
          <thead>
            <tr>
              <th className="key" scope="col">Line</th>
              <th scope="col">{periodicity === "quarterly" ? "Quarter" : "Year"}</th>
              <th scope="col">On a year</th>
              <th scope="col">Share</th>
              {periodicity === "quarterly" ? <><th scope="col">Last 12 months</th><th scope="col">On a year</th></> : null}
              {hasIncome ? <><th scope="col">Operating income</th><th scope="col">Margin</th></> : null}
              {hasBacklog ? <th scope="col">Backlog</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} data-other={!row.stacked || undefined} data-first-other={(!row.stacked && rows[index - 1]?.stacked) || undefined}>
                <th className="key" scope="row">
                  <i className="segments-key" style={{ "--key": colorOf.get(row.id) } as CSSProperties} aria-hidden="true" />
                  {row.label}
                  {row.stale && row.latest ? <span className="t-dim"> · to {periodLabel(row.latest.end, periodicity)}</span> : null}
                </th>
                <td>{money(row.latest?.value, data.currency)}</td>
                <td data-dir={dir(row.yoy)}>{pct(row.yoy)}</td>
                <td>{share(row.share)}</td>
                {periodicity === "quarterly" ? <><td>{money(row.ttm, data.currency)}</td><td data-dir={dir(row.ttmYoy)}>{pct(row.ttmYoy)}</td></> : null}
                {hasIncome ? <><td>{money(row.operatingIncome, data.currency)}</td><td>{row.margin == null ? ABSENT : `${(row.margin * 100).toFixed(1)}%`}</td></> : null}
                {hasBacklog ? <td>{money(row.backlog?.value, data.currency)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* --- The chart ---------------------------------------------------------- */

const PAD = { top: 10, bottom: 22, left: 48, right: 8 };

function niceStep(span: number) {
  const raw = span / 4;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((multiple) => multiple * power).find((step) => step >= raw) ?? raw;
}

function SegmentPlot({ title, chart, colorOf, currency }: { title: string; chart: SegmentChart; colorOf: Map<string, string>; currency: string }) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const height = 240;
  const count = chart.labels.length;
  const stacked = chart.reconciled;

  // Each bar's top and bottom: positives stack up from zero, negatives down.
  const extents = chart.labels.map((_, index) => {
    let up = 0; let down = 0;
    for (const line of chart.series) {
      const value = line.values[index];
      if (value == null) continue;
      if (stacked) { if (value >= 0) up += value; else down += value; } else { up = Math.max(up, value); down = Math.min(down, value); }
    }
    return { up, down };
  });
  const top = Math.max(0, ...extents.map((entry) => entry.up));
  const bottom = Math.min(0, ...extents.map((entry) => entry.down));
  const step = niceStep(top - bottom);
  const max = Math.ceil(top / step) * step || step;
  const min = Math.floor(bottom / step) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(tick);

  const plotRight = Math.max(PAD.left + 10, width - PAD.right);
  const plotBottom = height - PAD.bottom;
  const slot = (plotRight - PAD.left) / Math.max(count, 1);
  const centre = (index: number) => PAD.left + slot * (index + 0.5);
  const y = (value: number) => plotBottom - ((value - min) / (max - min || 1)) * (plotBottom - PAD.top);
  const barWidth = Math.min(slot * 0.7, 46);
  const every = Math.max(1, Math.ceil(46 / Math.max(slot, 1)));

  const pick = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.min(count - 1, Math.max(0, Math.floor(((event.clientX - box.left) / Math.max(box.width, 1)) * count))));
  };

  return (
    <figure className="segments-plot">
      <figcaption>{title}</figcaption>
      <div className="segments-canvas" ref={ref} style={{ height }}>
        {width > 0 ? (
          <svg width={width} height={height} role="img" aria-label={`${title}, ${chart.labels[0]} to ${chart.labels.at(-1)}`}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line className={tick === 0 ? "segments-zero" : "segments-rule"} x1={PAD.left} x2={plotRight} y1={y(tick)} y2={y(tick)} />
                <text className="segments-tick" x={PAD.left - 6} y={y(tick) + 3.5} textAnchor="end">{money(tick, currency).replace(/\.0(?=[KMBT])/, "")}</text>
              </g>
            ))}
            {chart.labels.map((label, index) => ((count - 1 - index) % every === 0 ? (
              <text key={label + index} className="segments-tick" x={centre(index)} y={height - 6} textAnchor="middle">{label}</text>
            ) : null))}
            {hover != null ? <rect className="segments-hover" x={centre(hover) - slot / 2} y={PAD.top} width={slot} height={plotBottom - PAD.top} /> : null}
            {stacked
              ? chart.labels.map((_, index) => {
                let up = 0; let down = 0;
                return (
                  <g key={index} opacity={hover == null || hover === index ? 1 : 0.6}>
                    {chart.series.map((line) => {
                      const value = line.values[index];
                      if (value == null || value === 0) return null;
                      const from = value >= 0 ? up : down;
                      const to = from + value;
                      if (value >= 0) up = to; else down = to;
                      return <rect key={line.id} x={centre(index) - barWidth / 2} y={y(Math.max(from, to))} width={barWidth} height={Math.max(0.5, Math.abs(y(from) - y(to)) - 0.5)} fill={colorOf.get(line.id)} />;
                    })}
                  </g>
                );
              })
              : chart.series.map((line) => {
                let open = false;
                const path = line.values.map((value, index) => {
                  if (value == null) { open = false; return ""; }
                  const command = `${open ? "L" : "M"}${centre(index).toFixed(1)} ${y(value).toFixed(1)}`;
                  open = true;
                  return command;
                }).join("");
                return <path key={line.id} d={path} fill="none" stroke={colorOf.get(line.id)} strokeWidth={2} strokeLinejoin="round" />;
              })}
            <rect className="segments-catch" x={PAD.left} y={PAD.top} width={plotRight - PAD.left} height={plotBottom - PAD.top}
              onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)} />
          </svg>
        ) : null}
        {width > 0 && hover != null ? (
          <div className="segments-tip" style={centre(hover) > width / 2 ? { right: width - centre(hover) + slot / 2 + 6 } : { left: centre(hover) + slot / 2 + 6 }}>
            <b>{chart.labels[hover]}{chart.totals[hover] != null ? ` · ${money(chart.totals[hover], currency)}` : ""}</b>
            {chart.series.filter((line) => line.values[hover] != null).map((line) => (
              <span key={line.id}>
                <i style={{ background: colorOf.get(line.id) }} />{line.label}
                <em>{money(line.values[hover], currency)}{chart.totals[hover] ? ` · ${((line.values[hover]! / chart.totals[hover]!) * 100).toFixed(0)}%` : ""}</em>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <ul className="segments-legend">
        {chart.series.map((line) => (
          <li key={line.id}><i style={{ background: colorOf.get(line.id) }} aria-hidden="true" />{line.label}</li>
        ))}
      </ul>
    </figure>
  );
}
