"use client";

import { useEffect, useState } from "react";
import type { Candles } from "@/lib/adapters/candles";
import { reactions } from "@/lib/term/reaction";
import { EARNINGS_DAY_SHAPE } from "@/lib/adapters/nasdaq-earnings";

/**
 * What a chart's earnings marker says on hover: the quarter reported, the
 * EPS against the consensus and the surprise (the earnings calendar's record
 * of that day, lib/adapters/nasdaq-earnings.ts), and how the stock moved —
 * across the release, five and twenty sessions on — measured on daily closes
 * exactly as the Earnings reaction panel measures it (lib/term/reaction.ts).
 * Read when the reader points at the marker, and kept for the visit.
 */

interface DayRow { ticker: string; quarter?: string | null; consensusEps?: number | null; reportedEps?: number | null; surprise?: number | null; time?: string | null }
export interface ReleaseFacts { quarter: string | null; reported: number | null; consensus: number | null; surprise: number | null; time: string | null }

const known = new Map<string, Promise<ReleaseFacts | null>>();

/** The weekday before a date, so a release filed the morning after it was announced is still found. */
const dayBefore = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`);
  do day.setUTCDate(day.getUTCDate() - 1); while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
  return day.toISOString().slice(0, 10);
};

function readRelease(ticker: string, date: string): Promise<ReleaseFacts | null> {
  const key = `${ticker}:${date}`;
  let held = known.get(key);
  if (!held) {
    held = fetch(`/api/earnings-days?from=${dayBefore(date)}&days=3&v=${EARNINGS_DAY_SHAPE}`)
      .then((response) => (response.ok ? response.json() as Promise<{ days?: Array<{ date: string; rows: DayRow[] }> }> : null))
      .then((body) => {
        // The day of the filing first, then the day before it, then the day after.
        const days = body?.days ?? [];
        const order = [date, dayBefore(date), ...days.map((day) => day.date)];
        for (const wanted of order) {
          const row = days.find((day) => day.date === wanted)?.rows.find((entry) => entry.ticker.toUpperCase() === ticker.toUpperCase());
          if (row) return { quarter: row.quarter ?? null, reported: row.reportedEps ?? null, consensus: row.consensusEps ?? null, surprise: row.surprise ?? null, time: row.time ?? null };
        }
        return null;
      })
      .catch(() => null);
    known.set(key, held);
  }
  return held;
}

export function useReleaseFacts(ticker: string | null, date: string | null): { facts: ReleaseFacts | null; loading: boolean } {
  const [answer, setAnswer] = useState<{ key: string; facts: ReleaseFacts | null } | null>(null);
  const key = ticker && date ? `${ticker}:${date}` : null;
  useEffect(() => {
    if (!ticker || !date) return;
    let live = true;
    void readRelease(ticker, date).then((facts) => { if (live) setAnswer({ key: `${ticker}:${date}`, facts }); });
    return () => { live = false; };
  }, [ticker, date]);
  return { facts: answer?.key === key ? answer.facts : null, loading: key != null && answer?.key !== key };
}

const percent = (value: number | null | undefined, places = 1) => (value == null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(places)}%`);
const tone = (value: number | null | undefined) => (value == null ? undefined : value >= 0 ? "good" : "bad");
const MONTHS: Record<string, string> = { Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June", Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December" };

/** The card itself. `daily` are daily candles, for the moves; the chart's own when it is daily. */
export function ReleaseCard({ ticker, date, daily }: { ticker: string; date: string; daily: Candles | null }) {
  const { facts, loading } = useReleaseFacts(ticker, date);
  const move = daily ? reactions([date], daily, 1)[0] ?? null : null;
  const quarter = facts?.quarter && /^[A-Z][a-z]{2}\/\d{4}$/.test(facts.quarter)
    ? `Quarter to ${MONTHS[facts.quarter.slice(0, 3)] ?? facts.quarter.slice(0, 3)} ${facts.quarter.slice(4)}`
    : "Earnings release";
  return (
    <>
      <b className="release-title">{quarter}</b>
      <span className="release-filed">filed {new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{facts?.time === "after" ? " · after the close" : facts?.time === "before" ? " · before the open" : ""}</span>
      <span className="release-grid">
        <span>EPS</span><b>{facts?.reported != null ? facts.reported.toFixed(2) : loading ? "…" : "—"}</b>
        <span>Consensus</span><b>{facts?.consensus != null ? facts.consensus.toFixed(2) : loading ? "…" : "—"}</b>
        <span>Surprise</span><b data-tone={tone(facts?.surprise)}>{facts?.surprise != null ? `${facts.surprise >= 0 ? "+" : "−"}${Math.abs(facts.surprise).toFixed(1)}%` : loading ? "…" : "—"}</b>
        <span>Across the release</span><b data-tone={tone(move?.day)}>{percent(move?.day)}</b>
        <span>+5 sessions</span><b data-tone={tone(move?.week)}>{percent(move?.week)}</b>
        <span>+20 sessions</span><b data-tone={tone(move?.month)}>{percent(move?.month)}</b>
      </span>
      <span className="release-hint">Click for the earnings reaction history</span>
    </>
  );
}

/** Where a click on the marker leads: the company page's Earnings reaction panel, that release picked out. */
export const RELEASE_EVENT = "tenqay:release";
export function openRelease(ticker: string, date: string) {
  const panel = document.getElementById("erx");
  if (panel) {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    window.dispatchEvent(new CustomEvent(RELEASE_EVENT, { detail: date }));
    return;
  }
  window.location.assign(`/t/s/${encodeURIComponent(ticker)}?release=${date}#erx`);
}
