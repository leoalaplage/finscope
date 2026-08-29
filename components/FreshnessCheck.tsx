"use client";

import { useState } from "react";
import type { FreshnessRow } from "@/app/api/freshness/route";

/** The endpoint answers about six companies at a time; the page asks in turn. */
const BATCH = 6;

const DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const day = (iso: string | null) => {
  if (!iso) return "—";
  const parsed = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? iso.slice(0, 10) : DAY.format(parsed);
};

/**
 * Whether what FinScope holds is the latest each company has filed.
 *
 * The check a reader could not make. Veeva published a quarter and the site
 * showed the previous one for days; every figure on the page was internally
 * consistent and every one of them was out of date, and nothing on any screen
 * could have said so. Asking our own cache whether it is current is circular,
 * so this asks the SEC — period against period, because a company that has
 * filed nothing since May is perfectly current in August and no clock can tell
 * the difference.
 */
export function FreshnessCheck({ tickers }: { tickers: string[] }) {
  const [rows, setRows] = useState<FreshnessRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState("");

  async function check() {
    setRunning(true); setError(""); setRows([]); setDone(0);
    const collected: FreshnessRow[] = [];
    try {
      // One batch after another rather than all at once: each company is a
      // couple of hundred kilobytes fetched from the SEC and parsed, and the
      // reader would rather watch it fill in than wait for one long request.
      for (let index = 0; index < tickers.length; index += BATCH) {
        const batch = tickers.slice(index, index + BATCH);
        const response = await fetch(`/api/freshness?tickers=${encodeURIComponent(batch.join(","))}`, { cache: "no-store" });
        const payload = await response.json() as { rows?: FreshnessRow[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "The check could not be completed");
        collected.push(...(payload.rows ?? []));
        setRows([...collected]);
        setDone(Math.min(index + BATCH, tickers.length));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The check could not be completed");
    } finally {
      setRunning(false);
    }
  }

  const behind = rows?.filter((row) => row.status === "behind") ?? [];
  const unknown = rows?.filter((row) => row.status === "unknown") ?? [];

  return <section className="plain-section">
    <div className="section-heading">
      <h2>Is this the latest data?</h2>
      <button className="button-primary" onClick={() => void check()} disabled={running || !tickers.length}>
        {running ? `Checking ${done}/${tickers.length}…` : "Run a checkup"}
      </button>
    </div>
    <p className="section-note">
      Compares the last period FinScope holds for each company against the most recent report that company
      has actually filed with the SEC. Nothing here reads our own cache to decide whether our own cache is
      current — that is the reasoning that let a published quarter go unnoticed.
    </p>

    {error && <p className="notice">{error}</p>}

    {rows && rows.length > 0 && <>
      {!running && <p className={behind.length ? "notice" : "simple-state"}>
        {behind.length
          ? <><b>{behind.length} {behind.length === 1 ? "company is" : "companies are"} behind.</b> Open {behind.map((row) => row.ticker).join(", ")} and the newer filing will be read on the way in.</>
          : <><b>Everything is current.</b> {rows.length} companies checked against the SEC{unknown.length ? `, ${unknown.length} could not be checked` : ""}.</>}
      </p>}
      <div className="table-scroll"><table className="freshness-table">
        <thead><tr>
          <th scope="col">Company</th><th scope="col">Latest period held</th><th scope="col">Filings read</th>
          <th scope="col">Latest SEC report</th><th scope="col">Status</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.ticker}>
          <th scope="row">{row.ticker}</th>
          <td>{day(row.held)}</td>
          <td>{day(row.readAt)}</td>
          <td>{row.filed ? `${row.filed.form} to ${day(row.filed.reportDate)}` : "—"}</td>
          <td><span className={`freshness-state ${row.status}`}>{row.status === "current" ? "Current" : row.status === "behind" ? "Behind" : "Unknown"}</span>
            {row.note && <small>{row.note}</small>}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
