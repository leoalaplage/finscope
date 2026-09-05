"use client";

import { useEffect, useMemo, useState } from "react";
import { KEY_VERSION } from "@/lib/data-version";
import {
  concentration, DAILY_WINDOWS, overWindow, portfolioExposure, portfolioQuality, portfolioSeries, rebasePair, seriesStats, valuePortfolio, weightBy, WINDOWS,
  type Position, type SeriesPoint, type ValuedPosition, type WindowId,
} from "@/lib/portfolio";
import { qsTable, qsValuationColumns, type QsRow } from "@/lib/qs-export";
import { gradeForScore, QS_COVERAGE_FLOOR, screen, type ScoredCompany } from "@/lib/qs/screener";
import { stated } from "@/lib/sector";
import { summarySector, type WatchlistSummary } from "@/lib/watchlist-summary";
import { parseHoldings, saveHoldings, useStoredHoldings, writeHoldings } from "./holdings";
import { MultiLine } from "./Plot";
import type { IoQuote } from "./quote";
import { ABSENT, delta, direction, money, percent, price as writePrice, ratio, shortDate } from "./format";

/**
 * What you own, read through to the businesses underneath it.
 *
 * A brokerage tells you what your shares are worth. Nothing tells you what they
 * *are*: how much revenue and free cash flow your money has a claim on, what
 * you are paying for it, and how much of the book rests on one company. Every
 * figure here is your fraction of a filed one — your shares over the shares in
 * issue, times what the company reported — so a portfolio is read exactly the
 * way a company is read everywhere else on this site.
 *
 * The book never leaves the browser. It is stored on this device, valued here
 * from digests that were public before anyone typed anything in, and nothing
 * about it is sent anywhere.
 */

/** The one currency this page adds up in; a filer quoted in another is named. */
const BASE_CURRENCY = "USD";

/**
 * The index a book is measured against, and the two series it is drawn from.
 *
 * One benchmark, and it is the one everybody means. Two granularities, because
 * one cannot serve both ends of the range: ten years of weekly closes is the
 * long picture, and thirteen months of daily ones is what a month or a year to
 * date has to be drawn from — four weekly points is not a shape anybody can
 * read. Both are asked for once, so moving between windows costs nothing.
 */
const BENCHMARK = { symbol: "^GSPC", label: "S&P 500" };
const HISTORY_YEARS = 10;
const DAILY_DAYS = 400;

/**
 * What was fetched, and which book it was fetched for.
 *
 * The book names itself in the answer, the way every state on the company page
 * names its company: a reader who edits their holdings has figures in hand that
 * are not this book's, and a feed that says which book it is simply is not the
 * new one rather than being cleared by an effect a render later.
 */
interface Feed {
  book: string;
  summaries: Record<string, WatchlistSummary | undefined>;
  quotes: Record<string, IoQuote | undefined>;
  pending: string[];
}

const EMPTY_FEED: Feed = { book: "", summaries: {}, quotes: {}, pending: [] };

/** One granularity of closes: every holding's, and the index's. */
interface Closes { holdings: Record<string, SeriesPoint[]>; index: SeriesPoint[] }

/** Both granularities, and the book they were fetched for. */
interface Prices { book: string; weekly: Closes; daily: Closes }

