"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { PERFORMANCE_SHAPE, WINDOWS, type WindowId } from "@/lib/performance";
import type { PerformanceRow } from "@/app/api/performance/route";
import { ABSENT, delta, price as writePrice, shortDate } from "./format";
import { useStoredWatchlist } from "./watchlist";
import { WatchlistEditor } from "./WatchlistEditor";

/**
 * Every window's return for the list a reader follows.
 *
 * Four windows out of one pass over one set of daily closes, which is what
 * makes a table like this cheap enough to draw at all — a request per company
 * rather than one per cell.
 *
 * Two of them are totals and two are rates. A day and a year to date are moves;
 * five and ten years are annualised, because a cumulative six hundred per cent
 * says nothing about the pace it was earned at and cannot sit in a row beside a
 * one-day change without misleading — the headings carry "p.a." because +25% a
 * year against +25% over a decade is the same nine characters and the opposite
 * fact.
 *
 * The day is the one figure on this site that carries a colour, and it is here
 * at the reader's request. It is drawn as a highlighter over the number and
 * nothing more — the width of the figure, not the width of the column — so the
 * table keeps its ruled grid instead of gaining a block of colour in the middle
 * of every row. The number keeps its full-strength ink and its sign, so the
 * column can be scanned by anyone and read by everyone. It is still an
 * exception to how the rest of the site says up and down, which is with the
 * sign alone, so it is confined to this one column.
 *
 * A window longer than a company's own history is blank, not a return since
 * listing. Palantir has no ten-year column because Palantir has no ten years,
 * and stating one anchored on its first session would be a figure about the
 * IPO wearing the label of a decade.
 */

/** How many companies one request prices. The endpoint's own cap. */
const BATCH = 8;

type Rows = Record<string, PerformanceRow>;

