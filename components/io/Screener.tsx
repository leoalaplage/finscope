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

/**
 * The watchlist written as the engine's table, plus what it took to build it.
 *
 * It names the list it was built from, the way every state on the company page
 * names its company: a reader who edits their watchlist has a table in hand
 * that is not this list's, and a table that says which list it is cannot be
 * scored under another one while the new one is fetched.
 */
interface Built { followed: string; table: string; asked: number; answered: number }

type State =
  | { kind: "building"; ready: number; asked: number }
  | { kind: "failed"; message: string }
  | { kind: "ready"; feed: Feed };

/** The same two, while the list is still arriving, and for which list. */
type Progress = ({ kind: "building"; ready: number; asked: number } | { kind: "failed"; message: string }) & { followed: string };

/**
 * How long the page waits for the rest of the list, and how often it asks.
 *
 * A company is normalized from its own filings the first time anybody scores
 * it, and the endpoint builds three of them per read — so asking again is what
 * makes progress, and the reader was previously the one doing the asking
 * without knowing it: the table opened with whatever happened to be cached and
 * grew every time they touched a control, because each of those touches
 * refetched. A minute of waiting covers a cold list of sixty; past that the
 * page shows what it has rather than waiting for a filer that may never parse.
 */
const POLL_MS = 3_000;
const POLL_LIMIT = 20;

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
  const [built, setBuilt] = useState<Built | null>(null);
  const [progress, setProgress] = useState<Progress>(() => ({ kind: "building", followed, ready: 0, asked: tickers.length }));
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

  /*
   * The list is fetched once, and scored wherever the weights are.
   *
   * The preset used to be a dependency of this effect, so choosing Value
   * refetched every digest and every price to run a pure function over a table
   * the page already had. That is what made the screener appear to fill up as
   * the reader clicked: each click was another read of an endpoint that builds
   * three more companies behind it. The table is now built once and the engine
   * runs over it in a memo below, so a weight change is instant and costs the
   * network nothing.
   */
  const scoringPasted = pasted.trim().length > 0;

  useEffect(() => {
    if (scoringPasted) return;
    const controller = new AbortController();
    const asked = followed ? followed.split(",") : [];
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const build = async () => {
      try {
        const response = await fetch(`/api/watchlist?tickers=${encodeURIComponent(followed)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("The watchlist could not be read.");
        const payload = await response.json() as { summaries?: WatchlistSummary[]; pending?: string[] };
        const summaries = (payload.summaries ?? []).filter((item) => item.qs);

        /*
         * A partial list is a loading state, not a result.
         *
         * The endpoint names the companies it has no digest for, and the read
         * itself sets three of them building. Showing the ones that happened to
         * be ready would rank a reader's watchlist against a fraction of itself
         * — a grade of B is a different statement when eleven of twenty-seven
         * companies are in the table — so the page waits, says how far along it
         * is, and asks again.
         */
        attempts += 1;
        const waiting = (payload.pending ?? []).length;
        if (waiting > 0 && attempts <= POLL_LIMIT) {
          setProgress({ kind: "building", followed, ready: summaries.length, asked: asked.length });
          timer = setTimeout(build, POLL_MS);
          return;
        }
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
        if (controller.signal.aborted) return;
        setBuilt({ followed, table: qsTable(rows), asked: asked.length, answered: summaries.length });
      } catch (error) {
        if (controller.signal.aborted) return;
        setProgress({ kind: "failed", followed, message: error instanceof Error ? error.message : "The screener could not be built." });
      }
    };

    build();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [followed, scoringPasted]);

  /** The same engine, over the table already in hand — if it is this list's. */
  const watchlistState = useMemo<State | null>(() => {
    if (!built || built.followed !== followed) return null;
    try {
      const result = screen(built.table, { preset });
      return { kind: "ready", feed: { rows: result.all, missing: result.missing, asked: built.asked, answered: built.answered, source: "watchlist" } };
    } catch (error) {
      return { kind: "failed", message: error instanceof Error ? error.message : "The screener could not be built." };
    }
  }, [built, followed, preset]);

  // A list the reader has just edited has no progress of its own yet either.
  const waiting = useMemo<State>(
    () => (progress.followed === followed ? progress : { kind: "building", ready: 0, asked: tickers.length }),
    [progress, followed, tickers.length],
  );
  const state = pastedState ?? watchlistState ?? waiting;

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
              : state.kind === "building"
                ? `${state.ready} of ${state.asked || tickers.length} ready`
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

        {state.kind === "building" ? (
          <Building ready={state.ready} asked={state.asked} />
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

/**
 * The wait, stated rather than hidden.
 *
 * A company is normalized from its own filings the first time it is scored, and
 * a watchlist nobody has opened today is therefore a minute of work the reader
 * cannot see happening. What they saw instead was a table missing half its rows
 * that grew whenever they clicked something. This says how many companies are
 * in, moves as they arrive, and hands over a complete list.
 */
function Building({ ready, asked }: { ready: number; asked: number }) {
  const done = asked > 0 ? Math.round((ready / asked) * 100) : 0;
  return (
    <div className="state">
      <p className="load-copy" aria-live="polite">Reading the filings · {ready} of {asked} companies</p>
      <div
        className="load-track"
        role="progressbar"
        aria-label="Watchlist scoring progress"
        aria-valuemin={0}
        aria-valuemax={asked}
        aria-valuenow={ready}
        aria-valuetext={`${ready} of ${asked} companies`}
      >
        <span style={{ width: `${done}%` }} />
      </div>
      <p className="stat-note" style={{ marginTop: 14 }}>
        Each company is read from its own SEC filings once and kept for a day. The table opens on the whole list, so a
        grade is never struck against a fraction of it.
      </p>
    </div>
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
