"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QS_COLUMNS, qsTable, qsValuationColumns, type QsRow } from "@/lib/qs-export";
import {
  QS_ALERT_PENALTY, QS_COVERAGE_FLOOR, QS_GRADES, QS_METRIC_NAMES, QS_METRIC_NOTES,
  QS_METRICS, QS_PILLARS, QS_PRESETS, QS_SORTS, naturalDirection, resultsToCsv, scoreColour, scoreInk,
  screen, sectorsOf, sortRowsBy,
  type PillarName, type PresetName, type ScoredCompany, type ScreenerFilters, type ScreenerResult,
  type SortDirection,
} from "@/lib/qs/screener";
import type { WatchlistSummary } from "@/lib/watchlist-summary";
import type { PricePoint } from "@/lib/types";
import { readJson } from "@/lib/fetch-json";

/**
 * The QS Screener, drawn as a table rather than exported as a picture.
 *
 * The engine underneath is untouched — the same three modules the standalone
 * screener runs, byte for byte. What changed is everything around them: the
 * scores used to be painted onto a canvas inside an iframe, which meant a
 * reader could not sort by a column, could not select a figure, could not
 * search the page and could not have it read aloud. The numbers were already
 * right; they were simply behind glass.
 */

const PILLAR_NOTE: Record<PillarName, string> = {
  Quality: "Returns on capital, margins, cash conversion, dilution and stock-based pay.",
  Health: "Leverage, interest cover, short-term solvency and self-funding of investment.",
  Growth: "Five-year compound growth of revenue, cash flow and earnings, per share where possible.",
  Value: "What the market asks for that quality, on enterprise and cash multiples.",
};

/**
 * The columns, each naming the engine criterion it sorts by.
 *
 * The order here is the order on screen, and the key is what `sortRowsBy` reads
 * — so a column and its sort can never describe two different things.
 */
interface Column { key: string; label: string; numeric?: boolean; note?: string }

const COLUMNS: Column[] = [
  { key: "rang", label: "#", numeric: true, note: "Rank by total score" },
  { key: "ticker", label: "Ticker" },
  { key: "secteur", label: "Sector" },
  { key: "cap", label: "Cap", numeric: true },
  ...QS_PILLARS.map((pillar) => ({ key: pillar, label: pillar, numeric: true, note: PILLAR_NOTE[pillar] })),
  { key: "total", label: "Total", numeric: true },
  { key: "note", label: "Grade" },
  { key: "valuation", label: "Valuation" },
  { key: "conviction", label: "R.adj", numeric: true, note: `The total less ${QS_ALERT_PENALTY} points per alert` },
  { key: "couverture", label: "Data", numeric: true, note: "Share of the weighted metrics this company actually carried" },
  { key: "rang_secteur", label: "Sect", numeric: true, note: "Rank within its own sector, where the sector has enough companies to rank" },
  { key: "alertes", label: "Alerts", numeric: true },
  { key: "qv_median", label: "Q+V", note: "Above the universe median on both Quality and Value" },
];

/** A header that says how the table is ordered, and changes it when pressed. */
function SortableHeader({ column, active, direction, onSort }: {
  column: Column; active: boolean; direction: SortDirection; onSort: () => void;
}) {
  return <th scope="col" className={`${column.numeric ? "numeric" : ""}${active ? " sorted" : ""}`}
    aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
    <button type="button" onClick={onSort}
      title={`${column.note ? `${column.note}. ` : ""}Sort by ${column.label}${active ? `, currently ${direction === "asc" ? "ascending" : "descending"}` : ""}`}>
      {column.label}
      <span aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  </th>;
}

