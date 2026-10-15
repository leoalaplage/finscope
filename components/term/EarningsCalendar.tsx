"use client";

import { useEffect, useState } from "react";
import { shortDate } from "@/components/io/format";
import { EARNINGS_DAY_SHAPE } from "@/lib/adapters/nasdaq-earnings";

/**
 * The reader's list by when each company should next report.
 *
 * The window is the filer's own rhythm (app/api/earnings-calendar), so it is
 * labelled as expected, never as a date: a company sets its date itself and
 * this site only knows it once the 8-K is filed.
 */

interface Row {
  ticker: string;
  name: string | null;
  last: string | null;
  expected: { date: string; from: string; to: string; gapDays: number } | null;
}

const DAY = 86_400_000;
const daysUntil = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.now()) / DAY);

type State = "due" | "upcoming" | "passed" | "unknown";

/**
 * Inside its window, ahead of it, or past it with no release filed — which
 * usually means the filer announced results some other way this time, so it
 * is said plainly and not counted down as "overdue".
 */
function stateOf(row: Row): State {
  if (!row.expected) return "unknown";
  if (daysUntil(row.expected.to) < 0) return "passed";
  return daysUntil(row.expected.from) <= 0 ? "due" : "upcoming";
}
const ORDER: Record<State, number> = { due: 0, upcoming: 1, passed: 2, unknown: 3 };

/** Announced dates for the next three weeks, from the earnings calendar (ECAL). */
function useAnnounced() {
  const [announced, setAnnounced] = useState<Map<string, { date: string; time: string }>>(new Map());
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/earnings-days?days=15&v=${EARNINGS_DAY_SHAPE}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ days?: Array<{ date: string; rows: Array<{ ticker: string; time: string }> }> }> : null))
      .then((body) => {
        const found = new Map<string, { date: string; time: string }>();
        for (const day of body?.days ?? []) for (const row of day.rows) if (!found.has(row.ticker)) found.set(row.ticker, { date: day.date, time: row.time });
        setAnnounced(found);
      })
      .catch(() => { /* The expected windows stand on their own. */ });
    return () => controller.abort();
  }, []);
  return announced;
}

export function EarningsCalendar({ tickers }: { tickers: string[] }) {
  const key = tickers.join(",");
  const [answer, setAnswer] = useState<{ key: string; rows: Row[] | null } | null>(null);
  const announced = useAnnounced();

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    fetch(`/api/earnings-calendar?tickers=${encodeURIComponent(key)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ rows: Row[] }> : null))
      .then((body) => setAnswer({ key, rows: body?.rows ?? null }))
      .catch(() => { if (!controller.signal.aborted) setAnswer({ key, rows: null }); });
    return () => controller.abort();
  }, [key]);

  const rows = answer?.key === key ? answer.rows : undefined;
  if (rows === undefined) return <p className="t-empty">Reading the SEC index…</p>;
  if (rows === null) return <p className="t-empty">The SEC index is temporarily unavailable.</p>;

  return (
    <div className="sheet t-calendar">
      <table>
        <thead>
          <tr>
            <th className="key">Ticker</th>
            <th>Expected</th>
            <th>In</th>
            <th>Last release</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].sort((a, b) => {
            // Announced dates first, soonest first; then the expected windows.
            const left = announced.get(a.ticker)?.date;
            const right = announced.get(b.ticker)?.date;
            if (left || right) return left && right ? left.localeCompare(right) : left ? -1 : 1;
            return ORDER[stateOf(a)] - ORDER[stateOf(b)];
          }).map((row) => {
            const confirmed = announced.get(row.ticker);
            const days = confirmed ? daysUntil(confirmed.date) : row.expected ? daysUntil(row.expected.date) : null;
            // An announced date within a week is lit like a window that is due.
            const state = confirmed ? (days != null && days <= 7 ? "due" : "upcoming") : stateOf(row);
            return (
              <tr key={row.ticker} data-state={state}>
                <td className="key"><a href={`/t/s/${encodeURIComponent(row.ticker)}#ee`}>{row.ticker}</a></td>
                <td title={row.expected ? `${shortDate(row.expected.from)} – ${shortDate(row.expected.to)}, every ~${row.expected.gapDays} days` : undefined}>
                  {confirmed
                    ? <span className="t-amber">{confirmed.time === "before" ? "☀ " : confirmed.time === "after" ? "☾ " : ""}{shortDate(confirmed.date)}</span>
                    : row.expected && state !== "passed" ? `~${shortDate(row.expected.date)}` : "—"}
                </td>
                <td
                  className={state === "due" ? "t-amber" : "t-dim"}
                  title={state === "passed" ? "No earnings 8-K filed since the expected window; the company may have announced another way." : undefined}
                >
                  {confirmed ? (days != null && days <= 0 ? "today" : `${days}d`) : state === "due" ? "due" : state === "upcoming" ? `${days}d` : state === "passed" ? "no 8-K" : ""}
                </td>
                <td className="t-dim">{row.last ? shortDate(row.last) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
