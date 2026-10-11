"use client";

import { useEffect, useMemo, useState } from "react";
import type { Candles } from "@/lib/adapters/candles";
import { seasonality } from "@/lib/term/seasonality";

/**
 * SEAS: every month's return, year by year, as a heat table, and under it what
 * each calendar month has done — its average, its median and how often it
 * rose. Read from monthly bars over the symbol's whole history
 * (lib/term/seasonality.ts); the most recent fifteen years are listed.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEARS = 15;

const pct = (value: number | null) => (value == null ? "" : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}`);
const heat = (value: number | null, full: number) => (value == null ? undefined : {
  background: `color-mix(in srgb, ${value >= 0 ? "var(--gain)" : "var(--loss)"} ${Math.round(Math.min(1, Math.abs(value) / full) * 55)}%, transparent)`,
});

export function Seasonality({ symbol }: { symbol: string }) {
  const [loaded, setLoaded] = useState<{ symbol: string; candles: Candles | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/candles/${encodeURIComponent(symbol)}?interval=1mo`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<Candles> : null))
      .then((candles) => setLoaded({ symbol, candles }))
      .catch(() => { if (!controller.signal.aborted) setLoaded({ symbol, candles: null }); });
    return () => controller.abort();
  }, [symbol]);

  const candles = loaded?.symbol === symbol ? loaded.candles : undefined;
  const table = useMemo(() => (candles ? seasonality(candles) : null), [candles]);
  if (candles === undefined) return <p className="t-empty">Reading the monthly history…</p>;
  if (!table || table.years.length < 2) return <p className="t-empty">Not enough monthly history.</p>;
  const years = table.years.slice(0, YEARS);

  return (
    <div className="sheet t-seas">
      <table>
        <thead>
          <tr><th className="key">%</th>{MONTHS.map((month) => <th key={month}>{month}</th>)}</tr>
        </thead>
        <tbody>
          {years.map((row) => (
            <tr key={row.year}>
              <th className="key">{row.year}</th>
              {row.months.map((value, month) => (
                <td
                  key={month} style={heat(value, 0.1)}
                  data-running={table.running?.year === row.year && table.running.month === month || undefined}
                  title={table.running?.year === row.year && table.running.month === month ? "This month, so far" : undefined}
                >
                  {pct(value)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="t-seas-stat">
            <th className="key">Average</th>
            {table.stats.map((stat, month) => <td key={month} style={heat(stat.mean, 0.04)}>{pct(stat.mean)}</td>)}
          </tr>
          <tr className="t-seas-stat">
            <th className="key">Median</th>
            {table.stats.map((stat, month) => <td key={month} style={heat(stat.median, 0.04)}>{pct(stat.median)}</td>)}
          </tr>
          <tr className="t-seas-stat">
            <th className="key">% up</th>
            {table.stats.map((stat, month) => (
              <td key={month} style={stat.count ? heat(stat.up / stat.count - 0.5, 0.3) : undefined}>
                {stat.count ? `${Math.round((stat.up / stat.count) * 100)}` : ""}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="t-study-note">Monthly closes over {table.years.length} years of history; averages over every year, the table over the last {years.length}.</p>
    </div>
  );
}
