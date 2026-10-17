"use client";

import { useEffect, useState } from "react";
import type { KpiPoint, OperatingKpi, OperatingKpis as Kpis } from "@/lib/operating-kpis";
import { ABSENT, shortDate } from "./format";

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

/** Bars, one a quarter, the newest the darkest; a quarter read from the release before its 10-Q is outlined. */
function Bars({ kpi }: { kpi: OperatingKpi }) {
  const values = kpi.points.map((point) => point.value);
  const top = Math.max(...values, 0);
  const bottom = Math.min(...values, 0);
  // A rate or a level that moves within a narrow band is drawn from near its low, so the movement shows.
  const floor = bottom >= 0 && top > 0 && Math.min(...values) / top > 0.6 ? Math.min(...values) * 0.9 : bottom;
  const span = top - floor || 1;
  const width = 100 / kpi.points.length;
  return (
    <svg className="kpi-bars" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${kpi.name}, ${kpi.points.length} quarters`}>
      {kpi.points.map((point, index) => {
        const height = Math.max(1, ((point.value - floor) / span) * 38);
        return (
          <rect key={point.end} x={index * width + width * 0.12} width={width * 0.76} y={40 - height} height={height}
            data-latest={index === kpi.points.length - 1 || undefined} data-early={point.early || undefined}>
            <title>{`${quarterLabel(point.end)} · ${kpiValue(kpi, point)}${point.early ? " · from the release, before the 10-Q" : ""}`}</title>
          </rect>
        );
      })}
    </svg>
  );
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
            <figure key={kpi.id} className="kpi-card">
              <figcaption title={kpi.name}>{kpi.name}</figcaption>
              <div className="kpi-figure">
                <b>{kpiValue(kpi, latest)}</b>
                <span className="t-dim">{quarterLabel(latest.end)}{latest.early ? " · release" : ""}</span>
              </div>
              <span className="kpi-change" data-dir={moved.tone}>{moved.text || " "}</span>
              <Bars kpi={kpi} />
              <a className="kpi-source" href={latest.url} target="_blank" rel="noreferrer">{latest.source === "release" ? "Release" : "10-Q"} {shortDate(latest.filed)} ↗</a>
            </figure>
          );
        })}
      </div>
      <p className="t-study-note">
        As the company prints them in its earnings releases and its 10-Qs, which no XBRL tag covers. A figure is kept only where the same row, a year later, prints it again as the year-ago figure, digit for digit; a quarter two documents disagree on is left out. The outlined bar is a quarter read from the release, before its 10-Q.
      </p>
    </div>
  );
}
