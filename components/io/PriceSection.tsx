"use client";

import { useEffect, useMemo, useState } from "react";
import { PriceLine, type PricePoint } from "./Plot";
import { ABSENT, delta, price as writePrice, shortDate } from "./format";

/**
 * The price, over five windows and one stroke.
 *
 * Each window asks for the granularity it can actually show: a month of
 * sessions is drawn daily, twenty years is drawn monthly. Asking for daily bars
 * across twenty years would be twenty times the payload to draw the same line
 * at the same width — and every one of these windows is a cache key the market
 * endpoint already keeps warm.
 */

type Range = "1M" | "6M" | "1Y" | "5Y" | "MAX";

const RANGES: Array<{ id: Range; frequency: "daily" | "weekly" | "monthly"; days: number | null }> = [
  { id: "1M", frequency: "daily", days: 35 },
  { id: "6M", frequency: "daily", days: 190 },
  { id: "1Y", frequency: "daily", days: 370 },
  { id: "5Y", frequency: "weekly", days: 1830 },
  { id: "MAX", frequency: "monthly", days: null },
];

interface Bar { date: string; close: number }

function windowOf(range: Range) {
  const found = RANGES.find((entry) => entry.id === range) ?? RANGES[2];
  const end = new Date();
  const start = found.days == null ? new Date("1985-01-01") : new Date(end.getTime() - found.days * 86_400_000);
  return { frequency: found.frequency, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Sessions, and which company-and-window they are the sessions of. */
interface Answer { key: string; bars: Bar[] | null }

export function PriceSection({ ticker, currency }: { ticker: string; currency: string }) {
  const [range, setRange] = useState<Range>("1Y");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const key = `${ticker}|${range}`;
  // Sessions belonging to a window the reader has already left are not this
  // window's sessions, so the chart draws its waiting state rather than the
  // previous shape under the new label.
  const current = answer?.key === key ? answer : null;
  const failed = current != null && current.bars == null;

  useEffect(() => {
    const controller = new AbortController();
    const { frequency, start, end } = windowOf(range);
    (async () => {
      try {
        const response = await fetch(`/api/market/${encodeURIComponent(ticker)}?frequency=${frequency}&start=${start}&end=${end}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { bars: Array<{ date: string; close: number | null }> };
        setAnswer({ key: `${ticker}|${range}`, bars: body.bars.filter((bar): bar is Bar => bar.close != null && Number.isFinite(bar.close)) });
      } catch {
        if (!controller.signal.aborted) setAnswer({ key: `${ticker}|${range}`, bars: null });
      }
    })();
    return () => controller.abort();
  }, [ticker, range]);

  const points = useMemo<PricePoint[]>(() => (current?.bars ?? []).map((bar) => ({ date: bar.date, value: bar.close })), [current]);

  const first = points[0]?.value ?? null;
  const last = points[points.length - 1]?.value ?? null;
  const move = first != null && last != null && first > 0 ? last / first - 1 : null;
  const active = hover == null ? null : points[hover] ?? null;

  const bounds = useMemo(() => {
    if (!points.length) return null;
    const values = points.map((point) => point.value);
    return { high: Math.max(...values), low: Math.min(...values) };
  }, [points]);

  return (
    <section className="section" style={{ borderTop: 0 }}>
      <div className="section-head">
        <div className="readout">
          {active ? (
            <>
              <span className="v">{writePrice(active.value, currency)}</span>
              <span className="d">{shortDate(active.date)}</span>
            </>
          ) : (
            <>
              <span className="v">{move == null ? ABSENT : delta(move)}</span>
              <span className="d">{range}</span>
            </>
          )}
        </div>
        <div className="seg">
          {RANGES.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={range === entry.id} onClick={() => setRange(entry.id)}>
              {entry.id}
            </button>
          ))}
        </div>
      </div>

      {points.length > 1 ? (
        <div className="price-frame">
          <PriceLine points={points} onHover={setHover} />
          {bounds ? (
            <div className="plot-axis">
              <span className="plot-tag" style={{ right: 0, top: 0 }}>{writePrice(bounds.high, currency)}</span>
              <span className="plot-tag" style={{ right: 0, bottom: 0 }}>{writePrice(bounds.low, currency)}</span>
              <span className="plot-tag plot-tag-under" style={{ left: 0 }}>{shortDate(points[0].date)}</span>
              <span className="plot-tag plot-tag-under" style={{ right: 0 }}>{shortDate(points[points.length - 1].date)}</span>
            </div>
          ) : null}
        </div>
      ) : failed ? (
        <p className="price-chart plot-empty num faint">No session data for this symbol.</p>
      ) : (
        <div className="price-chart skeleton" />
      )}
    </section>
  );
}
