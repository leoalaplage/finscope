"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { EARNINGS_DAY_SHAPE, type ReportTime } from "@/lib/adapters/nasdaq-earnings";
import { Panel } from "./Panel";

/**
 * The earnings calendar (ECAL): a week of announcements, day by day, split
 * into before the open and after the close, the largest companies first.
 *
 * Dates and times are the companies' own, as Nasdaq's calendar lists them
 * (/api/earnings-days). It opens on the S&P 500 and widens to every US company
 * reporting, or narrows to the reader's list; the reader's companies are
 * marked wherever they appear.
 *
 * Beside each: the analysts' consensus earnings per share for the quarter and
 * how many analysts make it, labelled as theirs — the only figure on these
 * screens that is a forecast — and the growth it implies on last year's
 * reported figure. Once a day has passed, the earnings per share reported and
 * the surprise against the consensus, and each company is lit green for a
 * beat or red for a miss.
 */

interface Event {
  ticker: string; name: string; time: ReportTime; marketCap: number | null; quarter: string | null;
  lastYearDate: string | null; lastYearEps: number | null; sp500: boolean;
  consensusEps: number | null; analysts: number | null; reportedEps: number | null; surprise: number | null;
}
interface Day { date: string; rows: Event[]; error?: string }

type Filter = "sp500" | "all" | "watchlist";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
/**
 * The Monday of the week a date falls in — or, at a weekend, of the week
 * ahead, since the week just gone has nothing left to report.
 */
