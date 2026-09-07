"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { QS_COLUMNS, qsTable, qsValuationColumns, type QsRow } from "@/lib/qs-export";
import {
  naturalDirection, QS_ALERT_PENALTY, QS_ALERT_RULES, QS_ANCHORS, QS_COVERAGE_FLOOR,
  QS_GRADE_BANDS, QS_METRIC_NAMES, QS_METRIC_NOTES, QS_METRICS, QS_PILLARS, QS_PRESETS,
  QS_STAR_BANDS, QS_STARS, screen, sortRowsBy, valuationStars,
  type PillarName, type PresetName, type ScoredCompany, type SortDirection,
} from "@/lib/qs/screener";
import type { PricePoint } from "@/lib/types";
import { KEY_VERSION } from "@/lib/data-version";
import { stated } from "@/lib/sector";
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

interface Feed { rows: ScoredCompany[]; missing: string[]; warnings: string[]; asked: number; answered: number; source: "watchlist" | "pasted" }

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
interface Column {
  sort: string;
  label: string;
  read: (row: ScoredCompany) => ReactNode;
  empty: (row: ScoredCompany) => boolean;
  /** Drawn rather than written, and therefore centred rather than right-aligned. */
  drawn?: boolean;
}

const COLUMNS: Column[] = [
  { sort: "note", label: "Grade", read: (row) => row.note, empty: (row) => row.note === "NR" },
  { sort: "total", label: "Score", read: (row) => (row.total == null ? ABSENT : row.total.toFixed(1)), empty: (row) => row.total == null },
  /*
   * Three pillars as bars, and the fourth as stars.
   *
   * Value had a column of its own beside a "Valuation" column struck from it,
   * which was the same score twice: a bar at 31 and one lit star said one
   * thing, in two widths of table. The stars take the pillar's place in the
   * row — between Growth and Coverage, where Value stood — so the four pillars
   * still read left to right in the engine's own order, and the last of them
   * is read as the verdict it was always turned into.
   */
  ...QS_PILLARS.filter((pillar) => pillar !== "Value").map((pillar) => ({
    sort: pillar as string,
    label: pillar as string,
    read: (row: ScoredCompany) => <Meter value={row.piliers[pillar]} label={pillar} />,
    empty: (row: ScoredCompany) => row.piliers[pillar] == null,
    drawn: true,
  })),
  { sort: "etoiles", label: "Valuation", read: (row) => <Stars row={row} />, empty: (row) => row.piliers.Value == null, drawn: true },
  { sort: "couverture", label: "Coverage", read: (row) => percent(row.couverture, 0), empty: () => false },
  { sort: "alertes", label: "Alerts", read: (row) => String(row.alertes), empty: (row) => row.alertes === 0 },
  { sort: "cap", label: "Market cap", read: (row) => (row.Cap == null ? ABSENT : money(row.Cap * 1e9, "USD")), empty: (row) => row.Cap == null },
];

/**
 * A pillar score as a length, and only as a length.
 *
 * Four columns of two-digit numbers ask the reader to compare quantities by
 * reading them; a bar is compared by looking. The figure is not printed beside
 * it — two readings of the same score in one cell is the crowding the bar was
 * meant to remove — but it is not lost either: it is on the cell, for a hover
 * and for a screen reader, and the Score column beside it is the number in
 * full.
 *
 * One ink, as everywhere else on this site: the track is the page's soft plot
 * fill and the bar is its ink. Nothing about a colour says "good" here.
 */
function Meter({ value, label }: { value: number | null; label: string }) {
  if (value == null || !Number.isFinite(value)) return <span className="meter-absent">{ABSENT}</span>;
  const width = Math.max(0, Math.min(100, value));
  return (
    <span
      className="meter"
      role="img"
      aria-label={`${label} ${value.toFixed(0)} out of 100`}
      title={`${label} ${value.toFixed(0)} out of 100`}
    >
      <span className="meter-track" aria-hidden="true"><span style={{ width: `${width}%` }} /></span>
    </span>
  );
}

/**
 * The valuation as five stars, cheapest first.
 *
 * It is the Value pillar read as a verdict — which is what the column always
 * was, when it said "Attractive", "Fair" or "Expensive". Five bands instead of
 * three separate the merely fair from the nearly cheap without inventing a
 * second measurement: the band edges are the engine's own, and the named level
 * travels with the stars so the two can never disagree.
 */
