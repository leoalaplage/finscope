"use client";

import { useEffect, useMemo, useState } from "react";
import { kpiFamily, type KpiPoint, type OperatingKpi, type OperatingKpis as Kpis } from "@/lib/operating-kpis";
import { ABSENT, shortDate } from "./format";
import { ComboChart } from "@/components/term/FundamentalCharts";
import type { AxisUnit, ChartData, Preset, SeriesSpec } from "@/lib/term/fundamental-charts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const quarterLabel = (end: string) => `${MONTHS[Number(end.slice(5, 7)) - 1]} ${end.slice(2, 4)}`;

/** As the company printed it: its decimals, its unit, and its scale where the label does not already say it; then what a count counts ("4,615 units", "1.1B sq ft", "48.2¢"). */
export function kpiValue(kpi: Pick<OperatingKpi, "unit" | "scale" | "name" | "suffix">, point: Pick<KpiPoint, "value" | "decimals"> | null | undefined): string {
  if (!point) return ABSENT;
  const figure = kpiFigure(kpi, point);
  if (!kpi.suffix || kpi.unit === "percent") return figure;
  return kpi.suffix === "¢" || kpi.suffix.startsWith("/") ? `${figure}${kpi.suffix}` : `${figure} ${kpi.suffix}`;
}

function kpiFigure(kpi: Pick<OperatingKpi, "unit" | "scale">, point: Pick<KpiPoint, "value" | "decimals">): string {
  const digits = Math.abs(point.value).toLocaleString("en-US", { minimumFractionDigits: point.decimals, maximumFractionDigits: point.decimals });
  const sign = point.value < 0 ? "−" : "";
  if (kpi.unit === "percent") return `${sign}${digits}%`;
  // A figure printed in thousands or more reads as the size it is: "$181.0M", not "$180,986k".
  const factor = { thousands: 1e3, millions: 1e6, billions: 1e9, trillions: 1e12 }[kpi.scale ?? ""] ?? 1;
  const size = Math.abs(point.value) * factor;
  if (factor > 1 || size >= 1e6) {
    const [unit, suffix] = size >= 1e12 ? [1e12, "T"] : size >= 1e9 ? [1e9, "B"] : size >= 1e6 ? [1e6, "M"] : size >= 1e3 ? [1e3, "K"] : [1, ""];
    return `${sign}${kpi.unit === "currency" ? "$" : ""}${(size / unit).toLocaleString("en-US", { minimumFractionDigits: unit > 1 ? 1 : 0, maximumFractionDigits: unit > 1 ? 1 : 0 })}${suffix}`;
  }
  return `${sign}${kpi.unit === "currency" ? "$" : ""}${digits}`;
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
function kpiChart(kpi: OperatingKpi, color: string): { preset: Preset; data: ChartData } {
  const left: AxisUnit = kpi.unit === "percent" ? "percent" : kpi.unit === "currency" ? "currency" : "shares";
  const factor = kpi.unit === "percent" ? 0.01 : SCALES[kpi.scale ?? ""] ?? 1;
  const bar: SeriesSpec = { id: kpi.id, label: kpi.name, kind: "bar", axis: "left", color, value: () => null };
  // The change on the same quarter a year before, as the fundamental charts' "Revenue & growth" draws it — for a
  // count or an amount; a rate's own change is already what it says.
  // The change from each bar to the one before it, whatever lies between them: the series as printed, bar by bar.
  // For a count or an amount; a rate's own change is already what it says.
  const growth = kpi.unit === "percent" ? null : kpi.points.map((point, index) => {
    const before = index > 0 ? kpi.points[index - 1] : null;
    return before && before.value > 0 && point.value >= 0 ? point.value / before.value - 1 : null;
  });
  const line: SeriesSpec = { id: `${kpi.id}:growth`, label: "Change on the previous bar", kind: "line", axis: "right", color: "var(--c5)", value: () => null };
  const drawsGrowth = growth != null && growth.filter((value) => value != null).length >= 2;
  return {
    preset: { id: kpi.id, title: kpi.name, left, ...(drawsGrowth ? { right: "percent" as AxisUnit } : {}), series: drawsGrowth ? [bar, line] : [bar], shadeNegative: kpi.points.some((point) => point.value < 0) },
    data: {
      labels: kpi.points.map((point) => quarterLabel(point.end)),
      names: kpi.points.map((point) => `Quarter to ${FULL_MONTHS[Number(point.end.slice(5, 7)) - 1]} ${point.end.slice(0, 4)}${point.early ? " · from the release" : ""}`),
      series: [
        { spec: bar, values: kpi.points.map((point) => point.value * factor), colors: kpi.points.map((point) => (point.early ? `color-mix(in srgb, ${color} 45%, transparent)` : null)) },
        ...(drawsGrowth ? [{ spec: line, values: growth! }] : []),
      ],
    },
  };
}

/** The bars' colours, a family each; yellow is the growth line's, as on the fundamental charts. */
// Twelve, so a company's businesses rarely share one: the chart palette, then five more that none of it is near.
const PALETTE = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c6)", "var(--c7)", "var(--c8)", "#fb923c", "#f87171", "#22d3ee", "#94a3b8", "#c4b5fd"];
function KpiChart({ kpi, color }: { kpi: OperatingKpi; color: string }) {
  const { preset, data } = useMemo(() => kpiChart(kpi, color), [kpi, color]);
  return (
    <>
      <ComboChart preset={preset} data={data} currency="USD" height={170} />
      {data.series.length > 1 ? (
        <ul className="t-gf-legend">
          {data.series.map((entry) => (
            <li key={entry.spec.id} data-kind={entry.spec.kind} style={{ "--key": entry.spec.color } as React.CSSProperties}>
              <i aria-hidden="true" />{entry.spec.kind === "bar" ? "Figure" : entry.spec.label}{entry.spec.axis === "right" ? <span className="t-dim"> (right)</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** A row of cards before "Show all". */
const FIRST_ROW = 4;

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
  const [expanded, setExpanded] = useState(false);
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
  if (!current) return frame(<p className="t-empty">Reading ten years of releases and 10-Qs… the first reading of a company takes up to half a minute.</p>);
  if (current.failed || !current.data) {
    return frame(<p className="t-empty">EDGAR is temporarily unavailable. <button type="button" className="segments-retry" onClick={() => setAttempt((count) => count + 1)}>Try again</button></p>);
  }
  const { early } = current.data;
  if (!current.data.kpis.length) return null;
  // A family's figures side by side, in the order the first of each is printed, each family in its colour.
  const families: string[] = [];
  for (const kpi of current.data.kpis) { const family = kpiFamily(kpi.name); if (!families.includes(family)) families.push(family); }
  const kpis = [...current.data.kpis].sort((left, right) => families.indexOf(kpiFamily(left.name)) - families.indexOf(kpiFamily(right.name)));
  const colorOf = (kpi: OperatingKpi) => PALETTE[families.indexOf(kpiFamily(kpi.name)) % PALETTE.length];
  const shown = expanded ? kpis : kpis.slice(0, FIRST_ROW);

  return frame(
    <div className="kpi">

      {early ? (
        <p className="kpi-early">The {quarterLabel(early.end)} quarter is read from the release filed {shortDate(early.filed)}, before its 10-Q.</p>
      ) : null}
      <div className="kpi-grid">
        {shown.map((kpi) => {
          const latest = kpi.points.at(-1)!;
          const moved = change(kpi, latest, yearBefore(kpi.points, latest));
          return (
            <figure key={kpi.id} className="t-gf-card kpi-card" style={{ "--kpi": colorOf(kpi) } as React.CSSProperties}>
              <figcaption title={kpi.name}><h3>{kpi.name}</h3></figcaption>
              <div className="kpi-figure">
                <b>{kpiValue(kpi, latest)}</b>
                <span className="kpi-change" data-dir={moved.tone}>{moved.text}</span>
                <span className="t-dim">{quarterLabel(latest.end)}{latest.early ? " · release" : ""}</span>
              </div>
              <KpiChart kpi={kpi} color={colorOf(kpi)} />
            </figure>
          );
        })}
      </div>
      {kpis.length > FIRST_ROW ? (
        <button type="button" className="t-text-button kpi-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show all ${kpis.length} KPIs`}
        </button>
      ) : null}
      <p className="t-study-note">
        As the company prints them in its earnings releases and its 10-Qs, in their tables or their sentences, which no XBRL tag covers. Each figure is proven against the document a year before: the same row printing it again as the year-ago figure, the change on the year a sentence states, or the same measure under the same heading. A quarter two documents disagree on is left out. A lighter bar is a quarter read from the release, before its 10-Q.
      </p>
    </div>
  );
}
