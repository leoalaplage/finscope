"use client";

import { useEffect, useMemo, useState } from "react";
import { QS_COLUMNS, qsTable, qsValuationColumns, type QsRow } from "@/lib/qs-export";
import {
  naturalDirection, QS_PRESETS, screen, sortRowsBy,
  type PresetName, type ScoredCompany, type SortDirection,
} from "@/lib/qs/screener";
import type { PricePoint } from "@/lib/types";
import type { WatchlistSummary } from "@/lib/watchlist-summary";
import { useStoredWatchlist } from "./watchlist";
import { ABSENT, money, percent } from "./format";

/**
 * The Quality Score, over the list a reader follows or a table they paste.
 *
 * The engine is not touched, called differently, or told where its rows came
 * from. A watchlist row is built from the digests this application already
 * stores and completed with the prices fetched now, then handed over as a
 * table — the same text, under the same column titles, entering by the same
 * door a pasted export uses. Four pillars, a weighted score and a letter grade
 * come back.
 *
 * All of it runs in the browser. Nothing is uploaded, and a pasted table never
 * leaves the page at all.
 */

interface Feed { rows: ScoredCompany[]; missing: string[]; asked: number; answered: number; source: "watchlist" | "pasted" }

type State =
  | { kind: "working" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; feed: Feed };

/**
 * The columns, each naming the criterion the engine already ranks it by.
 *
 * A header sorts by the same definition the engine uses everywhere else, so
 * adding a criterion there offers it here without a second vocabulary.
 */
const COLUMNS: Array<{ sort: string; label: string; read: (row: ScoredCompany) => string; empty: (row: ScoredCompany) => boolean }> = [
  { sort: "note", label: "Grade", read: (row) => row.note, empty: (row) => row.note === "NR" },
  { sort: "total", label: "Score", read: (row) => (row.total == null ? ABSENT : row.total.toFixed(1)), empty: (row) => row.total == null },
  { sort: "Quality", label: "Quality", read: (row) => write(row.piliers.Quality), empty: (row) => row.piliers.Quality == null },
  { sort: "Health", label: "Health", read: (row) => write(row.piliers.Health), empty: (row) => row.piliers.Health == null },
  { sort: "Growth", label: "Growth", read: (row) => write(row.piliers.Growth), empty: (row) => row.piliers.Growth == null },
  { sort: "Value", label: "Value", read: (row) => write(row.piliers.Value), empty: (row) => row.piliers.Value == null },
  { sort: "couverture", label: "Coverage", read: (row) => percent(row.couverture, 0), empty: () => false },
  { sort: "alertes", label: "Alerts", read: (row) => String(row.alertes), empty: (row) => row.alertes === 0 },
  { sort: "cap", label: "Market cap", read: (row) => (row.Cap == null ? ABSENT : money(row.Cap * 1e9, "USD")), empty: (row) => row.Cap == null },
  { sort: "valuation", label: "Valuation", read: (row) => row.valuation || ABSENT, empty: (row) => !row.valuation },
];

const write = (value: number | null) => (value == null ? ABSENT : value.toFixed(0));

export function Screener() {
  const tickers = useStoredWatchlist();
  const followed = tickers.join(",");
  const [fetched, setFetched] = useState<State>({ kind: "working" });
  const [preset, setPreset] = useState<PresetName>("defaut");
  const [pasted, setPasted] = useState("");
  const [sortKey, setSortKey] = useState("total");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const chooseSort = (key: string) => {
    if (key === sortKey) { setDirection((current) => (current === "asc" ? "desc" : "asc")); return; }
    setSortKey(key);
    // A column opens the way that puts the best row on top, which is not the
    // same direction for every column: fewest alerts first, highest score first.
    setDirection(naturalDirection(key));
  };

  /*
   * A pasted table is scored where it stands.
   *
   * Nothing is fetched for it and nothing is stored, so it is a pure function
   * of the text and the weights — which is what it is written as. Only the
   * watchlist, which has to ask the network, needs an effect.
   */
  const pastedState = useMemo<State | null>(() => {
    if (!pasted.trim()) return null;
    try {
      const result = screen(pasted, { preset });
      return { kind: "ready", feed: { rows: result.all, missing: result.missing, asked: result.all.length, answered: result.all.length, source: "pasted" } };
    } catch (error) {
      return { kind: "failed", message: error instanceof Error ? error.message : "That table could not be read." };
    }
  }, [pasted, preset]);

  useEffect(() => {
    if (pasted.trim()) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/watchlist?tickers=${encodeURIComponent(followed)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("The watchlist could not be read.");
        const payload = await response.json() as { summaries?: WatchlistSummary[] };
        const summaries = (payload.summaries ?? []).filter((item) => item.qs);
        if (!summaries.length) throw new Error("None of these companies has been built yet. Open one, or paste a table below.");

        const today = new Date().toISOString().slice(0, 10);
        const prices = await Promise.all(summaries.map(async (item) => {
          try {
            const priced = await fetch(`/api/price/${encodeURIComponent(item.ticker)}?date=${today}`, { signal: controller.signal });
            if (!priced.ok) return null;
            const point = await priced.json() as PricePoint;
            // The currency travels with the close: the valuation columns refuse
            // a price quoted in one currency against statements kept in another.
            return { value: point.priceClose ?? point.close ?? null, currency: point.currency };
          } catch { return null; }
        }));

        const rows: QsRow[] = summaries.map((item, index) => ({
          ticker: item.ticker,
          values: { ...item.qs, ...qsValuationColumns(item.qsPrice, prices[index]?.value ?? null, prices[index]?.currency) },
        }));
        const result = screen(qsTable(rows), { preset });
        setFetched({
          kind: "ready",
          feed: { rows: result.all, missing: result.missing, asked: tickers.length, answered: summaries.length, source: "watchlist" },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setFetched({ kind: "failed", message: error instanceof Error ? error.message : "The screener could not be built." });
      }
    })();
    return () => controller.abort();
  }, [followed, preset, pasted, tickers.length]);

  const state = pastedState ?? fetched;

  const ordered = useMemo(
    () => (state.kind === "ready" ? sortRowsBy(state.feed.rows, sortKey, direction) : []),
    [state, sortKey, direction],
  );

  return (
    <main className="wrap">
      <header className="head">
        <div className="head-id">
          <h1 className="head-ticker">QS Screener</h1>
          <p className="head-note">Four pillars, one weighted score, a letter grade</p>
        </div>
        <div className="head-meta">
          <span className="label">
            {state.kind === "ready"
              ? state.feed.source === "pasted"
                ? `${state.feed.answered} pasted`
                : `${state.feed.answered} of ${state.feed.asked} scored`
              : `${tickers.length} companies`}
          </span>
          <span className="label">Scored in your browser</span>
        </div>
      </header>

      <section className="section" style={{ borderTop: 0 }}>
        <div className="section-head">
          <div className="seg">
            {(Object.keys(QS_PRESETS) as PresetName[]).map((name) => (
              <button key={name} type="button" aria-pressed={preset === name} onClick={() => setPreset(name)}>
                {name === "defaut" ? "Balanced" : name === "quality-purist" ? "Quality" : "Value"}
              </button>
            ))}
          </div>
        </div>

        {state.kind === "working" ? (
          <p className="state"><span className="pulse" />Scoring</p>
        ) : state.kind === "failed" ? (
          <div className="state"><p>{state.message}</p></div>
        ) : (
          <ScoreTable feed={state.feed} rows={ordered} sortKey={sortKey} direction={direction} onSort={chooseSort} />
        )}
      </section>

      <Paste value={pasted} onChange={setPasted} />
    </main>
  );
}

