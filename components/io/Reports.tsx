"use client";

import { useEffect, useMemo, useState } from "react";
import type { Candles } from "@/lib/adapters/candles";
import type { Estimates } from "@/lib/estimates";
import type { IoCompanyView } from "@/lib/io/view";
import { reportRows, type ReportRow } from "@/lib/io/reports";
import { useWidth } from "@/components/term/use-width";
import { ABSENT, money, price as writePrice, shortDate } from "./format";

/**
 * The company's quarterly reports and how the stock took them
 * (lib/io/reports.ts): revenue and EPS as filed with their growth on a year,
 * the analysts' consensus and the surprise against it, and the move from the
 * close before each earnings release to the third session after.
 */

const pct = (value: number | null, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(places)}%`);
const dir = (value: number | null) => (value == null || value === 0 ? undefined : value > 0 ? "up" : "down");
/** Growth off a base close to nothing says nothing: past ±500% it is written "n/m", as terminals do. */
const growthText = (value: number | null) => (value != null && Math.abs(value) > 5 ? "n/m" : pct(value));

interface Inputs { key: string; releases: string[] | null; candles: Candles | null; estimates: Estimates | null }

export function Reports({ view }: { view: IoCompanyView }) {
  const { ticker, cik } = view.company;
  const key = `${ticker}:${cik}`;
  const [inputs, setInputs] = useState<Inputs | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const read = <T,>(url: string) => fetch(url, { signal: controller.signal }).then((response) => (response.ok ? response.json() as Promise<T> : null)).catch(() => null);
    Promise.all([
      cik ? read<{ dates: string[] }>(`/api/io/${encodeURIComponent(ticker)}/earnings-history?cik=${encodeURIComponent(cik)}`) : Promise.resolve(null),
      read<Candles>(`/api/candles/${encodeURIComponent(ticker)}?interval=1d`),
      read<{ estimates: Estimates }>(`/api/estimates/${encodeURIComponent(ticker)}`),
    ]).then(([history, candles, estimates]) => {
      if (!controller.signal.aborted) setInputs({ key, releases: history?.dates ?? null, candles, estimates: estimates?.estimates ?? null });
    });
    return () => controller.abort();
  }, [key, ticker, cik]);

  const current = inputs?.key === key ? inputs : null;
  const rows = useMemo(() => reportRows(
    view.quarterly.map((period) => ({ label: period.label, end: period.end, revenue: period.values.revenue ?? null, eps: period.values.netIncomePerShare ?? null })),
    current?.releases ?? [],
    current?.candles ?? { t: [], c: [] },
    current?.estimates?.surprises ?? [],
  ), [view.quarterly, current]);
  const currency = view.quarterly.at(-1)?.currency ?? view.company.currency;

  if (!current) return <section className="section reports"><p className="stat-note">Reading the releases, the prices and the consensus…</p></section>;
  if (!rows.length) return <section className="section reports"><p className="stat-note">This company files no quarterly figures to lay out.</p></section>;

  const surprised = rows.filter((row) => row.surprise != null);
  const beats = surprised.filter((row) => row.surprise! > 0);
  const moves = rows.filter((row) => row.move3d != null);
  const mean = (list: ReportRow[]) => (list.length ? list.reduce((sum, row) => sum + row.move3d!, 0) / list.length : null);
  const afterBeat = mean(beats.filter((row) => row.move3d != null));
  const afterMiss = mean(surprised.filter((row) => row.surprise! <= 0 && row.move3d != null));

  return (
    <section className="section reports" aria-label="Quarterly reports">
      <div className="grid-ruled stats reports-strip">
        <Figure label="Last quarter · revenue" value={pct(rows[0].revenueYoy)} tone={dir(rows[0].revenueYoy)} note={`${rows[0].label}, on the same quarter a year before`} />
        <Figure label="Beat the consensus" value={surprised.length ? `${beats.length} of ${surprised.length}` : ABSENT} note="Adjusted EPS against the consensus, the quarters Nasdaq lists" />
        <Figure label="Average move · 3 sessions" value={moves.length ? `±${((moves.reduce((sum, row) => sum + Math.abs(row.move3d!), 0) / moves.length) * 100).toFixed(1)}%` : ABSENT} note={`${moves.length} releases`} />
        <Figure label="After a beat · a miss" value={`${pct(afterBeat)} · ${pct(afterMiss)}`} note="Average move from the close before the release" />
      </div>
      <div className="reports-grid">
        <RevenueBars rows={rows} currency={currency} />
        <SurpriseScatter rows={rows} />
      </div>
      <div className="sheet reports-table">
        <table>
          <thead>
            <tr>
              <th className="key" scope="col">Quarter</th>
              <th scope="col">Revenue</th><th scope="col">On a year</th>
              <th scope="col">EPS, filed</th><th scope="col">On a year</th>
              <th scope="col" title="Zacks' adjusted EPS against the consensus before the release">EPS adj. · est.</th><th scope="col">Surprise</th>
              <th scope="col">Released</th><th scope="col" title="From the close before the release to the third session after">3 sessions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.end}>
                <th className="key" scope="row">{row.label}</th>
                <td>{money(row.revenue, currency)}</td>
                <td data-dir={dir(row.revenueYoy)}>{growthText(row.revenueYoy)}</td>
                <td>{row.eps == null ? ABSENT : writePrice(row.eps, currency)}</td>
                <td data-dir={dir(row.epsYoy)}>{growthText(row.epsYoy)}</td>
                <td>{row.adjustedEps == null ? ABSENT : `${writePrice(row.adjustedEps, currency)} · ${row.consensus == null ? ABSENT : writePrice(row.consensus, currency)}`}</td>
                <td data-dir={dir(row.surprise)}>{row.surprise == null ? ABSENT : pct(row.surprise / 100, 2)}</td>
                <td>{row.released ? shortDate(row.released) : ABSENT}</td>
                <td data-dir={dir(row.move3d)}>{pct(row.move3d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="stat-note">
        Revenue and EPS as filed with the SEC; EPS is diluted GAAP. The consensus and the adjusted EPS it is measured against are Zacks&apos;, via Nasdaq,
        for the last four quarters it lists. The release is the earnings 8-K; the move runs from the close before it to the third session after, so it holds the
        reaction whether the release came before the open or after the close.
      </p>
    </section>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="stat-value" data-dir={tone} data-empty={value === ABSENT}>{value}</div>
      {note ? <p className="stat-note">{note}</p> : null}
    </div>
  );
}

/** Revenue by quarter, oldest on the left, with its growth on a year as a line. */
function RevenueBars({ rows, currency }: { rows: ReportRow[]; currency: string }) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const series = [...rows].reverse().filter((row) => row.revenue != null);
  const height = 190, top = 14, bottom = 22, left = 6, right = 44;
  if (series.length < 2) return <div ref={ref} />;
  const max = Math.max(...series.map((row) => row.revenue!)) * 1.08;
  const growths = series.map((row) => row.revenueYoy).filter((value): value is number => value != null);
  const gLow = Math.min(0, ...growths), gHigh = Math.max(0, ...growths);
  const slot = (width - left - right) / series.length;
  const x = (index: number) => left + slot * (index + 0.5);
  const yBar = (value: number) => height - bottom - (value / max) * (height - top - bottom);
  const yGrowth = (value: number) => height - bottom - ((value - gLow) / (gHigh - gLow || 1)) * (height - top - bottom);
  const line = series.map((row, index) => (row.revenueYoy == null ? null : `${x(index).toFixed(1)} ${yGrowth(row.revenueYoy).toFixed(1)}`)).filter(Boolean);
  const active = hover ?? series.length - 1;
  return (
    <figure className="reports-plot" ref={ref}>
      <figcaption>Revenue by quarter · <span className="reports-key-line">growth on a year</span> · {series[active].label} {money(series[active].revenue, currency)} {pct(series[active].revenueYoy)}</figcaption>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label="Revenue by quarter with growth on a year">
          {series.map((row, index) => (
            <rect key={row.end} className="reports-bar" data-dir={dir(row.revenueYoy)} data-active={index === active || undefined}
              x={x(index) - slot * 0.32} width={slot * 0.64} y={yBar(row.revenue!)} height={height - bottom - yBar(row.revenue!)}
              onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} />
          ))}
          {line.length > 1 ? <polyline className="reports-growth" points={line.join(" ")} /> : null}
          {gLow < 0 ? <line className="reports-zero" x1={left} x2={width - right} y1={yGrowth(0)} y2={yGrowth(0)} /> : null}
          <text className="reports-tick" x={width - right + 4} y={yGrowth(gHigh) + 4}>{pct(gHigh, 0)}</text>
          <text className="reports-tick" x={width - right + 4} y={yGrowth(gLow) + 4}>{pct(gLow, 0)}</text>
          {series.map((row, index) => (index % Math.max(1, Math.ceil(series.length / 6)) === (series.length - 1) % Math.max(1, Math.ceil(series.length / 6)) ? (
            <text key={`l${row.end}`} className="reports-tick" x={x(index)} y={height - 6} textAnchor="middle">{row.label.replace(/^(Q\d) FY(\d{2})(\d{2})$/, "$1'$3")}</text>
          ) : null))}
        </svg>
      ) : null}
    </figure>
  );
}

/**
 * Each release's surprise against how the stock moved: beats that fell and
 * misses that rose are where the market wanted something else.
 */
function SurpriseScatter({ rows }: { rows: ReportRow[] }) {
  const { ref, width } = useWidth();
  // The surprise where Nasdaq has the quarter; growth on a year otherwise, so a long history still has a picture.
  const withSurprise = rows.filter((row) => row.surprise != null && row.move3d != null);
  const useSurprise = withSurprise.length >= 3;
  const points = (useSurprise ? withSurprise : rows.filter((row) => row.revenueYoy != null && row.move3d != null))
    .map((row) => ({ row, x: useSurprise ? row.surprise! / 100 : row.revenueYoy!, y: row.move3d! }));
  const height = 190, pad = 26;
  if (points.length < 2) return <div ref={ref} className="reports-plot"><p className="stat-note">Too few releases with a price reaction to plot.</p></div>;
  const reachX = Math.max(...points.map((point) => Math.abs(point.x)), 0.01) * 1.15;
  const reachY = Math.max(...points.map((point) => Math.abs(point.y)), 0.01) * 1.15;
  const px = (value: number) => pad + ((value + reachX) / (2 * reachX)) * (width - 2 * pad);
  const py = (value: number) => pad / 2 + (1 - (value + reachY) / (2 * reachY)) * (height - pad * 1.5);
  return (
    <figure className="reports-plot" ref={ref}>
      <figcaption>{useSurprise ? "EPS surprise" : "Revenue growth on a year"} against the 3-session move</figcaption>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={`${useSurprise ? "Surprise" : "Revenue growth"} against the move after each release`}>
          <rect className="reports-quad-good" x={px(0)} y={py(reachY)} width={px(reachX) - px(0)} height={py(0) - py(reachY)} />
          <rect className="reports-quad-bad" x={px(-reachX)} y={py(0)} width={px(0) - px(-reachX)} height={py(-reachY) - py(0)} />
          <line className="reports-zero" x1={px(-reachX)} x2={px(reachX)} y1={py(0)} y2={py(0)} />
          <line className="reports-zero" x1={px(0)} x2={px(0)} y1={py(reachY)} y2={py(-reachY)} />
          {points.map((point) => (
            <circle key={point.row.end} cx={px(point.x)} cy={py(point.y)} r={5} className="reports-dot" data-dir={dir(point.y)}>
              <title>{`${point.row.label}: ${useSurprise ? "surprise" : "revenue"} ${pct(point.x)}, move ${pct(point.y)}`}</title>
            </circle>
          ))}
          <text className="reports-tick" x={px(reachX) - 2} y={py(0) - 4} textAnchor="end">{pct(reachX, 0)}</text>
          <text className="reports-tick" x={px(0) + 4} y={py(reachY) + 10}>{pct(reachY, 0)}</text>
          <text className="reports-tick" x={px(0) + 4} y={py(-reachY) - 2}>{pct(-reachY, 0)}</text>
        </svg>
      ) : null}
    </figure>
  );
}
