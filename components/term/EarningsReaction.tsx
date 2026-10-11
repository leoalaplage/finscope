"use client";

import { useEffect, useMemo, useState } from "react";
import { shortDate } from "@/components/io/format";
import type { Candles } from "@/lib/adapters/candles";
import { reactions, summarise } from "@/lib/term/reaction";

/**
 * ERX: how the stock took its last twelve earnings releases — the move across
 * each filing, and where it stood a week and a month on — with the average
 * size of the move, how often it was up, and the extremes. The dates are the
 * company's own 8-Ks (item 2.02); the arithmetic is lib/term/reaction.ts.
 */

const pct = (value: number | null) => (value == null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`);
const dir = (value: number | null) => (value == null ? undefined : value < 0 ? "down" : "up");
const heat = (value: number | null, full: number) => (value == null ? undefined : {
  background: `color-mix(in srgb, ${value >= 0 ? "var(--gain)" : "var(--loss)"} ${Math.round(Math.min(1, Math.abs(value) / full) * 45)}%, transparent)`,
});

export function EarningsReaction({ ticker, cik }: { ticker: string; cik: string }) {
  const [data, setData] = useState<{ key: string; dates: string[] | null; candles: Candles | null } | null>(null);
  const key = `${ticker}:${cik}`;
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/io/${encodeURIComponent(ticker)}/earnings-history?cik=${encodeURIComponent(cik)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() as Promise<{ dates: string[] }> : null)).catch(() => null),
      fetch(`/api/candles/${encodeURIComponent(ticker)}?interval=1d`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() as Promise<Candles> : null)).catch(() => null),
    ]).then(([history, candles]) => {
      if (!controller.signal.aborted) setData({ key, dates: history?.dates ?? null, candles });
    });
    return () => controller.abort();
  }, [key, ticker, cik]);

  const current = data?.key === key ? data : null;
  const rows = useMemo(() => (current?.dates && current.candles ? reactions(current.dates, current.candles) : []), [current]);
  const summary = summarise(rows);

  if (!current) return <p className="t-empty">Reading the releases…</p>;
  // A refused request is not a company without releases, and says so.
  if (!current.dates || !current.candles) return <p className="t-empty">The SEC index or the prices could not be read just now. Try again in a minute.</p>;
  if (!rows.length) return <p className="t-empty">No earnings 8-K in the filer&apos;s recent index to measure.</p>;
  return (
    <div className="t-erx">
      <div className="t-erx-summary">
        <span>Average move <b>±{((summary.averageMove ?? 0) * 100).toFixed(1)}%</b></span>
        <span>Up <b>{summary.up} of {summary.count}</b></span>
        <span>Best <b className="t-up">{pct(summary.largestUp)}</b></span>
        <span>Worst <b className="t-down">{pct(summary.largestDown)}</b></span>
      </div>
      <div className="sheet">
        <table>
          <thead><tr><th className="key">Filed</th><th>Across the release</th><th>+5 sessions</th><th>+20 sessions</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date}>
                <td className="key">{shortDate(row.date)}</td>
                <td data-dir={dir(row.day)} style={heat(row.day, 0.1)}>{pct(row.day)}</td>
                <td data-dir={dir(row.week)}>{pct(row.week)}</td>
                <td data-dir={dir(row.month)}>{pct(row.month)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="t-study-note">From the close before each earnings 8-K to the close of the session after it, which holds the reaction whether the release came before the open or after the close.</p>
    </div>
  );
}