function ScoreTable({
  feed,
  rows,
  sortKey,
  direction,
  onSort,
}: {
  feed: Feed;
  rows: ScoredCompany[];
  sortKey: string;
  direction: SortDirection;
  onSort: (key: string) => void;
}) {
  if (!rows.length) return <div className="state"><p>No company in this list could be scored.</p></div>;

  const header = (key: string, label: string) => (
    <th
      key={key}
      scope="col"
      aria-sort={sortKey === key ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className="sort-header" onClick={() => onSort(key)}>
        {label}
        <span className="sort-mark" aria-hidden="true">{sortKey === key ? (direction === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );

  return (
    <>
      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th className="key" scope="col">
                <button type="button" className="sort-header" onClick={() => onSort("ticker")}>
                  Company
                  <span className="sort-mark" aria-hidden="true">{sortKey === "ticker" ? (direction === "asc" ? "↑" : "↓") : ""}</span>
                </button>
              </th>
              {COLUMNS.map((column) => header(column.sort, column.label))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.Ticker}>
                <th className="key" scope="row">
                  <a className="key-open" href={`/s/${encodeURIComponent(row.Ticker)}`}>
                    <span className="screener-rank">{index + 1}</span>
                    {row.Ticker}
                    <span className="screener-sector">{row.Secteur}</span>
                  </a>
                </th>
                {COLUMNS.map((column) => (
                  <td key={column.sort} data-empty={column.empty(row)}>{column.read(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {feed.missing.length ? (
        <p className="stat-note" style={{ marginTop: 12 }}>
          No company in this table carries {feed.missing.length} of the scored measures, so they weigh nothing:{" "}
          {feed.missing.slice(0, 6).join(", ")}{feed.missing.length > 6 ? "…" : ""}
        </p>
      ) : null}
      {feed.source === "watchlist" && feed.answered < feed.asked ? (
        <p className="stat-note" style={{ marginTop: 6 }}>
          {feed.asked - feed.answered} of your companies have not been built yet and are left out rather than scored on nothing.
        </p>
      ) : null}
    </>
  );
}

/**
 * A table from somewhere else.
 *
 * The engine reads a table, not this application's cache, so anything with the
 * right column titles scores here — an export from a data provider, a
 * spreadsheet, a CSV. It is parsed in the page and never sent anywhere. Empty,
 * the screener goes back to scoring the watchlist.
 */
function Paste({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="section paste">
      <div className="section-head">
        <h2 className="label">Score your own table</h2>
        <button className="metric-toggle" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
          {open ? "Hide" : value ? "Edit" : "Paste a table"}
        </button>
      </div>
      {open ? (
        <>
          <textarea
            className="paste-area"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            placeholder="Paste a CSV or a tab-separated export — the first row is the column titles."
            aria-label="Paste a table to score"
          />
          <div className="paste-foot">
            <p className="stat-note">
              Recognised titles: {QS_COLUMNS.join(", ")}. Nothing is uploaded — the table is read in this page.
            </p>
            {value ? <button className="metric-toggle" type="button" onClick={() => onChange("")}>Back to my watchlist</button> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
