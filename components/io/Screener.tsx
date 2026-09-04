"use client";

import { useEffect, useMemo, useState } from "react";
import { qsTable, qsValuationColumns, type QsRow } from "@/lib/qs-export";
import { QS_PRESETS, QS_SORTS, screen, type PresetName, type ScoredCompany } from "@/lib/qs/screener";
import type { PricePoint } from "@/lib/types";
import type { WatchlistSummary } from "@/lib/watchlist-summary";
import { useStoredWatchlist } from "./watchlist";
import { ABSENT, money, percent } from "./format";

/**
 * The Quality Score, over the list a reader follows.
 *
 * The engine is not touched, called differently, or told where its rows came
 * from. Every row is built from the digests this application already stores and
 * completed with the prices fetched now, then handed over as a table — the same
 * text, under the same column titles, entering by the same door a pasted export
 * would. Four pillars, a weighted score and a letter grade come back.
 *
 * All of it runs in the browser. Nothing is uploaded, and nothing about the
 * list leaves the device except the tickers themselves, which the cache needs
 * in order to answer.
 */

interface Feed { rows: ScoredCompany[]; missing: string[]; asked: number; answered: number }

type State =
  | { kind: "working" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; feed: Feed };

const COLUMNS: Array<{ key: string; label: string; read: (row: ScoredCompany) => string; empty: (row: ScoredCompany) => boolean }> = [
  { key: "note", label: "Grade", read: (row) => row.note, empty: (row) => row.note === "NR" },
  { key: "total", label: "Score", read: (row) => (row.total == null ? ABSENT : row.total.toFixed(1)), empty: (row) => row.total == null },
  { key: "Quality", label: "Quality", read: (row) => write(row.piliers.Quality), empty: (row) => row.piliers.Quality == null },
  { key: "Health", label: "Health", read: (row) => write(row.piliers.Health), empty: (row) => row.piliers.Health == null },
  { key: "Growth", label: "Growth", read: (row) => write(row.piliers.Growth), empty: (row) => row.piliers.Growth == null },
  { key: "Value", label: "Value", read: (row) => write(row.piliers.Value), empty: (row) => row.piliers.Value == null },
  { key: "couverture", label: "Coverage", read: (row) => percent(row.couverture, 0), empty: () => false },
  { key: "alertes", label: "Alerts", read: (row) => String(row.alertes), empty: (row) => row.alertes === 0 },
];

const write = (value: number | null) => (value == null ? ABSENT : value.toFixed(0));

export function Screener() {
  const tickers = useStoredWatchlist();
  const followed = tickers.join(",");
  const [state, setState] = useState<State>({ kind: "working" });
  const [preset, setPreset] = useState<PresetName>("defaut");
  const [sort, setSort] = useState("total");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/watchlist?tickers=${encodeURIComponent(followed)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("The watchlist could not be read.");
        const payload = await response.json() as { summaries?: WatchlistSummary[] };
        const summaries = (payload.summaries ?? []).filter((item) => item.qs);
        if (!summaries.length) throw new Error("None of these companies has been built yet. Open one and come back.");

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
        const result = screen(qsTable(rows), { preset, classerPar: sort });
        setState({
          kind: "ready",
          feed: { rows: result.rows, missing: result.missing, asked: tickers.length, answered: summaries.length },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ kind: "failed", message: error instanceof Error ? error.message : "The screener could not be built." });
      }
    })();
    return () => controller.abort();
  }, [followed, preset, sort, tickers.length]);

  return (
    <main className="wrap">
      <header className="head">
        <div className="head-row">
          <div>
            <div className="head-id">
              <h1 className="head-ticker">QS Screener</h1>
              <p className="head-name">Four pillars, one weighted score, a letter grade</p>
            </div>
            <div className="head-meta">
              <span className="label">
                {state.kind === "ready" ? `${state.feed.answered} of ${state.feed.asked} scored` : `${tickers.length} companies`}
              </span>
              <span className="label">Scored in your browser</span>
            </div>
          </div>
        </div>
      </header>

      <section className="section" style={{ borderTop: 0 }}>
        <div className="section-head screener-head">
          <div className="seg">
            {(Object.keys(QS_PRESETS) as PresetName[]).map((name) => (
              <button key={name} type="button" aria-pressed={preset === name} onClick={() => setPreset(name)}>
                {name === "defaut" ? "Balanced" : name === "quality-purist" ? "Quality" : "Value"}
              </button>
            ))}
          </div>
          <label className="screener-sort">
            <span className="label">Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {QS_SORTS.map((criterion) => (
                <option key={criterion.key} value={criterion.key}>{criterion.label}</option>
              ))}
            </select>
          </label>
        </div>

        {state.kind === "working" ? (
          <p className="state"><span className="pulse" />Scoring</p>
        ) : state.kind === "failed" ? (
          <div className="state"><p>{state.message}</p></div>
        ) : (
          <ScoreTable feed={state.feed} />
        )}
      </section>
    </main>
  );
}

function ScoreTable({ feed }: { feed: Feed }) {
  const weights = useMemo(() => feed.rows.length, [feed.rows]);
  if (!weights) return <div className="state"><p>No company in this list could be scored.</p></div>;

  return (
    <>
      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th className="key" scope="col">Rank</th>
              {COLUMNS.map((column) => <th key={column.key} scope="col">{column.label}</th>)}
              <th scope="col">Market cap</th>
              <th scope="col">Valuation</th>
            </tr>
          </thead>
          <tbody>
            {feed.rows.map((row, index) => (
              <tr key={row.Ticker}>
                <th className="key" scope="row">
                  <a className="key-open" href={`/s/${encodeURIComponent(row.Ticker)}`}>
                    <span className="screener-rank">{index + 1}</span>
                    {row.Ticker}
                    <span className="screener-sector">{row.Secteur}</span>
                  </a>
                </th>
                {COLUMNS.map((column) => (
                  <td key={column.key} data-empty={column.empty(row)}>{column.read(row)}</td>
                ))}
                <td data-empty={row.Cap == null}>{row.Cap == null ? ABSENT : money(row.Cap * 1e9, "USD")}</td>
                <td data-empty={!row.valuation}>{row.valuation || ABSENT}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {feed.missing.length ? (
        <p className="stat-note" style={{ marginTop: 12 }}>
          No company in this list carries {feed.missing.length} of the scored measures, so they weigh nothing:{" "}
          {feed.missing.slice(0, 6).join(", ")}{feed.missing.length > 6 ? "…" : ""}
        </p>
      ) : null}
      {feed.answered < feed.asked ? (
        <p className="stat-note" style={{ marginTop: 6 }}>
          {feed.asked - feed.answered} of your companies have not been built yet and are left out rather than scored on nothing.
        </p>
      ) : null}
    </>
  );
}