export function Portfolio() {
  const held = useStoredHoldings();
  const [session, setSession] = useState<Position[] | null>(null);
  const positions = session ?? held;
  const [fetched, setFetched] = useState<Feed>(EMPTY_FEED);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sort, setSort] = useState<"value" | "ticker">("value");
  const [span, setSpan] = useState<WindowId>("5Y");
  const [hover, setHover] = useState<number | null>(null);
  const [history, setHistory] = useState<Prices | null>(null);

  const followed = positions.map((position) => position.ticker).join(",");
  const feed = fetched.book === followed ? fetched : EMPTY_FEED;

  /*
   * One read for the filings, one read a company for the prices.
   *
   * The digests carry everything the look-through figures are struck from — the
   * share count, the revenue, the free cash flow, the screener's row — in a few
   * hundred bytes each. Only the last price has to be asked for per company,
   * and it is the one thing on this page that is not settled.
   */
  useEffect(() => {
    if (!followed) return;
    const controller = new AbortController();
    const tickers = followed.split(",");
    (async () => {
      try {
        const response = await fetch(`/api/watchlist?tickers=${encodeURIComponent(followed)}&v=${KEY_VERSION}`, { signal: controller.signal });
        const payload = response.ok
          ? await response.json() as { summaries?: WatchlistSummary[]; pending?: string[] }
          : { summaries: [], pending: tickers };
        const summaries: Feed["summaries"] = {};
        for (const summary of payload.summaries ?? []) summaries[summary.ticker.toUpperCase()] = summary;

        const quotes: Feed["quotes"] = {};
        await Promise.all(tickers.map(async (ticker) => {
          try {
            const quoted = await fetch(`/api/io/${encodeURIComponent(ticker)}/quote`, { signal: controller.signal });
            if (quoted.ok) quotes[ticker] = await quoted.json() as IoQuote;
          } catch { /* A holding with no price is listed, and left out of the weights. */ }
        }));
        if (controller.signal.aborted) return;
        setFetched({ book: followed, summaries, quotes, pending: payload.pending ?? [] });
      } catch {
        if (!controller.signal.aborted) setFetched({ book: followed, summaries: {}, quotes: {}, pending: tickers });
      }
    })();
    return () => controller.abort();
  }, [followed]);

  /*
   * The closes behind the picture, both granularities, asked once.
   *
   * Sliced locally afterwards, so moving between windows is instant and costs
   * the network nothing. Every one of these is a cache key the market endpoint
   * already keeps warm — the same series the company pages draw.
   */
  useEffect(() => {
    if (!followed) return;
    const controller = new AbortController();
    const tickers = followed.split(",");
    const today = new Date();
    const day = (millis: number) => new Date(today.getTime() - millis).toISOString().slice(0, 10);
    const end = today.toISOString().slice(0, 10);
    const windows = {
      weekly: `frequency=weekly&start=${day(HISTORY_YEARS * 365.25 * 86_400_000)}&end=${end}`,
      daily: `frequency=daily&start=${day(DAILY_DAYS * 86_400_000)}&end=${end}`,
    };
    const read = async (symbol: string, window: string): Promise<SeriesPoint[]> => {
      try {
        const response = await fetch(`/api/market/${encodeURIComponent(symbol)}?${window}`, { signal: controller.signal });
        if (!response.ok) return [];
        const body = await response.json() as { bars: Array<{ date: string; close: number | null }> };
        // The split-adjusted close, which is what the shares held today were
        // worth then. Neither line carries dividends, and the note says so.
        return body.bars.flatMap((bar) => (bar.close != null && Number.isFinite(bar.close) ? [{ date: bar.date, value: bar.close }] : []));
      } catch {
        return [];
      }
    };
    (async () => {
      const [weekly, daily] = await Promise.all(([windows.weekly, windows.daily] as const).map(async (window) => {
        const [index, ...series] = await Promise.all([read(BENCHMARK.symbol, window), ...tickers.map((ticker) => read(ticker, window))]);
        const holdings: Record<string, SeriesPoint[]> = {};
        tickers.forEach((ticker, at) => { holdings[ticker] = series[at]; });
        return { holdings, index };
      }));
      if (controller.signal.aborted) return;
      setHistory({ book: followed, weekly, daily });
    })();
    return () => controller.abort();
  }, [followed]);

  /*
   * The book, valued.
   *
   * A price quoted in a currency the statements are not kept in is not a price
   * this page may add to a total — no rate is applied to a filed figure
   * anywhere in this application — so such a holding is priced at nothing here
   * and named underneath instead of being converted quietly.
   */
  const valued = useMemo(() => {
    const prices: Record<string, number | null> = {};
    const names: Record<string, { name: string; sector: string }> = {};
    for (const position of positions) {
      const quote = feed.quotes[position.ticker];
      const summary = feed.summaries[position.ticker];
      const usable = quote?.price != null && Number.isFinite(quote.price) && quote.price > 0 && quote.currency === BASE_CURRENCY;
      prices[position.ticker] = usable ? quote!.price : null;
      names[position.ticker] = {
        name: summary?.name ?? quote?.name ?? position.ticker,
        sector: (summary ? summarySector(summary) : null) ?? "",
      };
    }
    return valuePortfolio(positions, feed.summaries, prices, names);
  }, [positions, feed]);

  /*
   * Your share of what these companies actually earned.
   *
   * Ownership is your shares over the shares in issue, and every look-through
   * figure is that fraction of a filed one. A holding whose company has not
   * been built yet contributes nothing and is counted out of the coverage
   * rather than treated as a company with no revenue.
   */
  const lookThrough = useMemo(() => {
    let revenue = 0; let freeCashFlow = 0; let netDebt = 0; let covered = 0; let debtCovered = 0;
    for (const position of valued.positions) {
      const summary = position.summary;
      if (!summary?.shares || position.value == null) continue;
      const ownership = position.shares / summary.shares;
      if (!Number.isFinite(ownership) || ownership <= 0) continue;
      if (summary.revenue == null || summary.freeCashFlow == null) continue;
      revenue += ownership * summary.revenue;
      freeCashFlow += ownership * summary.freeCashFlow;
      covered += position.value;
      if (summary.netDebt != null) { netDebt += ownership * summary.netDebt; debtCovered += position.value; }
    }
    return {
      revenue, freeCashFlow, netDebt: debtCovered > 0 ? netDebt : null, covered,
      coverage: valued.value > 0 ? covered / valued.value : 0,
      yield: covered > 0 && freeCashFlow > 0 ? freeCashFlow / covered : null,
      multiple: freeCashFlow > 0 ? covered / freeCashFlow : null,
    };
  }, [valued]);

  /** The day, in money and in proportion, over the holdings that have a price. */
  const day = useMemo(() => {
    let moved = 0; let opened = 0;
    const parts: Array<{ ticker: string; moved: number }> = [];
    for (const position of valued.positions) {
      const quote = feed.quotes[position.ticker];
      if (position.value == null || quote?.previousClose == null || quote.changePercent == null) continue;
      const yesterday = quote.previousClose * position.shares;
      const change = position.value - yesterday;
      moved += change;
      opened += yesterday;
      parts.push({ ticker: position.ticker, moved: change });
    }
    return opened > 0 ? {
      moved,
      percent: moved / opened,
      contributions: Object.fromEntries(parts.map((part) => [part.ticker, part.moved / opened])),
    } : null;
  }, [valued, feed]);

  /*
   * Each holding's grade, from the engine that grades everything else.
   *
   * The same digests, the same table, the same door a pasted export uses. A
   * portfolio of good companies bought at any price is a different object from
   * a portfolio of cheap ones, and the grade is what the rest of the site
   * already says about each of them.
   */
  const graded = useMemo(() => {
    const rows: QsRow[] = valued.positions.flatMap((position) => {
      const summary = position.summary;
      const quote = feed.quotes[position.ticker];
      if (!summary?.qs) return [];
      return [{
        ticker: summary.ticker,
        values: { ...summary.qs, ...qsValuationColumns(summary.qsPrice, quote?.price ?? null, quote?.currency) },
      }];
    });
    if (!rows.length) return {} as Record<string, ScoredCompany | undefined>;
    try {
      const scored: Record<string, ScoredCompany | undefined> = {};
      for (const row of screen(qsTable(rows)).all) scored[row.Ticker.toUpperCase()] = row;
      return scored;
    } catch {
      return {} as Record<string, ScoredCompany | undefined>;
    }
  }, [valued, feed]);

  /** The book's score: each holding's, weighted by what it is worth. */
  const score = useMemo(() => {
    const quality = portfolioQuality(valued.positions, (position) => {
      const row = graded[position.ticker];
      return row?.note === "NR" ? null : row?.total;
    });
    const value = quality.value;
    return value == null ? null : {
      ...quality,
      value,
      grade: quality.coverage >= QS_COVERAGE_FLOOR ? gradeForScore(value) : "NR",
    };
  }, [valued, graded]);

  /*
   * The book against the index, both from a hundred at the same week.
   *
   * This is the book as it stands today, priced back through time — the shares
   * held now, at the closes of every week since. It is not a record of what was
   * bought and sold, and it does not pretend to be one: a return that depends
   * on when each lot was bought is a different question, and answering it from
   * a list of holdings would mean inventing the dates.
   *
   * Only weeks every holding traded on are used, because a portfolio line drawn
   * while part of the portfolio did not exist is not a portfolio line. A
   * company that listed two years ago therefore starts the picture, and the
   * note under it says which one and when.
   */
  const against = useMemo(() => {
    if (!history || history.book !== followed) return null;
    // The daily series where the window is short enough to need one, and the
    // weekly wherever the daily one came back empty.
    const fine = DAILY_WINDOWS.has(span) && history.daily.index.length > 0;
    const closes = fine ? history.daily : history.weekly;
    if (!closes.index.length) return null;
    const whole = portfolioSeries(positions, closes.holdings);
    const asked = overWindow(whole, span);
    const paired = rebasePair(asked, closes.index);
    if (paired.length < 2) return null;
    const book = paired.map((point) => ({ date: point.date, value: point.portfolio }));
    const index = paired.map((point) => ({ date: point.date, value: point.benchmark }));
    return {
      points: paired,
      // The book is the subject and the index is what it is held against, so
      // one is filled and the other is a line beside it.
      series: [{ label: "Portfolio", points: book, area: true }, { label: BENCHMARK.label, points: index }],
      book: seriesStats(book),
      index: seriesStats(index),
      // What the window asked for against what the holdings can support.
      short: asked.length > 0 && paired[0].date > asked[0].date,
      youngest: [...positions]
        .map((position) => ({ ticker: position.ticker, from: closes.holdings[position.ticker]?.[0]?.date ?? null }))
        .filter((entry): entry is { ticker: string; from: string } => entry.from != null)
        .sort((left, right) => right.from.localeCompare(left.from))[0] ?? null,
    };
  }, [history, followed, positions, span]);

  const sectors = useMemo(
    () => weightBy(valued.positions, (position) => stated(position.sector) ?? "Not classified"),
    [valued],
  );
  const spread = useMemo(() => concentration(valued.positions), [valued]);
  const riskExposures = useMemo(() => {
    const exposures: Array<{ label: string; weight: number; tickers: string[] }> = [];
    const priced = valued.positions.filter((position) => position.weight != null && position.weight > 0);
    const add = (label: string, selected: ValuedPosition[]) => {
      const weight = selected.reduce((sum, position) => sum + (position.weight ?? 0), 0);
      if (weight > 0) exposures.push({ label, weight, tickers: selected.map((position) => position.ticker) });
    };
    const largest = [...priced].sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0))[0];
    if (largest) exposures.push({ label: "Largest holding", weight: largest.weight!, tickers: [largest.ticker] });
    if (sectors[0]) {
      exposures.push({
        label: "Largest sector",
        weight: sectors[0].weight,
        tickers: priced
          .filter((position) => (stated(position.sector) ?? "Not classified") === sectors[0].label)
          .map((position) => position.ticker),
      });
    }
    add("Quality below B", priced.filter((position) => ["B-", "C", "D"].includes(graded[position.ticker]?.note ?? "")));
    const unscored = portfolioExposure(priced, (position) => graded[position.ticker]?.note === "NR" || graded[position.ticker]?.total == null);
    if (unscored > 0) exposures.push({
      label: "Quality not rated",
      weight: unscored,
      tickers: priced.filter((position) => graded[position.ticker]?.note === "NR" || graded[position.ticker]?.total == null).map((position) => position.ticker),
    });
    const alerts = new Set(priced.flatMap((position) => graded[position.ticker]?.alertes_detail ?? []));
    for (const alert of alerts) {
      add(alert, priced.filter((position) => graded[position.ticker]?.alertes_detail.includes(alert)));
    }
    return exposures;
  }, [valued, graded, sectors]);

  const rows = useMemo(() => {
    const ordered = [...valued.positions];
    ordered.sort((left, right) => sort === "ticker"
      ? left.ticker.localeCompare(right.ticker)
      : (right.value ?? -1) - (left.value ?? -1));
    return ordered;
  }, [valued, sort]);

  const openEditor = () => { setDraft(writeHoldings(positions)); setEditing(true); };
  const save = () => {
    const parsed = parseHoldings(draft);
    setSession(parsed);
    saveHoldings(parsed);
    setEditing(false);
  };

  const unpriced = valued.unpriced;
  const building = feed.pending.filter((ticker) => positions.some((position) => position.ticker === ticker));
  const foreign = positions
    .filter((position) => { const quote = feed.quotes[position.ticker]; return quote?.currency != null && quote.currency !== BASE_CURRENCY; })
    .map((position) => position.ticker);

  return (
    <main className="wrap">
      <header className="head">
        <div className="head-row">
          <div>
            <div className="head-id">
              <h1 className="head-ticker">Portfolio</h1>
              <p className="head-name">{positions.length ? `${positions.length} ${positions.length === 1 ? "holding" : "holdings"}` : "Nothing held yet"}</p>
            </div>
            <div className="head-meta">
              <span className="label">Valued in your browser</span>
              <button className="label head-compare" type="button" onClick={openEditor}>Edit holdings →</button>
            </div>
          </div>

          {/* An empty book has no value to state, and two dashes where a
              total belongs read as a page that failed rather than one with
              nothing in it yet. */}
          {positions.length ? (
            <div className="price-block">
              <div className="price">{valued.value > 0 ? money(valued.value, BASE_CURRENCY) : ABSENT}</div>
              <div className="price-change" data-dir={direction(day?.percent ?? null)}>
                {day == null
                  ? ABSENT
                  : `${day.moved < 0 ? "−" : "+"}${money(Math.abs(day.moved), BASE_CURRENCY)} · ${delta(day.percent)}`}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {!positions.length ? (
        <Empty onOpen={openEditor} />
      ) : (
        <>
          <section className="section" style={{ borderTop: 0, paddingTop: 0 }}>
            <div className="grid-ruled stats">
              <Stat label="Value" value={valued.value > 0 ? money(valued.value, BASE_CURRENCY) : null} />
              <Stat label="Cost" value={valued.cost > 0 ? money(valued.cost, BASE_CURRENCY) : null} />
              <Stat label="Gain" value={valued.profitPercent == null ? null : delta(valued.profitPercent)} />
              {/* Your share of what these companies earned last year, and what
                  the book paid for it. The label is short because the cell is;
                  the sentence under the strip says what "owned" means. */}
              <Stat label="FCF owned" value={lookThrough.freeCashFlow > 0 ? money(lookThrough.freeCashFlow, BASE_CURRENCY) : null} />
              <Stat label="FCF yield" value={lookThrough.yield == null ? null : percent(lookThrough.yield, 2)} />
              <Stat label="Portfolio P / FCF" value={lookThrough.multiple == null ? null : ratio(lookThrough.multiple, 1)} />
              <Stat label="Weighted quality" value={score == null ? null : `${score.grade} · ${score.value.toFixed(1)}`} />
              <Stat label="Largest" value={spread.largest == null ? null : percent(spread.largest, 1)} />
            </div>
            {lookThrough.freeCashFlow > 0 ? (
              <p className="stat-note" style={{ marginTop: 10 }}>
                Owned is your fraction of each company — your shares over the shares in issue — applied to what that
                company reported. This book has a claim on {money(lookThrough.revenue, BASE_CURRENCY)} of revenue and{" "}
                {money(lookThrough.freeCashFlow, BASE_CURRENCY)} of free cash flow a year.
              </p>
            ) : null}
            <Notes
              valued={valued}
              lookThrough={lookThrough}
              unpriced={unpriced}
              building={building}
              foreign={foreign}
              score={score}
            />
          </section>

          <PortfolioAnalysis
            positions={valued.positions}
            score={score}
            risks={riskExposures}
          />

          <section className="section">
            <div className="section-head">
              <div className="readout">
                {against ? (
                  <>
                    <span className="v">{delta(reading(against, hover).book)}</span>
                    <span className="d">{hover != null && against.points[hover] ? shortDate(against.points[hover].date) : "Portfolio"}</span>
                    <span className="readout-change">{delta(reading(against, hover).index)} {BENCHMARK.label}</span>
                    {/* A month compounded into a year is a sentence about a
                        month pretending to be one about a year: 2% in August
                        becomes "+27.6% a year". Only a window of a year or more
                        gets one. */}
                    {against.book.cagr != null && (against.book.years ?? 0) >= 1
                      ? <span className="readout-cagr">{delta(against.book.cagr)} a year</span>
                      : null}
                  </>
                ) : (
                  <span className="d">Against the {BENCHMARK.label}</span>
                )}
              </div>
              <div className="seg">
                {WINDOWS.map((entry) => (
                  <button key={entry} type="button" aria-pressed={span === entry} onClick={() => { setSpan(entry); setHover(null); }}>
                    {entry}
                  </button>
                ))}
              </div>
            </div>
            {against ? (
              <>
                <div className="price-frame">
                  <MultiLine series={against.series} onHover={setHover} />
                </div>
                <p className="stat-note" style={{ marginTop: 10 }}>
                  The book you hold today, priced back through every close in the window — not a record of what was
                  bought and sold. Both lines start together at 100 and neither carries dividends.
                  {against.short && against.youngest
                    ? ` It starts on ${shortDate(against.points[0].date)}: ${against.youngest.ticker} has no price before ${shortDate(against.youngest.from)}, and a portfolio line drawn while part of the portfolio did not exist is not one.`
                    : ""}
                  {against.book.drawdown != null && against.book.drawdownDate != null
                    ? ` Deepest fall from a peak inside the window: ${percent(Math.abs(against.book.drawdown), 1)}, to ${shortDate(against.book.drawdownDate)}.`
                    : ""}
                </p>
              </>
            ) : (
              <p className="price-chart plot-empty num faint">
                {history ? "Not enough shared price history to draw the book against the index." : "Reading prices"}
              </p>
            )}
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="label">Holdings</h2>
              <div className="seg">
                <button type="button" aria-pressed={sort === "value"} onClick={() => setSort("value")}>By value</button>
                <button type="button" aria-pressed={sort === "ticker"} onClick={() => setSort("ticker")}>A–Z</button>
              </div>
            </div>
            <Holdings
              rows={rows}
              quotes={feed.quotes}
              graded={graded}
              qualityContributions={Object.fromEntries((score?.contributions ?? []).map((entry) => [entry.ticker, entry.contribution]))}
              dayContributions={day?.contributions ?? {}}
            />
          </section>

          {sectors.length ? (
            <section className="section">
              <div className="section-head">
                <h2 className="label">Sector concentration</h2>
                <span className="label">{sectors.length} {sectors.length === 1 ? "sector" : "sectors"}</span>
              </div>
              <div className="allocation">
                {sectors.map((entry) => (
                  <div className="allocation-row" key={entry.label}>
                    <span className="allocation-name">{entry.label}</span>
                    <span className="allocation-bar"><span style={{ width: `${Math.max(entry.weight * 100, .4)}%` }} /></span>
                    <span className="allocation-weight num">{percent(entry.weight, 1)}</span>
                  </div>
                ))}
              </div>
              {/*
                * How many holdings the book really has.
                *
                * Twenty names where one is half the money is not twenty
                * positions, and saying "twenty holdings" would be true and
                * misleading. The reciprocal of the Herfindahl index is the
                * count of equally sized holdings that would concentrate the
                * money the same way.
                */}
              {spread.effectiveHoldings != null ? (
                <p className="stat-note" style={{ marginTop: 12 }}>
                  {rows.length} {rows.length === 1 ? "holding" : "holdings"}, concentrated like{" "}
                  {spread.effectiveHoldings.toFixed(1)} equally sized ones.
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      {editing ? (
        <Editor
          draft={draft}
          onDraft={setDraft}
          onClose={() => setEditing(false)}
          onSave={save}
        />
      ) : null}
    </main>
  );
}

/**
 * Both lines at the cursor, as the change from the start of the window.
 *
 * Rebased to a hundred, so the reading is the level minus that hundred — the
 * same arithmetic for the book and for the index, which is the whole point of
 * rebasing them together.
 */
function reading(against: { points: Array<{ portfolio: number; benchmark: number }> }, hover: number | null) {
  const point = (hover != null ? against.points[hover] : undefined) ?? against.points[against.points.length - 1];
  return { book: point.portfolio / 100 - 1, index: point.benchmark / 100 - 1 };
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="stat-value" data-empty={value == null}>{value ?? ABSENT}</div>
    </div>
  );
}

/**
 * What the figures above do not cover, said where they are.
 *
 * A look-through free cash flow across three quarters of a book is a different
 * statement from the same number across all of it, so the share it speaks for
 * travels with it. Same for the cost: a gain measured over the positions that
 * carry a purchase price is not the gain on the portfolio.
 */
function Notes({
  valued, lookThrough, unpriced, building, foreign, score,
}: {
  valued: ReturnType<typeof valuePortfolio>;
  lookThrough: { coverage: number };
  unpriced: string[];
  building: string[];
  foreign: string[];
  score: { coverage: number } | null;
}) {
  const notes = [
    lookThrough.coverage > 0 && lookThrough.coverage < .995
      ? `The look-through figures cover ${percent(lookThrough.coverage, 0)} of the book: the rest is held in companies whose filings are not read here yet.`
      : null,
    valued.costCoverage > 0 && valued.costCoverage < .995
      ? `The gain is measured over ${percent(valued.costCoverage, 0)} of the book — the holdings entered with a price paid.`
      : null,
    score != null && score.coverage < .995
      ? `The quality score is the value-weighted average over ${percent(score.coverage, 0)} of the book.`
      : null,
    building.length
      ? `${building.join(", ")} ${building.length === 1 ? "is" : "are"} still being read from the filings, and ${building.length === 1 ? "is" : "are"} left out of every figure above rather than counted as nothing.`
      : null,
    unpriced.length && !building.length
      ? `No price for ${unpriced.join(", ")}, so ${unpriced.length === 1 ? "it is" : "they are"} left out of the value and the weights.`
      : null,
    foreign.length
      ? `${foreign.join(", ")} ${foreign.length === 1 ? "is quoted" : "are quoted"} in another currency. FinScope never converts a filed figure, so ${foreign.length === 1 ? "it is" : "they are"} listed and left out of the totals.`
      : null,
  ].filter((note): note is string => note != null);
  return <>{notes.map((note) => <p className="stat-note" key={note} style={{ marginTop: 10 }}>{note}</p>)}</>;
}

interface PortfolioAnalysisScore {
  value: number;
  coverage: number;
  grade: string;
  contributions: Array<{ ticker: string; scoredWeight: number; score: number; contribution: number }>;
}

function PortfolioAnalysis({
  positions, score, risks,
}: {
  positions: ValuedPosition[];
  score: PortfolioAnalysisScore | null;
  risks: Array<{ label: string; weight: number; tickers: string[] }>;
}) {
  const contributions = new Map((score?.contributions ?? []).map((entry) => [entry.ticker, entry]));
  const ordered = [...positions]
    .filter((position) => position.weight != null)
    .sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0));
  return (
    <section className="section portfolio-analysis">
      <div className="section-head">
        <div>
          <h2 className="label">Portfolio analysis</h2>
          <p className="stat-note">Concentration, score contribution and stated score alerts</p>
        </div>
        <span className="label">{score ? `${score.grade} · ${score.value.toFixed(1)} weighted quality` : "Quality pending"}</span>
      </div>
      <div className="portfolio-analysis-grid">
        <div className="portfolio-analysis-block">
          <h3 className="label">Risk exposure</h3>
          <div className="allocation portfolio-risk-list">
            {risks.map((risk) => (
              <div className="allocation-row" key={risk.label}>
                <span className="allocation-name">
                  {risk.label}
                  <small>{risk.tickers.join(" · ")}</small>
                </span>
                <span className="allocation-bar"><span style={{ width: `${Math.max(risk.weight * 100, .4)}%` }} /></span>
                <span className="allocation-weight num">{percent(risk.weight, 1)}</span>
              </div>
            ))}
          </div>
          <p className="stat-note portfolio-analysis-note">Exposures overlap. They are value weights, not a risk score, and are not meant to add to 100%.</p>
        </div>
        <div className="portfolio-analysis-block">
          <h3 className="label">Quality contribution</h3>
          <div className="sheet portfolio-contribution-sheet">
            <table>
              <thead><tr><th className="key" scope="col">Company</th><th scope="col">Weight</th><th scope="col">Score</th><th scope="col">Contribution</th></tr></thead>
              <tbody>
                {ordered.map((position) => {
                  const entry = contributions.get(position.ticker);
                  return (
                    <tr key={position.ticker}>
                      <th className="key" scope="row"><a className="key-open" href={`/s/${encodeURIComponent(position.ticker)}`}>{position.ticker}</a></th>
                      <td>{percent(position.weight, 1)}</td>
                      <td data-empty={!entry}>{entry ? entry.score.toFixed(1) : ABSENT}</td>
                      <td data-empty={!entry}>{entry ? `${entry.contribution.toFixed(1)} pts` : ABSENT}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="stat-note portfolio-analysis-note">
            Contributions add to the weighted score over {score ? percent(score.coverage, 0) : ABSENT} of portfolio value.
          </p>
        </div>
      </div>
    </section>
  );
}

function Holdings({
  rows, quotes, graded, qualityContributions, dayContributions,
}: {
  rows: ValuedPosition[];
  quotes: Record<string, IoQuote | undefined>;
  graded: Record<string, ScoredCompany | undefined>;
  qualityContributions: Record<string, number | undefined>;
  dayContributions: Record<string, number | undefined>;
}) {
  return (
    <div className="sheet">
      <table>
        <thead>
          <tr>
            <th className="key" scope="col">Company</th>
            <th scope="col">Shares</th>
            <th scope="col">Price</th>
            <th scope="col">Day</th>
            <th scope="col">Value</th>
            <th scope="col">Weight</th>
            <th scope="col">Cost</th>
            <th scope="col">Gain</th>
            <th scope="col">Grade</th>
            <th scope="col">QS contribution</th>
            <th scope="col">Day contribution</th>
            <th scope="col">FCF yield</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const quote = quotes[row.ticker];
            const grade = graded[row.ticker];
            // Your fraction of the company's own free cash flow, over what the
            // position is worth: the yield on this holding, struck the same way
            // the portfolio's is.
            const owned = row.summary?.shares && row.summary.freeCashFlow != null && row.value
              ? (row.shares / row.summary.shares) * row.summary.freeCashFlow / row.value
              : null;
            return (
              <tr key={row.ticker}>
                <th className="key" scope="row">
                  <a className="key-open" href={`/s/${encodeURIComponent(row.ticker)}`}>
                    {row.ticker}
                    <span className="screener-sector">{stated(row.sector)}</span>
                  </a>
                </th>
                <td>{row.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                <td data-empty={row.price == null}>{row.price == null ? ABSENT : writePrice(row.price, quote?.currency ?? BASE_CURRENCY)}</td>
                <td data-empty={quote?.changePercent == null} data-dir={direction(quote?.changePercent ?? null)}>
                  {quote?.changePercent == null ? ABSENT : delta(quote.changePercent)}
                </td>
                <td data-empty={row.value == null}>{row.value == null ? ABSENT : money(row.value, BASE_CURRENCY)}</td>
                <td data-empty={row.weight == null}>{row.weight == null ? ABSENT : percent(row.weight, 1)}</td>
                <td data-empty={row.costBasis == null}>{row.costBasis == null ? ABSENT : money(row.costBasis, BASE_CURRENCY)}</td>
                <td data-empty={row.profitPercent == null}>{row.profitPercent == null ? ABSENT : delta(row.profitPercent)}</td>
                <td data-empty={grade == null || grade.note === "NR"}>{grade?.note ?? ABSENT}</td>
                <td data-empty={qualityContributions[row.ticker] == null}>{qualityContributions[row.ticker] == null ? ABSENT : `${qualityContributions[row.ticker]!.toFixed(1)} pts`}</td>
                <td data-empty={dayContributions[row.ticker] == null}>{dayContributions[row.ticker] == null ? ABSENT : delta(dayContributions[row.ticker])}</td>
                <td data-empty={owned == null}>{owned == null ? ABSENT : percent(owned, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="state">
      <p className="lead num">Nothing held yet</p>
      <p>A holding is a ticker and a number of shares. Everything else is read from the filings.</p>
      <p style={{ marginTop: 14 }}>
        <button className="metric-toggle" type="button" onClick={onOpen}>Add holdings</button>
      </p>
    </div>
  );
}

/**
 * The book, typed the way somebody would write it down.
 *
 * A ticker, a share count, and what it cost if they know it. No table of
 * inputs, no row of plus buttons: one line a holding, which is the shape a
 * brokerage statement already has and the shape a person types without being
 * taught anything.
 */
function Editor({
  draft, onDraft, onClose, onSave,
}: {
  draft: string;
  onDraft: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const parsed = parseHoldings(draft);
  return (
    <div className="watchlist-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="watchlist-editor" role="dialog" aria-modal="true" aria-labelledby="portfolio-editor-title">
        <div className="watchlist-editor-head">
          <div>
            <p className="label">Kept on this device</p>
            <h2 id="portfolio-editor-title">Edit holdings</h2>
          </div>
          <button type="button" className="watchlist-close" onClick={onClose} aria-label="Close holdings editor">×</button>
        </div>
        <label className="watchlist-input">
          <span>One a line · ticker, shares, and what you paid</span>
          <textarea
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            spellCheck={false}
            placeholder={"AAPL 40 @ 150\nNVDA 15\nCOST 8 @ 720.50"}
          />
        </label>
        <div className="watchlist-editor-foot">
          <span className="label">{parsed.length} {parsed.length === 1 ? "holding" : "holdings"}</span>
          <div>
            <button type="button" className="watchlist-reset" onClick={() => onDraft("")}>Clear</button>
            <button type="button" className="watchlist-save" onClick={onSave}>Save</button>
          </div>
        </div>
      </section>
    </div>
  );
}
