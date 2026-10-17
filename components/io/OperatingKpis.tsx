"use client";

import { useEffect, useMemo, useState } from "react";
import type { KpiPoint, OperatingKpi, OperatingKpis as Kpis } from "@/lib/operating-kpis";
import { ABSENT, shortDate } from "./format";
import { ComboChart } from "@/components/term/FundamentalCharts";
import type { AxisUnit, ChartData, Preset, SeriesSpec } from "@/lib/term/fundamental-charts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const quarterLabel = (end: string) => `${MONTHS[Number(end.slice(5, 7)) - 1]} ${end.slice(2, 4)}`;
const SCALE: Record<string, string> = { thousands: "k", millions: "m", billions: "bn" };

/** As the company printed it: its decimals, its unit, and its scale where the label does not already say it. */
export function kpiValue(kpi: Pick<OperatingKpi, "unit" | "scale" | "name">, point: Pick<KpiPoint, "value" | "decimals"> | null | undefined): string {
  if (!point) return ABSENT;
  const digits = Math.abs(point.value).toLocaleString("en-US", { minimumFractionDigits: point.decimals, maximumFractionDigits: point.decimals });
  const sign = point.value < 0 ? "−" : "";
  if (kpi.unit === "percent") return `${sign}${digits}%`;
  const scaled = kpi.scale && !new RegExp(kpi.scale, "i").test(kpi.name) ? SCALE[kpi.scale] ?? "" : "";
  return `${sign}${kpi.unit === "currency" ? "$" : ""}${digits}${scaled}`;
}

/** The same quarter a year before, where the series has it. */
function yearBefore(points: KpiPoint[], latest: KpiPoint): KpiPoint | null {
  const target = Date.parse(latest.end) - 365 * 86_400_000;
  return points.find((point) => Math.abs(Date.parse(point.end) - target) <= 20 * 86_400_000) ?? null;
}

function change(kpi: OperatingKpi, latest: KpiPoint, before: KpiPoint | null): { text: string; tone?: "up" | "down" } {
  if (!before) return { text: "" };
  if (kpi.unit === "percent") {
    const points = latest.value - before.value;
    return { text: `${points >= 0 ? "+" : "−"}${Math.abs(points).toFixed(1)} pts on a year`, tone: points > 0 ? "up" : points < 0 ? "down" : undefined };
  }
  if (before.value <= 0 || latest.value < 0) return { text: "" };
  const growth = latest.value / before.value - 1;
  return { text: `${growth >= 0 ? "+" : "−"}${Math.abs(growth * 100).toFixed(1)}% on a year`, tone: growth > 0 ? "up" : growth < 0 ? "down" : undefined };
}

const SCALES: Record<string, number> = { thousands: 1e3, millions: 1e6, billions: 1e9, trillions: 1e12 };
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A KPI as the fundamental charts draw a measure (components/term/FundamentalCharts.tsx): bars a quarter on a real
 * axis, its figures in absolute units so the axis reads $540B or 1.6M, and the quarter under the pointer named. A
 * quarter read from the release before its 10-Q is drawn in the lighter shade.
 */
function kpiChart(kpi: OperatingKpi): { preset: Preset; data: ChartData } {
  const left: AxisUnit = kpi.unit === "percent" ? "percent" : kpi.unit === "currency" ? "currency" : "shares";
  const factor = kpi.unit === "percent" ? 0.01 : SCALES[kpi.scale ?? ""] ?? 1;
  const spec: SeriesSpec = { id: kpi.id, label: kpi.name, kind: "bar", axis: "left", color: "var(--c1)", value: () => null };
  return {
    preset: { id: kpi.id, title: kpi.name, left, series: [spec], shadeNegative: kpi.points.some((point) => point.value < 0) },
    data: {
      labels: kpi.points.map((point) => quarterLabel(point.end)),
      names: kpi.points.map((point) => `Quarter to ${FULL_MONTHS[Number(point.end.slice(5, 7)) - 1]} ${point.end.slice(0, 4)}${point.early ? " · from the release" : ""}`),
      series: [{ spec, values: kpi.points.map((point) => point.value * factor), colors: kpi.points.map((point) => (point.early ? "color-mix(in srgb, var(--c1) 45%, transparent)" : null)) }],
    },
  };
}