const pct = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
/** A market capitalisation in billions, written the way it is spoken. */
const cap = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}T`;
  if (value >= 10) return `${Math.round(value)}B`;
  if (value >= 1) return `${value.toFixed(1)}B`;
  return `${Math.round(value * 1000)}M`;
};

/** A score as the filled chip the printed dashboard used for the same figure. */
function ScoreCell({ value, digits = 1 }: { value: number | null | undefined; digits?: number }) {
  const missing = value == null || !Number.isFinite(value);
  return <td className="qs-score">
    <span style={missing ? undefined : { background: scoreColour(value), color: scoreInk(value) }}>
      {pct(value, digits)}
    </span>
  </td>;
}

const EXAMPLE = `Ticker,Sector,Market Cap,ROIC,ROIC 5Yr Avg,Operating Margin,FCF Margin 5Yr Avg,FCF / Net Income,Gross Margin 5Yr Avg,Shares Outstanding 5Y CAGR,SBC to Revenue,Net Debt / EBITDA,EBIT / Interest Expense,Current Ratio,Long-term Debt to Assets,OCF/Capex,Revenue 5Y CAGR,FCF 5Y CAGR,Net Income 5Y CAGR,EV/EBIT,EV/FCF,FCF Yield
AAPL,Tech Hardware,3521.5,57.2,52.4,31.8,25.1,105.4,43.2,-2.8,1.2,0.4,38.5,0.87,0.30,8.4,8.1,9.4,10.2,29.4,31.6,3.2
MSFT,Software,3188.2,29.1,28.8,44.6,31.4,112.0,68.9,0.3,4.1,0.2,42.0,1.28,0.14,3.1,14.2,15.8,17.4,32.1,36.8,2.7
GOOGL,Media,2210.4,25.8,23.9,32.4,22.6,98.2,56.4,-1.6,5.8,-0.6,120.0,2.10,0.04,2.4,15.1,13.9,21.2,21.4,25.7,3.9
V,Financials,618.0,27.4,26.3,66.9,52.1,103.1,79.8,-2.1,2.4,0.3,28.4,1.45,0.24,12.6,11.2,12.4,13.1,24.8,27.2,3.7
CPRT,Industrials,48.2,23.6,22.1,37.8,28.4,94.6,45.9,0.2,1.1,-1.4,,4.85,0.01,2.9,13.4,12.1,15.6,32.6,41.2,2.4`;

/**
 * Everything the screener remembers between visits.
 *
 * The table used to vanish the moment the reader looked at another page: the
 * pasted export, the filters and the ranking all lived in component state, and
 * leaving the page unmounted the component. Pasting a hundred-row export from a
 * spreadsheet is not something anyone wants to do twice, so it is written to
 * this browser and read back on the way in. Nothing leaves the machine, which
 * is the same promise the page has always made about the data itself.
 */
const STORAGE_KEY = "finscope.qs";

interface StoredState {
  text: string;
  preset: string;
  top: string; minScore: string; maxAlerts: string; capMin: string;
  grades: string[]; sectors: string[];
  attractiveOnly: boolean; sweetSpotOnly: boolean; winsorise: boolean;
  sortKey: string; sortDirection: SortDirection;
}

const DEFAULTS: StoredState = {
  text: "", preset: "defaut",
  top: "", minScore: "", maxAlerts: "", capMin: "",
  grades: [], sectors: [],
  attractiveOnly: false, sweetSpotOnly: false, winsorise: true,
  sortKey: "total", sortDirection: "desc",
};

/** Reads the saved state, treating anything unreadable as nothing saved. */
function restore(): StoredState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredState> | null;
    return saved ? { ...DEFAULTS, ...saved } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function QsScreener({ tickers = [] }: { tickers?: string[] }) {
  // Read once, on mount, and never again: a lazy initialiser rather than a ref,
  // so nothing reads a mutable box during render.
  const [initial] = useState(restore);
  const [text, setText] = useState(initial.text);
  const [feeding, setFeeding] = useState<"" | "working" | "failed">("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fileError, setFileError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // The controls, held apart from the result so that changing one re-runs the
  // engine rather than re-sorting a stale set: a filter changes which companies
  // are ranked against each other, and therefore every percentile.
  const [preset, setPreset] = useState<string>(initial.preset);
  const [top, setTop] = useState<string>(initial.top);
  const [minScore, setMinScore] = useState<string>(initial.minScore);
  const [maxAlerts, setMaxAlerts] = useState<string>(initial.maxAlerts);
  const [capMin, setCapMin] = useState<string>(initial.capMin);
  const [grades, setGrades] = useState<string[]>(initial.grades);
  const [sectors, setSectors] = useState<string[]>(initial.sectors);
  const [attractiveOnly, setAttractiveOnly] = useState(initial.attractiveOnly);
  const [sweetSpotOnly, setSweetSpotOnly] = useState(initial.sweetSpotOnly);
  const [winsorise, setWinsorise] = useState(initial.winsorise);
  /**
   * Which column the table is ordered by, and which way.
   *
   * One piece of state for both the "Rank by" control and the column headers,
   * because they are the same question asked twice — a reader who sorts by
   * clicking Value and then opens the control should find Value selected there.
   */
  const [sortKey, setSortKey] = useState(initial.sortKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initial.sortDirection);

  const filters = useMemo<ScreenerFilters>(() => ({
    preset: preset === "defaut" ? undefined : preset as PresetName,
    classerPar: sortKey,
    top: top === "" ? "" : Number(top),
    minScore: minScore === "" ? "" : Number(minScore),
    maxAlertes: maxAlerts === "" ? "" : Number(maxAlerts),
    capMin: capMin === "" ? "" : Number(capMin),
    notes: grades.length ? grades : undefined,
    secteurs: sectors.length ? sectors : undefined,
    valoAttractive: attractiveOnly,
    sweetSpot: sweetSpotOnly,
    winsoriser: winsorise,
  }), [preset, sortKey, top, minScore, maxAlerts, capMin, grades, sectors, attractiveOnly, sweetSpotOnly, winsorise]);

  /**
   * The scores, derived from the text and the controls rather than stored.
   *
   * This is what makes the table live: there is no "generate" step to press and
   * no second copy of the result to fall out of step with the settings above
   * it. Re-scoring on every keystroke of a filter is affordable — the engine is
   * a few hundred arithmetic operations per company — and any table large
   * enough for that to matter would not fit on a screen anyway.
   */
  const { result, error } = useMemo<{ result: ScreenerResult | null; error: string }>(() => {
    if (!text.trim()) return { result: null, error: "" };
    try {
      return { result: screen(text, filters), error: "" };
    } catch (cause) {
      return { result: null, error: cause instanceof Error ? cause.message : "This table could not be read." };
    }
  }, [text, filters]);

  /** The filtered rows in the direction the reader asked for. */
  const rows = useMemo(
    () => result ? sortRowsBy(result.rows, sortKey, sortDirection) : [],
    [result, sortKey, sortDirection],
  );

  // Written on every change rather than on unmount: a reader who closes the tab
  // never unmounts anything, and losing the paste that way is the case this
  // exists to prevent.
  useEffect(() => {
    const state: StoredState = {
      text, preset, top, minScore, maxAlerts, capMin, grades, sectors,
      attractiveOnly, sweetSpotOnly, winsorise, sortKey, sortDirection,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* A full or blocked store is not worth an error. */ }
  }, [text, preset, top, minScore, maxAlerts, capMin, grades, sectors, attractiveOnly, sweetSpotOnly, winsorise, sortKey, sortDirection]);

  /** First click on a column shows its best rows; a second click flips it. */
  function sortBy(key: string) {
    setExpanded(null);
    if (key === sortKey) { setSortDirection((current) => current === "asc" ? "desc" : "asc"); return; }
    setSortKey(key);
    setSortDirection(naturalDirection(key));
  }

  /**
   * Scores the watchlist this application already holds.
   *
   * Every row is built from the stored digests and completed with the prices
   * fetched now, then handed to the engine as a table — the same text, under
   * the same column titles, entering by the same door as a paste. The engine is
   * not touched, called differently, or told where its rows came from.
   */
  // The reader's own list, named in the request. Asking for nothing scores the
  // built-in registry, which silently leaves out every company they added.
  const followed = tickers.join(",");
  const scoreWatchlist = useCallback(async () => {
    setFeeding("working");
    try {
      const response = await fetch(`/api/watchlist?tickers=${encodeURIComponent(followed)}`);
      const payload = await readJson<{ summaries?: WatchlistSummary[] }>(response, { what: "your watchlist" });
      const summaries = (payload.summaries ?? []).filter((item) => item.qs);
      if (!summaries.length) throw new Error("no summaries");

      const today = new Date().toISOString().slice(0, 10);
      const prices = await Promise.all(summaries.map(async (item) => {
        try {
          const priced = await fetch(`/api/price/${encodeURIComponent(item.ticker)}?date=${today}`);
          if (!priced.ok) return null;
          const point = await priced.json() as PricePoint;
          return point.priceClose ?? point.close ?? null;
        } catch { return null; }
      }));

      const rows: QsRow[] = summaries.map((item, index) => ({
        ticker: item.ticker,
        values: { ...item.qs, ...qsValuationColumns(item.qsPrice, prices[index]) },
      }));
      setText(qsTable(rows));
      setFeeding("");
    } catch {
      setFeeding("failed");
    }
  }, [followed]);

  async function readFile(file: File) {
    try { setText(await file.text()); setFileError(""); }
    catch { setFileError("That file could not be read."); }
  }

  function download() {
    if (!rows.length) return;
    const blob = new Blob([resultsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qs-screener-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const availableSectors = result ? sectorsOf(result.all) : [];
  const toggle = (list: string[], value: string, set: (next: string[]) => void) =>
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return <div className="qs-page">
    <header className="page-heading">
      <div>
        <h1>QS Screener</h1>
        <p>Four pillars, {QS_METRICS.length} weighted metrics and a letter grade. Score the watchlist this application already computes, or paste an export from fiscal.ai, Excel, Google Sheets or a CSV file. Everything runs in your browser — nothing is uploaded.</p>
      </div>
    </header>

    <section className="qs-source">
      <button type="button" className="button-primary" disabled={feeding === "working"} onClick={() => void scoreWatchlist()}>
        {feeding === "working" ? "Scoring your watchlist…" : "Score my watchlist"}
      </button>
      <button type="button" onClick={() => fileInput.current?.click()}>Open a CSV…</button>
      <button type="button" onClick={() => setText(EXAMPLE)}>Load an example</button>
      {text && <button type="button" onClick={() => { setText(""); setExpanded(null); }}>Clear</button>}
      <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv" hidden
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = ""; }}/>
      <small>
        {feeding === "failed"
          ? "Could not build the table from your watchlist. Paste an export below instead."
          : `Builds the table from the ${QS_COLUMNS.length} columns this application computes itself. Forward estimates are not among them: the engine drops a missing column and renormalises its weights.`}
      </small>
    </section>

    <details className="qs-paste" open={!text}>
      <summary>Paste a table<small>Comma, semicolon or tab — a copy-paste straight out of Excel is already tab-separated.</small></summary>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={7}
        placeholder={"Ticker,Market Cap,ROIC,ROIC 5Yr Avg,Operating Margin,...\nAAPL,3521.5,57.2,52.4,31.8,...\nMSFT,3188.2,29.1,28.8,44.6,..."}
        aria-label="Paste your table, keeping the first row of column titles"/>
      <small>Column titles are matched automatically — case, accents and spacing are ignored. <b>Ticker</b> is the only required one.</small>
    </details>

    {(error || fileError) && <p className="notice" role="alert">{error || fileError}</p>}

    {result && <>
      <section className="qs-controls" aria-label="Scoring settings">
        <label>Pillar weights
          <select value={preset} onChange={(event) => setPreset(event.target.value)}>
            {Object.entries(QS_PRESETS).map(([key, weights]) =>
              <option key={key} value={key}>
                {key === "defaut" ? "Default" : key === "quality-purist" ? "Quality purist" : "Value aware"}
                {` (${QS_PILLARS.map((pillar) => weights[pillar]).join(" / ")})`}
              </option>)}
          </select>
        </label>
        <label>Rank by
          <select value={sortKey} onChange={(event) => sortBy(event.target.value === sortKey ? sortKey : event.target.value)}>
            {QS_SORTS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label>Keep the top
          <input type="number" min={1} inputMode="numeric" value={top} placeholder="all" onChange={(event) => setTop(event.target.value)}/>
        </label>
        <label>Min. total
          <input type="number" inputMode="decimal" value={minScore} placeholder="any" onChange={(event) => setMinScore(event.target.value)}/>
        </label>
        <label>Max. alerts
          <input type="number" min={0} inputMode="numeric" value={maxAlerts} placeholder="any" onChange={(event) => setMaxAlerts(event.target.value)}/>
        </label>
        <label>Min. cap ($Bn)
          <input type="number" min={0} inputMode="decimal" value={capMin} placeholder="any" onChange={(event) => setCapMin(event.target.value)}/>
        </label>
      </section>

      <details className="qs-filters">
        <summary>Filters<small>{[grades.length && `${grades.length} grades`, sectors.length && `${sectors.length} sectors`, attractiveOnly && "attractive only", sweetSpotOnly && "sweet spot", !winsorise && "no winsorising"].filter(Boolean).join(" · ") || "none"}</small></summary>
        <div className="qs-filter-body">
          <fieldset>
            <legend>Grade</legend>
            <div className="qs-chips">
              {QS_GRADES.map((grade) => <button key={grade} type="button" className={`pill${grades.includes(grade) ? " active" : ""}`}
                aria-pressed={grades.includes(grade)} onClick={() => toggle(grades, grade, setGrades)}>{grade}</button>)}
            </div>
          </fieldset>
          {availableSectors.length > 1 && <fieldset>
            <legend>Sector</legend>
            <div className="qs-chips">
              {availableSectors.map((sector) => <button key={sector} type="button" className={`pill${sectors.includes(sector) ? " active" : ""}`}
                aria-pressed={sectors.includes(sector)} onClick={() => toggle(sectors, sector, setSectors)}>{sector}</button>)}
            </div>
          </fieldset>}
          <fieldset>
            <legend>Only show</legend>
            <div className="qs-switches">
              <label><input type="checkbox" checked={attractiveOnly} onChange={(event) => setAttractiveOnly(event.target.checked)}/> Attractively valued</label>
              <label><input type="checkbox" checked={sweetSpotOnly} onChange={(event) => setSweetSpotOnly(event.target.checked)}/> Sweet spot (quality, health and price)</label>
              <label><input type="checkbox" checked={winsorise} onChange={(event) => setWinsorise(event.target.checked)}/> Winsorise outliers before ranking</label>
            </div>
          </fieldset>
        </div>
      </details>

      {(result.missing.length > 0 || result.warnings.length > 0) && <p className="notice qs-notice">
        {result.missing.length > 0 && <>No company carried a usable value for {result.missing.map((key) => QS_METRIC_NAMES[key] ?? key).join(", ")}. The engine dropped {result.missing.length === 1 ? "it" : "them"} and renormalised the remaining weights, so these scores are not comparable with a run where {result.missing.length === 1 ? "it was" : "they were"} present. </>}
        {result.warnings.join(" ")}
      </p>}

      <section className="qs-summary" aria-label="How the score is built">
        {QS_PILLARS.map((pillar) => <article key={pillar}>
          <span>{pillar}</span>
          <strong>{result.weights[pillar]}<small>% of the total</small></strong>
          <small>{PILLAR_NOTE[pillar]}</small>
        </article>)}
      </section>

      <div className="qs-table-head">
        <p className="section-note">
          {rows.length} of {result.all.length} scored{rows.length !== result.all.length ? " after filters" : ""}.
          Percentiles are measured against every company in the table, so adding or removing one moves the others.
          A grade is withheld below {Math.round(QS_COVERAGE_FLOOR * 100)}% data coverage; each alert costs {QS_ALERT_PENALTY} points of the risk-adjusted score.
        </p>
        <button type="button" onClick={download} disabled={!rows.length}>Export CSV</button>
      </div>

      <div className="table-scroll qs-scroll">
        <table className="qs-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => <SortableHeader key={column.key} column={column}
                active={sortKey === column.key} direction={sortDirection} onSort={() => sortBy(column.key)}/>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <QsTableRow key={row.Ticker} row={row}
              open={expanded === row.Ticker}
              onToggle={() => setExpanded((current) => current === row.Ticker ? null : row.Ticker)}/>)}
          </tbody>
        </table>
      </div>

      {!rows.length && <p className="simple-state">No company passes these filters. Loosen one above.</p>}
    </>}
  </div>;
}

/**
 * One company, and the reasoning behind its score one click away.
 *
 * The strengths, weaknesses and alert detail were computed all along and were
 * only ever visible in the exported image's second page. They are the answer to
 * the question a ranked table provokes — why is this one above that one — so
 * they belong on the row itself.
 */
function QsTableRow({ row, open, onToggle }: { row: ScoredCompany; open: boolean; onToggle: () => void }) {
  const columns = 14;
  return <>
    <tr className={`qs-row${open ? " open" : ""}${row.sweet_spot ? " sweet" : ""}`}>
      <td className="qs-rank">{row.rang}</td>
      <th scope="row">
        <button type="button" className="qs-ticker" aria-expanded={open} onClick={onToggle}>
          {row.Ticker}
          {row.sweet_spot && <span className="qs-flag" title="Quality, health and price all clear their thresholds">sweet spot</span>}
        </button>
      </th>
      <td className="qs-sector">{row.Secteur}</td>
      <td className="numeric">{cap(row.Cap)}</td>
      {QS_PILLARS.map((pillar) => <ScoreCell key={pillar} value={row.piliers[pillar]}/>)}
      <ScoreCell value={row.total}/>
      <td><span className={`qs-grade grade-${row.note.replace("+", "plus").replace("-", "minus")}`}>{row.note}</span></td>
      <td><span className={`qs-valuation v-${row.valo_niveau}`}>{row.valuation}</span></td>
      <ScoreCell value={row.conviction}/>
      <ScoreCell value={row.couverture * 100} digits={0}/>
      <td className="numeric">{row.rang_secteur == null ? "—" : `${row.rang_secteur}/${row.taille_secteur ?? "—"}`}</td>
      <td className="numeric">{row.alertes ? <span className="qs-alerts">{row.alertes}</span> : "—"}</td>
      <td>{row.qv_median ? <span className="qs-check" aria-label="yes">✓</span> : <span className="qs-empty-mark" aria-label="no">·</span>}</td>
    </tr>
    {open && <tr className="qs-detail">
      <td colSpan={columns}>
        <div className="qs-detail-body">
          <div>
            <h4>Strengths</h4>
            {row.forces.length
              ? <ul>{row.forces.map(([name, score]) => <li key={name}><b>{name}</b> <span>{score.toFixed(0)}</span></li>)}</ul>
              : <p className="qs-none">Nothing scored above 70 against this universe.</p>}
          </div>
          <div>
            <h4>Weaknesses</h4>
            {row.faiblesses.length
              ? <ul>{row.faiblesses.map(([name, score]) => <li key={name}><b>{name}</b> <span>{score.toFixed(0)}</span></li>)}</ul>
              : <p className="qs-none">Nothing scored below 30 against this universe.</p>}
          </div>
          <div>
            <h4>Alerts</h4>
            {row.alertes_detail.length
              ? <ul>{row.alertes_detail.map((alert) => <li key={alert}><b className="error-text">{alert}</b></li>)}</ul>
              : <p className="qs-none">None of the alert rules fired.</p>}
          </div>
          <div className="qs-detail-wide">
            <h4>Data coverage</h4>
            <p className="qs-none">
              {(row.couverture * 100).toFixed(0)}% of the weighted metrics were available for {row.Ticker}.
              {row.note === "NR" && ` Below the ${Math.round(QS_COVERAGE_FLOOR * 100)}% floor, so no grade is given.`}
              {row.forces[0] && ` Its strongest reading is ${QS_METRIC_NOTES[Object.keys(QS_METRIC_NAMES).find((key) => QS_METRIC_NAMES[key] === row.forces[0][0]) ?? ""] ?? row.forces[0][0]}`}
            </p>
          </div>
        </div>
      </td>
    </tr>}
  </>;
}