function mondayOf(date: Date): Date {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  const weekday = monday.getUTCDay();
  if (weekday === 6 || weekday === 0) monday.setUTCDate(monday.getUTCDate() + (weekday === 6 ? 2 : 1));
  else monday.setUTCDate(monday.getUTCDate() - (weekday - 1));
  return monday;
}
const label = (iso: string) => {
  const date = new Date(`${iso}T12:00:00Z`);
  return { weekday: DAY_NAMES[date.getUTCDay()], day: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` };
};
const cap = (value: number | null) =>
  value == null ? "" : value >= 1e12 ? `${(value / 1e12).toFixed(2)}T` : value >= 1e9 ? `${(value / 1e9).toFixed(1)}B` : `${(value / 1e6).toFixed(0)}M`;

const noSubscription = () => () => {};

const eps = (value: number | null) => (value == null ? "—" : `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`);
const signedPct = (value: number | null) => (value == null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`);
/** Growth the consensus implies on last year's reported figure; meaningless from a loss, so not given. */
const impliedGrowth = (row: { consensusEps: number | null; lastYearEps: number | null }) =>
  row.consensusEps == null || row.lastYearEps == null || row.lastYearEps <= 0 ? null : (row.consensusEps / row.lastYearEps - 1) * 100;
const resultOf = (row: { surprise: number | null; reportedEps: number | null }) =>
  row.reportedEps == null || row.surprise == null ? undefined : row.surprise > 0 ? "beat" : row.surprise < 0 ? "miss" : "inline";

const TIMES: Array<{ time: ReportTime; name: string; mark: string }> = [
  { time: "before", name: "Before open", mark: "☀" },
  { time: "after", name: "After close", mark: "☾" },
  { time: "unknown", name: "Time not given", mark: "·" },
];

export function EarningsCal() {
  const watchlist = useStoredWatchlist();
  const [week, setWeek] = useState(0);
  const [filter, setFilter] = useState<Filter>("sp500");
  const [answer, setAnswer] = useState<{ start: string; days: Day[] | null } | null>(null);

  // Today by the reader's clock, and nothing on the server, so the
  // prerendered page and the reader's day never disagree.
  const today = useSyncExternalStore(noSubscription, () => isoDay(new Date()), () => null);
  const start = useMemo(() => {
    if (!today) return null;
    const monday = mondayOf(new Date(`${today}T12:00:00Z`));
    monday.setUTCDate(monday.getUTCDate() + week * 7);
    return isoDay(monday);
  }, [today, week]);

  useEffect(() => {
    if (!start) return;
    const controller = new AbortController();
    fetch(`/api/earnings-days?from=${start}&days=5&v=${EARNINGS_DAY_SHAPE}`, { signal: controller.signal })
      .then((response) => response.json() as Promise<{ days?: Day[] }>)
      .then((body) => setAnswer({ start, days: body.days ?? [] }))
      .catch(() => { if (!controller.signal.aborted) setAnswer({ start, days: null }); });
    return () => controller.abort();
  }, [start]);

  const days = answer?.start === start ? answer.days : undefined;
  const shown = (rows: Event[]) => rows
    .filter((row) => filter === "all" || (filter === "sp500" ? row.sp500 : watchlist.includes(row.ticker)))
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const weekRows = (days ?? []).flatMap((day) => shown(day.rows).map((row) => ({ ...row, date: day.date })));
  const followed = new Set(watchlist);

  return (
    <div className="t-grid t-ecal">
      <Panel code="ECAL" title="Earnings calendar" area="week" actions={
        <>
          <button type="button" className="t-chip" onClick={() => setWeek(week - 1)} aria-label="Previous week">‹</button>
          <button type="button" className="t-chip" aria-pressed={week === 0} onClick={() => setWeek(0)}>This week</button>
          <button type="button" className="t-chip" onClick={() => setWeek(week + 1)} aria-label="Next week">›</button>
        </>
      }>
        <div className="t-ecal-bar">
          <div className="seg" role="group" aria-label="Companies">
            <button type="button" aria-pressed={filter === "sp500"} onClick={() => setFilter("sp500")}>S&amp;P 500</button>
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All US</button>
            <button type="button" aria-pressed={filter === "watchlist"} onClick={() => setFilter("watchlist")}>Watchlist</button>
          </div>
          <span className="t-dim">
            {days ? `${weekRows.length} reporting` : "Loading…"} · ☀ before the open · ☾ after the close · est = analysts&apos; consensus EPS · green beat, red miss
          </span>
        </div>
        {days === null ? <p className="t-empty">The calendar is temporarily unavailable.</p> : null}
        <div className="t-ecal-week">
          {(days ?? []).map((day) => {
            const rows = shown(day.rows);
            const name = label(day.date);
            return (
              <section key={day.date} className="t-ecal-day" data-today={day.date === today || undefined} data-past={(today && day.date < today) || undefined}>
                <header><b>{name.weekday}</b> {name.day}<span className="t-dim">{rows.length || ""}</span></header>
                {TIMES.map((slot) => {
                  const inSlot = rows.filter((row) => row.time === slot.time);
                  if (!inSlot.length) return null;
                  return (
                    <div key={slot.time} className="t-ecal-slot">
                      <h3><span aria-hidden="true">{slot.mark}</span> {slot.name}</h3>
                      {inSlot.map((row) => (
                        <a
                          key={row.ticker} href={`/t/s/${encodeURIComponent(row.ticker)}#ee`} className="t-ecal-co"
                          data-followed={followed.has(row.ticker) || undefined} data-member={row.sp500 || undefined}
                          data-result={resultOf(row)}
                          title={`${row.name}${row.consensusEps != null ? ` · consensus EPS ${eps(row.consensusEps)}` : ""}${row.reportedEps != null ? ` · reported ${eps(row.reportedEps)} (${signedPct(row.surprise)})` : ""}`}
                        >
                          <b>{row.ticker}</b>
                          <span>{row.reportedEps != null ? signedPct(row.surprise) : row.consensusEps != null ? `est ${eps(row.consensusEps)}` : cap(row.marketCap)}</span>
                        </a>
                      ))}
                    </div>
                  );
                })}
                {!rows.length ? <p className="t-dim t-ecal-none">{day.error ? "Unavailable" : "—"}</p> : null}
              </section>
            );
          })}
        </div>
      </Panel>

      <Panel code="ECAL" id="ecal-list" title="This week · detail" area="list">
        {weekRows.length ? (
          <div className="sheet t-ecal-list">
            <table>
              <thead>
                <tr>
                  <th className="key">Date</th><th className="key">Time</th><th className="key">Ticker</th><th className="key">Company</th>
                  <th>Market value</th><th>Quarter</th>
                  <th title="Analysts' consensus earnings per share, via Nasdaq">Consensus EPS</th><th>Analysts</th>
                  <th title="Growth the consensus implies on last year's reported EPS">vs last year</th>
                  <th>Reported EPS</th><th>Surprise</th><th>Last year EPS</th><th />
                </tr>
              </thead>
              <tbody>
                {weekRows.map((row) => (
                  <tr key={`${row.date}-${row.ticker}`} data-followed={followed.has(row.ticker) || undefined}>
                    <td className="key">{label(row.date).weekday} {label(row.date).day}</td>
                    <td className="key t-dim">{TIMES.find((slot) => slot.time === row.time)?.mark} {row.time === "before" ? "Open" : row.time === "after" ? "Close" : "—"}</td>
                    <td className="key"><a href={`/t/s/${encodeURIComponent(row.ticker)}#ee`}>{row.ticker}</a></td>
                    <td className="key t-dim">{row.name}</td>
                    <td>{cap(row.marketCap)}</td>
                    <td className="t-dim">{row.quarter ?? "—"}</td>
                    <td>{eps(row.consensusEps)}</td>
                    <td className="t-dim">{row.analysts ?? "—"}</td>
                    <td data-dir={impliedGrowth(row) == null ? undefined : impliedGrowth(row)! < 0 ? "down" : "up"}>{signedPct(impliedGrowth(row))}</td>
                    <td>{eps(row.reportedEps)}</td>
                    <td data-dir={row.surprise == null ? undefined : row.surprise < 0 ? "down" : "up"}>{signedPct(row.surprise)}</td>
                    <td className="t-dim" title={row.lastYearDate ? `Reported ${row.lastYearDate}` : undefined}>{eps(row.lastYearEps)}</td>
                    <td className="t-row-links"><a href={`/t/chart?s=${encodeURIComponent(row.ticker)}`}>GP</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : days ? <p className="t-empty">No company in this selection reports this week.</p> : null}
        <p className="t-study-note">Consensus EPS and the number of analysts are the analysts&apos; forecasts as Nasdaq publishes them, not figures the companies filed. Reported EPS and the surprise follow once the day has passed.</p>
      </Panel>
    </div>
  );
}

/**
 * The next three trading days of the calendar, in the launchpad's corner
 * (components/term/Launchpad.tsx): the S&P 500 members reporting — or the
 * watchlist's — largest first, before the open or after the close, each
 * opening its company. The whole calendar is ECAL.
 */
export function MiniEcal() {
  const watchlist = useStoredWatchlist();
  const [filter, setFilter] = useState<"sp500" | "watchlist">("sp500");
  const today = useSyncExternalStore(noSubscription, () => isoDay(new Date()), () => null);
  const [answer, setAnswer] = useState<{ from: string; days: Day[] | null } | null>(null);
  useEffect(() => {
    if (!today) return;
    const controller = new AbortController();
    fetch(`/api/earnings-days?from=${today}&days=3&v=${EARNINGS_DAY_SHAPE}`, { signal: controller.signal })
      .then((response) => response.json() as Promise<{ days?: Day[] }>)
      .then((body) => setAnswer({ from: today, days: body.days ?? [] }))
      .catch(() => { if (!controller.signal.aborted) setAnswer({ from: today, days: null }); });
    return () => controller.abort();
  }, [today]);
  const days = answer?.from === today ? answer.days : undefined;
  const followed = new Set(watchlist);
  const shown = (rows: Event[]) => rows
    .filter((row) => (filter === "sp500" ? row.sp500 : followed.has(row.ticker)))
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  return (
    <div className="t-miniecal">
      <div className="t-miniecal-bar">
        <div className="seg" role="group" aria-label="Companies">
          <button type="button" aria-pressed={filter === "sp500"} onClick={() => setFilter("sp500")}>S&amp;P 500</button>
          <button type="button" aria-pressed={filter === "watchlist"} onClick={() => setFilter("watchlist")}>Watchlist</button>
        </div>
        <a className="t-chip" href="/t/ecal">ECAL ›</a>
      </div>
      {days === null ? <p className="t-empty">The calendar is temporarily unavailable.</p> : null}
      {days === undefined ? <p className="t-empty">Loading…</p> : null}
      <div className="t-miniecal-days">
        {(days ?? []).slice(0, 3).map((day) => {
          const rows = shown(day.rows);
          const name = label(day.date);
          return (
            <section key={day.date} className="t-miniecal-day" data-today={day.date === today || undefined}>
              <header><b>{name.weekday}</b> {name.day}<span className="t-dim">{rows.length || ""}</span></header>
              {rows.length ? rows.slice(0, 14).map((row) => {
                const slot = TIMES.find((each) => each.time === row.time)!;
                return (
                  <a key={row.ticker} href={`/t/s/${encodeURIComponent(row.ticker)}#ee`} className="t-miniecal-co" data-result={resultOf(row)}
                    data-followed={followed.has(row.ticker) || undefined}
                    title={`${row.name} · ${slot.name}${row.consensusEps != null ? ` · consensus EPS ${eps(row.consensusEps)}` : ""}`}>
                    <span aria-hidden="true">{slot.mark}</span><b>{row.ticker}</b>
                    <span>{row.reportedEps != null ? signedPct(row.surprise) : row.consensusEps != null ? eps(row.consensusEps) : cap(row.marketCap)}</span>
                  </a>
                );
              }) : <p className="t-dim t-ecal-none">{day.error ? "Unavailable" : "—"}</p>}
              {rows.length > 14 ? <a className="t-dim t-miniecal-more" href="/t/ecal">+{rows.length - 14} more</a> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
