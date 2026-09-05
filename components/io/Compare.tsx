"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fcfShareGrowthProfile, type FcfShareGrowthProfile, type FcfShareReading } from "@/lib/io/fcf-share-growth";
import type { IoCompanyView } from "@/lib/io/view";
import { IO_SECTIONS } from "@/lib/io/sections";
import { IO_VIEW } from "@/lib/io/view-version";
import { multipleOf } from "@/lib/market-basis";
import { MultiLine, type Series } from "./Plot";
import { Search } from "./Search";
import { COMPARE_RANGES, fundamentalWindow, offersFrequency, withinYears, type Frequency, type Range } from "./ranges";
import { growthOver } from "./Growth";
import { ABSENT, delta, formatUnit, money, percent, price as writePrice, ratio, shortDate, type Unit } from "./format";
import type { IoQuote } from "./quote";

/**
 * Several companies, one screen, the same figures.
 *
 * The comparison a reader actually wants is not "show me everything about six
 * companies" — that is six pages — but a single row read across: what does this
 * measure look like at each of them. So the table is metrics down and companies
 * across, and the chart draws one measure for all of them at once.
 */

const LIMIT = 6;

/**
 * Which measures a comparison shows: all of them, in statement order.
 *
 * It used to be a curated fifteen, which is a fine answer to "what should I
 * look at" and the wrong answer to "compare these companies" — the reader has
 * already decided what they care about, and half the time it was not on the
 * list. Every measure at least one of the companies carries is offered, grouped
 * the way the statements group them, so a table of eighty rows is still
 * something you can find your way down.
 */
interface Row { key: string; label: string; unit: Unit }

const DEFAULT_MARGIN_KEYS = [
  "grossMargin", "operatingMargin", "netMargin", "operatingCashFlowMargin",
  "freeCashFlowMargin", "freeCashFlowAfterSbcMargin", "cashConversion", "roic",
  "cashReturnOnCapital", "debtToEquity", "interestCoverage",
];

const DEFAULT_GROWTH_KEYS = [
  "revenue", "grossProfit", "operatingIncome", "netIncome", "dilutedShares",
  "netIncomePerShare", "freeCashFlowPerShare", "freeCashFlowAfterSbcPerShare",
];

function rowsFor(columns: Array<{ view: IoCompanyView | null }>): Array<{ id: string; label: string; rows: Row[] }> {
  const carried = new Map<string, Row>();
  for (const column of columns) {
    for (const metric of column.view?.metrics ?? []) {
      if (!carried.has(metric.key)) carried.set(metric.key, { key: metric.key, label: metric.label, unit: metric.unit as Unit });
    }
  }
  return IO_SECTIONS
    .map((section) => ({
      id: section.id,
      label: section.label,
      rows: section.metrics.flatMap((key) => { const row = carried.get(key); return row ? [row] : []; }),
    }))
    .filter((section) => section.rows.length > 0);
}

/** What the chart offers before a reader asks for the rest. */
const FEATURED = [
  "revenue", "grossMargin", "operatingMargin", "netMargin", "freeCashFlow",
  "freeCashFlowMargin", "freeCashFlowAfterSbcMargin", "freeCashFlowPerShare",
  "netIncomePerShare", "roic", "dilutedShares", "netDebt",
];

interface Loaded { ticker: string; view: IoCompanyView | null; quote: IoQuote | null; error: string | null }

/**
 * The list of companies is the address, and the address is the state.
 *
 * A comparison is a thing you send to somebody, so it has to live in the URL —
 * and once it does, holding a second copy of it in component state is two
 * things to keep in step. The query string is subscribed to instead: editing
 * the list rewrites it and says so, and the component simply reads it.
 */
const LIST_EVENT = "finscope:compare-list";

function subscribeToList(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener(LIST_EVENT, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(LIST_EVENT, notify);
  };
}

function parseList(search: string): string[] {
  const asked = new URLSearchParams(search).get("s");
  const parsed = (asked ?? "").split(/[^A-Za-z0-9.-]+/).map((item) => item.toUpperCase()).filter(Boolean);
  return [...new Set(parsed)].slice(0, LIMIT);
}