function KpiChart({ kpi }: { kpi: OperatingKpi }) {
  const { preset, data } = useMemo(() => kpiChart(kpi), [kpi]);
  return <ComboChart preset={preset} data={data} currency="USD" height={170} />;
}

/**
 * KPI: what the company runs itself by, quarter by quarter, as it prints it
 * in its releases and its 10-Qs — each figure proven against the same row a
 * year later (lib/operating-kpis.ts).
 */
export function OperatingKpis({ ticker, cik, frame = (body) => body }: {
  ticker: string; cik: string;
  /** The panel around it: left out altogether when the company's documents prove no figure. */
  frame?: (body: React.ReactNode) => React.ReactNode;
}) {
  const [answer, setAnswer] = useState<{ key: string; data: Kpis | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${ticker}:${cik}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/io/${encodeURIComponent(ticker)}/kpis?cik=${encodeURIComponent(cik)}`, { signal: controller.signal, cache: attempt ? "reload" : "default" })
      .then(async (response) => ({ data: response.ok ? await response.json() as Kpis : null, failed: !response.ok }))
      .then(({ data, failed }) => { if (!controller.signal.aborted) setAnswer({ key, data, failed }); })
      .catch(() => { if (!controller.signal.aborted) setAnswer({ key, data: null, failed: true }); });
    return () => controller.abort();
  }, [key, ticker, cik, attempt]);

  const current = answer?.key === key ? answer : null;
  if (!current) return frame(<p className="t-empty">Reading the releases and the 10-Qs of the last two years… the first reading takes a few seconds.</p>);
  if (current.failed || !current.data) {
    return frame(<p className="t-empty">EDGAR is temporarily unavailable. <button type="button" className="segments-retry" onClick={() => setAttempt((count) => count + 1)}>Try again</button></p>);
  }
  const { kpis, early } = current.data;
  if (!kpis.length) return null;

  return frame(
    <div className="kpi">
      {early ? (
        <p className="kpi-early">The {quarterLabel(early.end)} quarter is read from the release filed {shortDate(early.filed)}, before its 10-Q. <a href={early.url} target="_blank" rel="noreferrer">The release ↗</a></p>
      ) : null}
      <div className="kpi-grid">
        {kpis.map((kpi) => {
          const latest = kpi.points.at(-1)!;
          const moved = change(kpi, latest, yearBefore(kpi.points, latest));
          return (
            <figure key={kpi.id} className="t-gf-card kpi-card">
              <figcaption title={kpi.name}><h3>{kpi.name}</h3></figcaption>
              <div className="kpi-figure">
                <b>{kpiValue(kpi, latest)}</b>
                <span className="kpi-change" data-dir={moved.tone}>{moved.text}</span>
                <span className="t-dim">{quarterLabel(latest.end)}{latest.early ? " · release" : ""}</span>
              </div>
              <KpiChart kpi={kpi} />
              <a className="kpi-source" href={latest.url} target="_blank" rel="noreferrer">{latest.source === "release" ? "Release" : "10-Q"} {shortDate(latest.filed)} ↗</a>
            </figure>
          );
        })}
      </div>
      <p className="t-study-note">
        As the company prints them in its earnings releases and its 10-Qs, in their tables or their sentences, which no XBRL tag covers. Each figure is proven against the document a year before: the same row printing it again as the year-ago figure, the change on the year a sentence states, or the same measure under the same heading. A quarter two documents disagree on is left out. A lighter bar is a quarter read from the release, before its 10-Q.
      </p>
    </div>
  );
}