function Stars({ row }: { row: ScoredCompany }) {
  const stars = valuationStars(row.piliers.Value);
  if (stars == null) return <span className="meter-absent">{ABSENT}</span>;
  return (
    <span
      className="stars"
      role="img"
      aria-label={`${stars} of ${QS_STARS} stars, ${row.valuation}`}
      title={`${row.valuation} · Value pillar ${row.piliers.Value!.toFixed(0)} of 100`}
    >
      {Array.from({ length: QS_STARS }, (_, index) => (
        <span key={index} aria-hidden="true" data-lit={index < stars}>★</span>
      ))}
    </span>
  );
}

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
      return { kind: "ready", feed: { rows: result.all, missing: result.missing, warnings: result.warnings, asked: result.all.length, answered: result.all.length, source: "pasted" } };
    } catch (error) {
      return { kind: "failed", message: error instanceof Error ? error.message : "That table could not be read." };
    }
  }, [pasted, preset]);

  const scoringPasted = pasted.trim().length > 0;

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
  useEffect(() => {
    const controller = new AbortController();
    const asked = followed ? followed.split(",") : [];
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const build = async () => {
      try {
        // The version travels in the URL as well as in the key: a digest built
        // under corrected semantics must not sit behind a copy the reader's own
        // browser was told it could keep for a day.
        const response = await fetch(`/api/watchlist?tickers=${encodeURIComponent(followed)}&v=${KEY_VERSION}`, { signal: controller.signal });
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
      return { kind: "ready", feed: { rows: result.all, missing: result.missing, warnings: result.warnings, asked: built.asked, answered: built.answered, source: "watchlist" } };
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
  const nativeAuditState = watchlistState ?? waiting;

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
        {state.kind === "ready" && state.feed.source === "pasted" ? (
          <SourceAudit imported={state.feed} native={nativeAuditState} pasted={pasted} />
        ) : null}
      </section>

      <Paste value={pasted} onChange={setPasted} />

      <Method preset={preset} />
    </main>
  );
}

const AUDIT_PERCENT = new Set(["ROIC", "ROIC5", "OpM", "FCFM5", "FCF_NI", "GM5", "ShOut5", "SBC", "Rev5", "RevFwd3", "LevFCF5", "NI5", "RevPS5", "FCFPS5", "FCFYield"]);

const auditValue = (key: string, value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  return AUDIT_PERCENT.has(key) ? `${value.toFixed(1)}%` : `${value.toFixed(2)}×`;
};

const materiallyDifferent = (left: number | null | undefined, right: number | null | undefined) => {
  if (left == null || right == null) return left !== right;
  return Math.abs(left - right) > Math.max(0.01, Math.abs(left) * 0.01);
};

/**
 * A pasted score is deliberately not merged into FinScope's SEC facts.
 * This audit holds the two completed answers beside each other, for companies
 * present in both lists, and lets the reader see which inputs explain a gap.
 */
function SourceAudit({ imported, native, pasted }: { imported: Feed; native: State; pasted: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const fiscalCompatible = /forward\s*p\s*\/\s*fcf|revenue\s*forward\s*3y|levered\s*(free\s*cash\s*flow|fcf)/i.test(pasted);
  const sourceName = fiscalCompatible ? "Fiscal.ai-compatible import" : "Imported table";
  const nativeRows = native.kind === "ready" ? new Map(native.feed.rows.map((row) => [row.Ticker.toUpperCase(), row])) : new Map<string, ScoredCompany>();
  const pairs = imported.rows.flatMap((external) => {
    const core = nativeRows.get(external.Ticker.toUpperCase());
    return core ? [{ ticker: external.Ticker, core, external }] : [];
  });
  const chosen = pairs.find((pair) => pair.ticker === selected) ?? null;
  const differences = chosen ? QS_METRICS.filter((metric) => materiallyDifferent(chosen.core.brut[metric.cle], chosen.external.brut[metric.cle])) : [];

  return (
    <section className="source-audit" aria-labelledby="source-audit-title">
      <div className="section-head">
        <div>
          <h2 className="label" id="source-audit-title">Source comparison</h2>
          <p className="stat-note">The imported values stay untouched. FinScope remains a separate SEC-based score; neither source fills the other’s gaps.</p>
        </div>
        <span className="label">{sourceName}</span>
      </div>

      {native.kind === "building" ? (
        <p className="stat-note">Preparing the native comparison · {native.ready} of {native.asked} companies</p>
      ) : native.kind === "failed" ? (
        <p className="stat-note">Native comparison unavailable: {native.message}</p>
      ) : !pairs.length ? (
        <p className="stat-note">No imported ticker is also present in your current FinScope watchlist.</p>
      ) : (
        <>
          <div className="sheet source-audit-sheet">
            <table>
              <thead><tr><th className="key">Company</th><th>FinScope · SEC</th><th>{sourceName}</th><th>Difference</th><th>Inputs that differ</th></tr></thead>
              <tbody>
                {pairs.map(({ ticker, core, external }) => {
                  const changed = QS_METRICS.filter((metric) => materiallyDifferent(core.brut[metric.cle], external.brut[metric.cle])).length;
                  const delta = core.total == null || external.total == null ? null : external.total - core.total;
                  return (
                    <tr key={ticker} data-selected={selected === ticker}>
                      {/* A row label is a row label: the same column, face,
                          weight and alignment the scored table gives a ticker,
                          not a bold right-aligned heading beside it. */}
                      <th className="key" scope="row"><button type="button" className="key-open" onClick={() => setSelected((current) => current === ticker ? null : ticker)}>{ticker}</button></th>
                      <td>{core.note}{core.total == null ? "" : ` · ${core.total.toFixed(1)}`}</td>
                      <td>{external.note}{external.total == null ? "" : ` · ${external.total.toFixed(1)}`}</td>
                      <td data-dir={delta == null ? undefined : delta >= 0 ? "up" : "down"}>{delta == null ? ABSENT : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}</td>
                      <td>{changed}<span className="dim"> · inspect</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {chosen ? (
            <div className="source-differences">
              <div className="section-head">
                <h3 className="label">{chosen.ticker} · differing inputs</h3>
                <span className="label">{differences.length} measures</span>
              </div>
              <div className="sheet">
                <table>
                  <thead><tr><th className="key">Measure</th><th>FinScope · SEC</th><th>{sourceName}</th><th>FinScope metric score</th><th>Imported metric score</th></tr></thead>
                  <tbody>
                    {differences.map((metric) => (
                      <tr key={metric.cle}>
                        <th className="key" scope="row">{QS_METRIC_NAMES[metric.cle] ?? metric.cle}</th>
                        <td>{auditValue(metric.cle, chosen.core.brut[metric.cle])}</td>
                        <td>{auditValue(metric.cle, chosen.external.brut[metric.cle])}</td>
                        <td>{chosen.core.score_metrique[metric.cle] == null ? ABSENT : chosen.core.score_metrique[metric.cle]!.toFixed(0)}</td>
                        <td>{chosen.external.score_metrique[metric.cle] == null ? ABSENT : chosen.external.score_metrique[metric.cle]!.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {fiscalCompatible ? <p className="stat-note source-caveat">Fiscal.ai exports may define Levered FCF differently from FinScope’s historical FCF (operating cash flow − capex). Both values are preserved and shown; they are never silently substituted.</p> : null}
            </div>
          ) : null}
        </>
      )}
      {imported.warnings.length ? <p className="stat-note">Import notes: {imported.warnings.join(" ")}</p> : null}
    </section>
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

  const header = (key: string, label: string, drawn?: boolean) => (
    <th
      key={key}
      scope="col"
      data-drawn={drawn || undefined}
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
              {COLUMNS.map((column) => header(column.sort, column.label, column.drawn))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.Ticker}>
                <th className="key" scope="row">
                  <a className="key-open" href={`/s/${encodeURIComponent(row.Ticker)}`}>
                    <span className="screener-rank">{index + 1}</span>
                    {row.Ticker}
                    {/* A sector we do not know is not a sector called
                        "Unclassified": the filer's own classification is
                        missing, and a blank says that better than a word. */}
                    <span className="screener-sector">{stated(row.Secteur)}</span>
                  </a>
                </th>
                {COLUMNS.map((column) => (
                  <td key={column.sort} data-empty={column.empty(row)} data-drawn={column.drawn || undefined}>{column.read(row)}</td>
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
 * What the columns above are, written from the engine rather than about it.
 *
 * Every figure in this section is read out of the scoring configuration at
 * render time — the pillar weights of the preset in force, the metrics each
 * pillar holds and their weight inside it, the value each metric has to reach
 * to score nought, fifty or a hundred, the letter bands, the alert rules. None
 * of it is prose repeating a constant, so none of it can fall out of step with
 * the score the table just struck.
 *
 * It folds. The site's rule is that pedagogy hides behind a word and facts do
 * not; a reader who wants to know what Quality counts opens Quality, and the
 * table is not pushed down a screen for everyone else.
 */
function Method({ preset }: { preset: PresetName }) {
  const weights = QS_PRESETS[preset];
  const [open, setOpen] = useState(false);

  return (
    <section className="section method">
      <div className="section-head">
        <h2 className="label">How a company is scored</h2>
        <button className="metric-toggle" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
          {open ? "Hide" : "Read the method"}
        </button>
      </div>

      <p className="stat-note method-lead">
        Each of the {QS_METRICS.length} measures is read against a fixed scale, not against the other companies in the
        table: the same ROIC earns the same mark whether it is scored alone or beside five hundred others. The measures
        make four pillars, the pillars are weighted into one score out of 100, and that score becomes a letter. A
        company carrying less than {Math.round(QS_COVERAGE_FLOOR * 100)}% of the measures is left unrated rather than
        graded on what happens to be there.
      </p>

      {open ? (
        <div className="method-body">
          <div className="method-pillars">
            {QS_PILLARS.map((pillar) => (
              <PillarMethod key={pillar} pillar={pillar} weight={weights[pillar]} />
            ))}
          </div>

          <div className="method-scales">
            <section className="method-scale">
              <h3 className="label">The bars, out of 100</h3>
              <p className="stat-note">
                A pillar bar is the weighted average of its measures, each on the same nought-to-a-hundred scale: 0 is
                broken, 50 is what a solid listed company reads, 100 is exceptional and rare. Half a bar is not half of
                anything the company owns — it is the mark, drawn. Three pillars are drawn this way; the fourth is the
                stars.
              </p>
            </section>

            <section className="method-scale">
              <h3 className="label">The stars</h3>
              <p className="stat-note">
                The stars are the fourth pillar. Value is the only one of the four that is not a judgement about the
                company but about its price, so it is shown as the verdict it becomes: the same score out of 100, in
                five bands. Five stars is the cheapest, one the dearest. Cheap is not good — a company can be five
                stars because the market doubts its cash flows.
              </p>
              <ul className="method-list">
                {QS_STAR_BANDS.map(([stars, floor, name]) => (
                  <li key={stars}>
                    <span className="stars" aria-hidden="true">
                      {Array.from({ length: QS_STARS }, (_, index) => <span key={index} data-lit={index < stars}>★</span>)}
                    </span>
                    <span className="method-band">Value {floor} and above</span>
                    <span className="method-band-name">{name}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="method-scale">
              <h3 className="label">The letter</h3>
              <ul className="method-list method-grades">
                {QS_GRADE_BANDS.map(([grade, floor]) => (
                  <li key={grade}><b>{grade}</b><span className="method-band">{floor} and above</span></li>
                ))}
                <li><b>NR</b><span className="method-band">under {Math.round(QS_COVERAGE_FLOOR * 100)}% coverage</span></li>
              </ul>
            </section>

            <section className="method-scale">
              <h3 className="label">The alerts</h3>
              <p className="stat-note">
                An alert never moves the score in the table. It is a flag on a reading that would worry an analyst, and
                it costs {QS_ALERT_PENALTY} points of the risk-adjusted score kept in the export.
              </p>
              <ul className="method-list method-alerts">
                {QS_ALERT_RULES.map(([label, key, operator, threshold]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <span className="method-band">{QS_METRIC_NAMES[key] ?? key} {operator} {threshold}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * One pillar: what it weighs, what it counts, and where each measure's scale sits.
 *
 * The three anchors are the whole of the notation system in one line — the
 * value scored 0, the value scored 50 and the value scored 100 — so a reader
 * can see that a 15% ROIC is deliberately worth fifty rather than wonder why it
 * is not worth more. Between two anchors the mark is interpolated.
 */
function PillarMethod({ pillar, weight }: { pillar: PillarName; weight: number }) {
  const metrics = QS_METRICS.filter((metric) => metric.pilier === pillar);
  return (
    <details className="method-pillar">
      <summary>
        <span className="method-pillar-name">{pillar}</span>
        <span className="method-band">{weight}% of the score · {metrics.length} measures</span>
      </summary>
      <div className="sheet method-sheet">
        <table>
          <thead>
            <tr><th className="key">Measure</th><th>Weight</th><th>Scores 0</th><th>Scores 50</th><th>Scores 100</th></tr>
          </thead>
          <tbody>
            {metrics.map((metric) => {
              const anchors = QS_ANCHORS[metric.cle];
              return (
                <tr key={metric.cle}>
                  <th className="key" scope="row">
                    <span className="method-measure">{QS_METRIC_NAMES[metric.cle] ?? metric.cle}</span>
                    <small>{QS_METRIC_NOTES[metric.cle]}</small>
                  </th>
                  <td>{metric.poids}%</td>
                  {(anchors ?? [null, null, null]).map((anchor, index) => (
                    <td key={index} data-empty={anchor == null}>{auditValue(metric.cle, anchor)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
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
              Fiscal.ai forward revenue, Forward P/FCF and Levered FCF columns remain supported when present.
            </p>
            {value ? <button className="metric-toggle" type="button" onClick={() => onChange("")}>Back to my watchlist</button> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