export function Compare({ initial }: { initial: string[] }) {
  const search = useSyncExternalStore(subscribeToList, () => window.location.search, () => "");
  const tickers = useMemo(() => {
    const parsed = parseList(search);
    return parsed.length ? parsed : initial;
  }, [search, initial]);

  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [mode, setMode] = useState<"table" | "chart">("table");
  const [metricKey, setMetricKey] = useState("revenue");
  const [range, setRange] = useState<Range>("5Y");
  /*
   * Trailing figures unless the reader asks otherwise.
   *
   * A company page opens MAX on the annual series because a reader who chose
   * MAX is asking for the record. A comparison is asking something else — which
   * of these compounded, and how steadily — and the trailing series answers
   * that with four observations a year instead of one. The switch is there for
   * anyone who wants the filed years.
   */
  const [frequency, setFrequency] = useState<Frequency>("ttm");
  const [absolute, setAbsolute] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const started = useRef(new Set<string>());
  const inFlight = useRef<AbortController[]>([]);

  useEffect(() => {
    const controllers = inFlight.current;
    return () => { for (const controller of controllers) controller.abort(); };
  }, []);

  useEffect(() => {
    for (const ticker of tickers) {
      // A company already asked for is never asked for again, and adding a
      // second company must not cancel the first one's request — which is what
      // a controller shared by the effect would do.
      if (started.current.has(ticker)) continue;
      started.current.add(ticker);
      const controller = new AbortController();
      inFlight.current.push(controller);
      (async () => {
        const settle = (value: Omit<Loaded, "ticker">) =>
          setLoaded((current) => ({ ...current, [ticker]: { ticker, ...value } }));
        try {
          const [viewResponse, quoteResponse] = await Promise.all([
            fetch(`/api/io/${encodeURIComponent(ticker)}?view=${IO_VIEW}`, { signal: controller.signal }),
            fetch(`/api/io/${encodeURIComponent(ticker)}/quote`, { signal: controller.signal }),
          ]);
          if (viewResponse.status === 202) {
            started.current.delete(ticker);
            settle({ view: null, quote: null, error: "Being prepared — ask again in a minute." });
            return;
          }
          if (!viewResponse.ok) {
            const body = await viewResponse.json().catch(() => ({})) as { error?: string };
            settle({ view: null, quote: null, error: body.error ?? "Unavailable." });
            return;
          }
          const view = await viewResponse.json() as IoCompanyView;
          const quote = quoteResponse.ok ? await quoteResponse.json() as IoQuote : null;
          settle({ view, quote, error: null });
        } catch {
          if (controller.signal.aborted) return;
          started.current.delete(ticker);
          settle({ view: null, quote: null, error: "Unreachable." });
        }
      })();
    }
  }, [tickers]);

  const write = (next: string[]) => {
    const url = new URL(window.location.href);
    url.searchParams.set("s", next.join(","));
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(LIST_EVENT));
  };

  const add = (ticker: string) => {
    if (tickers.includes(ticker) || tickers.length >= LIMIT) return;
    write([...tickers, ticker]);
  };
  const drop = (ticker: string) => write(tickers.filter((item) => item !== ticker));

  const columns = tickers.map((ticker) => loaded[ticker] ?? { ticker, view: null, quote: null, error: null });
  const ready = columns.filter((column): column is Loaded & { view: IoCompanyView } => column.view != null);

  return (
    <main className="wrap">
      <header className="head">
        <div className="head-id">
          <h1 className="head-ticker">Compare</h1>
          <p className="head-note">{tickers.length} of {LIMIT}</p>
        </div>
        <div className="compare-controls">
          <div className="chips">
            {columns.map((column) => (
              <span className="chip" key={column.ticker} data-state={column.view ? "ready" : column.error ? "failed" : "loading"}>
                {column.ticker}
                <button type="button" onClick={() => drop(column.ticker)} aria-label={`Remove ${column.ticker}`}>×</button>
              </span>
            ))}
          </div>
          {tickers.length < LIMIT ? <Search size="bar" onPick={add} /> : null}
        </div>
      </header>

      <section className="section" style={{ borderTop: 0 }}>
        <div className="section-head">
          <div className="seg">
            <button type="button" aria-pressed={mode === "table"} onClick={() => setMode("table")}>Table</button>
            <button type="button" aria-pressed={mode === "chart"} onClick={() => setMode("chart")}>Chart</button>
          </div>
          {/* One range for the page: it draws the chart and it is the window
              the table's growth block compounds over. */}
          <div className="compare-windows">
            {mode === "chart" && offersFrequency(range) ? (
              <div className="seg">
                <button type="button" aria-pressed={frequency === "ttm"} onClick={() => setFrequency("ttm")}>TTM</button>
                <button type="button" aria-pressed={frequency === "annual"} onClick={() => setFrequency("annual")}>Yearly</button>
              </div>
            ) : null}
            <div className="seg">
              {COMPARE_RANGES.map((entry) => (
                <button key={entry} type="button" aria-pressed={range === entry} onClick={() => setRange(entry)}>{entry}</button>
              ))}
            </div>
          </div>
        </div>

        {!ready.length ? (
          <p className="state"><span className="pulse" />Loading</p>
        ) : mode === "table" ? (
          <CompareTable columns={columns} range={range} />
        ) : (
          <CompareChart
            columns={ready}
            metricKey={metricKey}
            onMetric={setMetricKey}
            range={range}
            frequency={frequency}
            absolute={absolute}
            onAbsolute={setAbsolute}
            hover={hover}
            onHover={setHover}
          />
        )}
      </section>
    </main>
  );
}

