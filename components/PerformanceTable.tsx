"use client";

import { useEffect, useMemo, useState } from "react";
import { WINDOWS, type WindowId } from "@/lib/performance";
import type { PerformanceRow } from "@/app/api/performance/route";

/** The endpoint prices eight companies at a time; the page asks in turn. */
const BATCH = 8;

const percent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;

const price = (value: number | null) =>
  value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SortKey = "ticker" | WindowId;

/**
 * How the companies you follow have done, over every window at once.
 *
 * The heat map above answers one question — what moved today — and answers it
 * as a shape. This answers the other one: whether today is a blip or a trend,
 * which needs the same companies across several horizons in a form you can
 * order by any of them. Both are on the market page because they are the same
 * question asked at two speeds.
 *
 * Watchlist only, by request: fifty index members over seven windows is a
 * screen of numbers nobody reads, and the companies a reader chose are the ones
 * they came to check.
 */
export function PerformanceTable({ tickers }: { tickers: string[] }) {
  /*
   * The rows, and the watchlist they were priced for.
   *
   * Keeping them together is what lets a changed watchlist be answered while
   * rendering rather than cleared by an effect: the list no longer matches, so
   * the previous rows simply are not shown. Clearing them in an effect instead
   * means one render showing the wrong companies and a second correcting it.
   */
  const [state, setState] = useState<{ followed: string; rows: PerformanceRow[]; done: boolean; error: string }>(
    { followed: "", rows: [], done: false, error: "" });
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "d1", descending: true });

  const followed = tickers.join(",");
  const current = state.followed === followed ? state : { followed, rows: [], done: false, error: "" };
  const rows = current.rows;
  const loading = !current.done;
  const error = current.error;

  useEffect(() => {
    if (!followed) return;
    let active = true;
    void (async () => {
      const list = followed.split(",");
      const collected: PerformanceRow[] = [];
      try {
        // One batch after another: each company is five years of daily closes
        // fetched and reduced, and a table that fills in reads better than one
        // that arrives all at once several seconds late.
        for (let index = 0; index < list.length; index += BATCH) {
          const response = await fetch(`/api/performance?tickers=${encodeURIComponent(list.slice(index, index + BATCH).join(","))}`);
          const payload = await response.json() as { rows?: PerformanceRow[]; error?: string };
          if (!active) return;
          if (!response.ok) throw new Error(payload.error || "Performance unavailable");
          collected.push(...(payload.rows ?? []));
          setState({ followed, rows: [...collected], done: index + BATCH >= list.length, error: "" });
        }
      } catch (cause) {
        if (active) setState({ followed, rows: collected, done: true, error: cause instanceof Error ? cause.message : "Performance unavailable" });
      }
    })();
    return () => { active = false; };
  }, [followed]);

  const ordered = useMemo(() => {
    const copy = [...rows];
    copy.sort((left, right) => {
      if (sort.key === "ticker") return sort.descending ? right.ticker.localeCompare(left.ticker) : left.ticker.localeCompare(right.ticker);
      const a = left.changes[sort.key]; const b = right.changes[sort.key];
      // A company with no figure for this window sorts last either way: it is
      // not the worst performer, it is an unknown one.
      if (a == null && b == null) return left.ticker.localeCompare(right.ticker);
      if (a == null) return 1;
      if (b == null) return -1;
      return sort.descending ? b - a : a - b;
    });
    return copy;
  }, [rows, sort]);

  function order(key: SortKey) {
    setSort((current) => current.key === key ? { key, descending: !current.descending } : { key, descending: true });
  }
  const arrow = (key: SortKey) => sort.key !== key ? undefined : sort.descending ? "descending" as const : "ascending" as const;

  if (!tickers.length) return null;

  return <section className="heat-section">
    <div className="heat-head">
      <div>
        <h3>How your watchlist has done</h3>
        <small>
          Every window measured to the last close, on split-adjusted prices. Order by any column.
          {loading && rows.length > 0 ? ` · ${rows.length}/${tickers.length} priced` : ""}
        </small>
      </div>
    </div>

    {error && <p className="notice">{error}</p>}
    {loading && rows.length === 0 && <p className="simple-state">Pricing {tickers.length} companies…</p>}

    {rows.length > 0 && <div className="table-scroll"><table className="performance-table">
      <thead><tr>
        <th scope="col" aria-sort={arrow("ticker")}><button type="button" onClick={() => order("ticker")}>Company</button></th>
        <th scope="col">Last</th>
        {WINDOWS.map((window) => <th key={window.id} scope="col" aria-sort={arrow(window.id)}>
          <button type="button" onClick={() => order(window.id)}>{window.label}</button>
        </th>)}
      </tr></thead>
      <tbody>{ordered.map((row) => <tr key={row.ticker}>
        <th scope="row">{row.ticker}</th>
        <td>{price(row.price)}</td>
        {WINDOWS.map((window) => {
          const value = row.changes[window.id];
          return <td key={window.id} className={value == null ? undefined : value >= 0 ? "positive-text" : "negative-text"}>
            {percent(value)}
          </td>;
        })}
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