export function MarketPerformance() {
  const stored = useStoredWatchlist();
  const [session, setSession] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  /*
   * The rows carry the list they were priced for.
   *
   * A reader who edits their watchlist has figures in hand that are not this
   * list's, and rows that say which list they belong to cannot be shown under
   * another one while the new one is fetched. The same rule the screener holds
   * its table under, and it needs no effect to clear anything.
   */
  const [answer, setAnswer] = useState<{ followed: string; rows: Rows; failed: boolean }>(
    { followed: "", rows: {}, failed: false },
  );
  /*
   * Today, best first.
   *
   * The table opens on the question a reader opens the market page with —
   * what moved, and which way — rather than on a year-to-date ranking that is
   * the same list it was yesterday morning.
   */
  const [sort, setSort] = useState<{ key: WindowId | "ticker"; direction: "asc" | "desc" }>({ key: "d1", direction: "desc" });

  const tickers = session ?? stored;
  const followed = tickers.join(",");
  const current = answer.followed === followed ? answer : { followed, rows: {} as Rows, failed: false };
  const rows = current.rows;
  const failed = current.failed;

  useEffect(() => {
    if (!followed) return;
    const controller = new AbortController();
    const list = followed.split(",");
    (async () => {
      /*
       * In batches, and drawn as they land. Sixty companies is sixty sets of a
       * decade of sessions; asking for them in one request would be one long
       * wait ending in a timeout rather than a table that fills in.
       */
      for (let index = 0; index < list.length; index += BATCH) {
        try {
          const response = await fetch(
            `/api/performance?tickers=${encodeURIComponent(list.slice(index, index + BATCH).join(","))}&v=${PERFORMANCE_SHAPE}`,
            { signal: controller.signal },
          );
          if (!response.ok) throw new Error(String(response.status));
          const payload = await response.json() as { rows?: PerformanceRow[] };
          if (controller.signal.aborted) return;
          setAnswer((held) => {
            const next: Rows = held.followed === followed ? { ...held.rows } : {};
            for (const row of payload.rows ?? []) next[row.ticker.toUpperCase()] = row;
            return { followed, rows: next, failed: false };
          });
        } catch {
          if (!controller.signal.aborted && index === 0) {
            setAnswer((held) => (held.followed === followed ? { ...held, failed: true } : { followed, rows: {}, failed: true }));
          }
        }
      }
    })();
    return () => controller.abort();
  }, [followed]);

  const ordered = useMemo(() => {
    const present = tickers.map((ticker) => ({ ticker, row: rows[ticker] ?? null }));
    const factor = sort.direction === "asc" ? 1 : -1;
    if (sort.key === "ticker") {
      return [...present].sort((left, right) => factor * left.ticker.localeCompare(right.ticker, "en"));
    }
    /*
     * A company with no figure for a window is neither the best nor the worst
     * at it, so it sits at the bottom whichever way the column points. Sorting
     * it as nought would rank a company that has not existed long enough above
     * every company that fell.
     */
    const window = sort.key;
    return [...present].sort((left, right) => {
      const a = left.row?.changes[window] ?? null;
      const b = right.row?.changes[window] ?? null;
      if (a == null && b == null) return left.ticker.localeCompare(right.ticker, "en");
      if (a == null) return 1;
      if (b == null) return -1;
      return factor * (a - b);
    });
  }, [tickers, rows, sort]);

  const choose = (key: WindowId | "ticker") => setSort((current) => current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: key === "ticker" ? "asc" : "desc" });

  const loaded = Object.keys(rows).length;
  const asOf = Object.values(rows).map((row) => row.asOf).filter((date): date is string => !!date).sort().at(-1) ?? null;

  const header = (key: WindowId | "ticker", label: string, wide = false) => (
    <th
      key={key}
      scope="col"
      className={wide ? "key" : undefined}
      aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className="sort-header" onClick={() => choose(key)}>
        {label}
        <span className="sort-mark" aria-hidden="true">{sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );

  return (
    <section className="section performance" aria-labelledby="performance-title">
      <div className="section-head">
        <h2 className="label" id="performance-title">Watchlist performance</h2>
        <div className="performance-meta">
          <span className="label">
            {loaded < tickers.length ? `${loaded} of ${tickers.length} priced` : `${tickers.length} companies`}
            {asOf ? ` · ${shortDate(asOf)}` : ""}
          </span>
          <button className="watchlist-edit" type="button" onClick={() => setEditing(true)} aria-label="Edit watchlist" title="Edit watchlist">
            <Pencil size={11} />
          </button>
        </div>
      </div>

      {failed ? (
        <p className="stat-note">Prices are temporarily unavailable, so no window can be measured.</p>
      ) : (
        <div className="sheet performance-sheet">
          <table>
            <thead>
              <tr>
                {header("ticker", "Company", true)}
                <th scope="col">Price</th>
                {WINDOWS.map((window) => header(window.id, window.label))}
              </tr>
            </thead>
            <tbody>
              {ordered.map(({ ticker, row }) => (
                <tr key={ticker}>
                  <th className="key" scope="row">
                    <a className="key-open" href={`/s/${encodeURIComponent(ticker)}`}>{ticker}</a>
                  </th>
                  <td data-empty={row?.price == null}>
                    {row ? (row.price == null ? ABSENT : writePrice(row.price, "USD")) : <span className="skeleton performance-wait" />}
                  </td>
                  {WINDOWS.map((window) => {
                    const value = row?.changes[window.id] ?? null;
                    return (
                      <td
                        key={window.id}
                        data-empty={value == null}
                        data-window={window.id}
                        data-dir={value == null ? undefined : value > 0 ? "up" : value < 0 ? "down" : "flat"}
                      >
                        {row
                          ? value == null
                            ? ABSENT
                            /* The figure carries the mark, not the cell it sits
                               in: a highlighter over the number, the width of
                               the number. */
                            : <span className="day-mark">{delta(value, 1)}</span>
                          : <span className="skeleton performance-wait" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}


      {editing ? (
        <WatchlistEditor tickers={tickers} onClose={() => setEditing(false)} onSaved={setSession} />
      ) : null}
    </section>
  );
}