/** The latest trailing figure at each company, one measure per row. */
function CompareTable({ columns, range }: { columns: Loaded[]; range: Range }) {
  const [expanded, setExpanded] = useState(false);
  const years = fundamentalWindow(range).years;
  const sections = useMemo(() => rowsFor(columns), [columns]);
  const everyRow = sections.flatMap((section) => section.rows);
  const byKey = new Map(everyRow.map((row) => [row.key, row]));
  const shownSections = expanded
    ? sections
    : [{
      id: "ratios",
      label: "Margins and returns",
      rows: DEFAULT_MARGIN_KEYS.flatMap((key) => { const row = byKey.get(key); return row ? [row] : []; }),
    }];
  const growthRows = expanded
    ? everyRow
    : DEFAULT_GROWTH_KEYS.flatMap((key) => { const row = byKey.get(key); return row ? [row] : []; });
  return (
    <>
      <FcfShareComparison columns={columns} />
      <div className="section-head compare-table-head">
        <h2 className="label">Company comparison</h2>
        <button className="metric-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
          {expanded ? "Show essentials" : "Show all"}
        </button>
      </div>
      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th className="key" scope="col">Latest TTM</th>
              {columns.map((column) => <th key={column.ticker} scope="col">{column.ticker}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="group rule">
              <th className="key" scope="colgroup" colSpan={columns.length + 1}><span className="label">Market</span></th>
            </tr>
            <MarketRows columns={columns} />
            {shownSections.map((section) => (
              <Fragment key={section.id}>
                <tr className="group rule">
                  <th className="key" scope="colgroup" colSpan={columns.length + 1}><span className="label">{section.label}</span></th>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.key}>
                    <th className="key" scope="row">{row.label}</th>
                    {columns.map((column) => {
                      const period = column.view?.ttm ?? column.view?.annual.at(-1) ?? null;
                      const value = period?.values[row.key] ?? null;
                      return (
                        <td key={column.ticker} data-empty={value == null}>
                          {value == null ? ABSENT : formatUnit(value, row.unit, period?.currency ?? null)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="group rule">
              <th className="key" scope="colgroup" colSpan={columns.length + 1}>
                <span className="label">Growth · {range} · compound, or points moved for a rate</span>
              </th>
            </tr>
            {growthRows.map((row) => (
              <tr key={`growth-${row.key}`}>
                <th className="key" scope="row">{row.label}</th>
                {columns.map((column) => {
                  const rate = column.view ? growthOver(column.view.annual, row.key, row.unit, years) : null;
                  return <td key={column.ticker} data-empty={rate == null}>{rate == null ? ABSENT : delta(rate, 1)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const FCF_SHARE_COMPARISON_ROWS: Array<{
  key: keyof FcfShareGrowthProfile;
  label: string;
  format: (value: number) => string;
}> = [
  { key: "fiveYearCagr", label: "5Y CAGR", format: (value) => percent(value, 1) },
  { key: "tenYearCagr", label: "10Y CAGR", format: (value) => percent(value, 1) },
  { key: "fiveYearRSquared", label: "R² · 5Y", format: (value) => value.toFixed(2) },
  { key: "tenYearRSquared", label: "R² · 10Y", format: (value) => value.toFixed(2) },
];

function readingTitle(reading: FcfShareReading | null) {
  if (!reading) return "Company data is not ready";
  return reading.reason
    ?? `${reading.observations} annual observations · ${reading.startDate} to ${reading.endDate}`;
}

/** A deliberately separate comparison of FCF/share growth and regularity. */
function FcfShareComparison({ columns }: { columns: Loaded[] }) {
  const profiles = Object.fromEntries(columns.map((column) => [
    column.ticker,
    column.view ? fcfShareGrowthProfile(column.view.annual) : null,
  ])) as Record<string, FcfShareGrowthProfile | null>;
  return (
    <div className="compare-fcf-share">
      <div className="section-head">
        <h2 className="label">FCF / share</h2>
        <span className="label">Annual · filed figures</span>
      </div>
      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th className="key" scope="col">Growth &amp; consistency</th>
              {columns.map((column) => <th key={column.ticker} scope="col">{column.ticker}</th>)}
            </tr>
          </thead>
          <tbody>
            {FCF_SHARE_COMPARISON_ROWS.map((row) => (
              <tr key={row.key}>
                <th className="key" scope="row">{row.label}</th>
                {columns.map((column) => {
                  const reading = profiles[column.ticker]?.[row.key] ?? null;
                  const value = reading?.value ?? null;
                  return (
                    <td key={column.ticker} data-empty={value == null} title={readingTitle(reading)}>
                      {value == null ? ABSENT : row.format(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * What a live price and a filed statement make, company by company.
 *
 * The same two questions decide every figure here as on a company page: is the
 * quote in the currency the accounts are kept in, and is the share count the
 * one the company has outstanding. A no to either withholds the column rather
 * than converting anything.
 */
function MarketRows({ columns }: { columns: Loaded[] }) {
  const basisOf = (column: Loaded) => {
    const basis = column.view?.basis;
    const quote = column.quote;
    if (!basis || quote?.price == null || quote.currency !== basis.currency) return null;
    const marketCap = quote.price * basis.shares;
    const period = column.view?.ttm ?? column.view?.annual.at(-1) ?? null;
    return {
      currency: basis.currency,
      price: quote.price,
      marketCap,
      enterpriseValue: basis.netDebt == null ? null : marketCap + basis.netDebt,
      period,
    };
  };

  const rows: Array<{ label: string; read: (column: Loaded) => string }> = [
    { label: "Price", read: (column) => { const b = basisOf(column); return b ? writePrice(b.price, b.currency) : ABSENT; } },
    { label: "Market cap", read: (column) => { const b = basisOf(column); return b ? money(b.marketCap, b.currency) : ABSENT; } },
    { label: "EV", read: (column) => { const b = basisOf(column); return b?.enterpriseValue == null ? ABSENT : money(b.enterpriseValue, b.currency); } },
    { label: "P / E", read: (column) => { const b = basisOf(column); const v = multipleOf(b?.marketCap ?? null, b?.period?.values.netIncome ?? null); return v == null ? ABSENT : ratio(v, 1); } },
    { label: "P / FCF", read: (column) => { const b = basisOf(column); const v = multipleOf(b?.marketCap ?? null, b?.period?.values.freeCashFlow ?? null); return v == null ? ABSENT : ratio(v, 1); } },
    { label: "FCF yield", read: (column) => { const b = basisOf(column); const v = multipleOf(b?.period?.values.freeCashFlow ?? null, b?.marketCap ?? null); return v == null ? ABSENT : percent(v, 2); } },
  ];

  return (
    <>
      {rows.map((row) => (
        <tr key={row.label}>
          <th className="key" scope="row">{row.label}</th>
          {columns.map((column) => {
            const text = row.read(column);
            return <td key={column.ticker} data-empty={text === ABSENT}>{text}</td>;
          })}
        </tr>
      ))}
    </>
  );
}

function CompareChart({
  columns,
  metricKey,
  onMetric,
  range,
  frequency,
  absolute,
  onAbsolute,
  hover,
  onHover,
}: {
  columns: Array<Loaded & { view: IoCompanyView }>;
  metricKey: string;
  onMetric: (key: string) => void;
  range: Range;
  frequency: Frequency;
  absolute: boolean;
  onAbsolute: (absolute: boolean) => void;
  hover: number | null;
  onHover: (index: number | null) => void;
}) {
  /*
   * Every measure the table shows, wherever at least one company carries it.
   *
   * It used to offer only what all of them carried, which quietly dropped half
   * the list the moment a bank or a company with no reported debt joined the
   * comparison — and the two lists then disagreed about what could be compared.
   * A company that does not report a measure is drawn as no line at all, which
   * is the same absence the table states as an em dash.
   */
  const [expanded, setExpanded] = useState(false);
  const offered = useMemo(() => rowsFor(columns).flatMap((section) => section.rows), [columns]);
  const featured = useMemo(() => {
    const byKey = new Map(offered.map((row) => [row.key, row]));
    const first = FEATURED.flatMap((key) => { const row = byKey.get(key); return row ? [row] : []; });
    return [...first, ...offered.filter((row) => !FEATURED.includes(row.key))];
  }, [offered]);

  const metric = offered.find((row) => row.key === metricKey) ?? offered[0] ?? null;
  const window = { ...fundamentalWindow(range), frequency };
  /*
   * A level is indexed; a rate is not.
   *
   * Apple's revenue against a mid-cap's on one axis is a flat line and a
   * mountain, and says nothing about either. Rebased to 100 at the start of the
   * window they can be read against each other, which is the only comparison a
   * shared axis can honestly support. A margin is already a comparable number
   * and is left alone.
   */
  const indexed = metric != null && metric.unit !== "percent" && !absolute;

  const series = useMemo<Series[]>(() => {
    if (!metric) return [];
    return columns.map((column) => {
      const source = window.frequency === "annual" ? column.view.annual : column.view.trailing;
      const points = withinYears(source, window.years).flatMap((period) => {
        const value = period.values[metric.key];
        return value == null || !Number.isFinite(value) ? [] : [{ date: period.end, value }];
      });
      const base = points[0]?.value ?? null;
      return {
        label: column.ticker,
        points: indexed && base != null && base > 0
          ? points.map((point) => ({ date: point.date, value: (point.value / base) * 100 }))
          : points,
      };
    }).filter((entry) => entry.points.length > 1);
  }, [columns, metric, window.frequency, window.years, indexed]);

  /*
   * The band the lines occupy, written out.
   *
   * An indexed chart is drawn on a logarithmic axis, and an axis nobody can see
   * is an axis nobody can check. Two figures at the ends of the plot say what
   * the shape is worth, and the caption says the scale it is on — which is the
   * least this site can do while still refusing a tick ladder.
   */
  const bounds = useMemo(() => {
    const values = series.flatMap((entry) => entry.points.map((point) => point.value));
    return values.length ? { high: Math.max(...values), low: Math.min(...values) } : null;
  }, [series]);

  if (!metric) return <p className="state"><span className="faint num">No measure is carried by all of these companies.</span></p>;

  const at = hover == null ? null : series[0]?.points[hover] ?? null;
  const write = (value: number) => (indexed ? value.toFixed(0) : formatUnit(value, metric.unit, null));

  return (
    <>
      <div className="compare-chart-head">
        <div className="seg seg-wrap">
          {(expanded ? featured : featured.slice(0, FEATURED.length)).map((row) => (
            <button key={row.key} type="button" aria-pressed={metric.key === row.key} onClick={() => onMetric(row.key)}>
              {row.label}
            </button>
          ))}
        </div>
        {featured.length > FEATURED.length ? (
          <button className="metric-toggle" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
            {expanded ? `Show first ${FEATURED.length}` : `Show all ${featured.length}`}
          </button>
        ) : null}
      </div>
      <div className="readout">
        <span className="v">{metric.label}</span>
        <span className="d">{at ? shortDate(at.date) : `${window.frequency === "annual" ? "Yearly" : "TTM"} · ${range}`}</span>

      </div>
      {/*
        * What each line is worth where the pointer is.
        *
        * A crosshair on a chart of one company can put the figure in the
        * readout above it. Six lines cannot: the reader is asking about all of
        * them at once, which is the whole reason the page exists. Each company
        * states its own value, in the order and with the stroke it is drawn
        * with, and falls back to its last figure when nothing is hovered.
        */}
      <div className="compare-values">
        {series.map((entry, index) => {
          const point = hover == null ? entry.points.at(-1) : entry.points[hover];
          return (
            <span className="compare-value" key={entry.label}>
              <span className={`plot-swatch plot-stroke-${index % 5}`} />
              <span className="compare-value-name">{entry.label}</span>
              <span className="num">{point ? write(point.value) : ABSENT}</span>
            </span>
          );
        })}
      </div>
      {metric.unit !== "percent" ? (
        <div className="compare-scale">
          <button className="metric-toggle" type="button" onClick={() => onAbsolute(!absolute)}>
            {indexed ? "Indexed to 100 · log" : "Absolute"}
          </button>
        </div>
      ) : null}
      {series.length ? (
        <div className="price-frame compare-frame">
          <MultiLine series={series} scale={indexed ? "log" : "linear"} onHover={onHover} />
          {bounds ? (
            <div className="plot-axis">
              <span className="plot-tag plot-tag-left" style={{ top: 0 }}>{write(bounds.high)}</span>
              <span className="plot-tag plot-tag-left" style={{ bottom: 0 }}>{write(bounds.low)}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="price-chart plot-empty num faint">Not enough history for this measure.</p>
      )}
    </>
  );
}
