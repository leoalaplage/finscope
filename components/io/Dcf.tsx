"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { IO_VIEW } from "@/lib/io/view-version";
import { impliedGrowth, impliedReturn, presentValue } from "@/lib/io/implied-growth";
import { ImpliedExpectations, type GrowthChoice } from "./ImpliedExpectations";
import { Search } from "./Search";
import { withinYears } from "./ranges";
import type { IoQuote } from "./quote";
import { ABSENT, datedCagrOf, delta, percent, price as writePrice } from "./format";

/**
 * One company, one question: what would have to be true for this price.
 *
 * The company page carries the same model in a panel, under everything else a
 * reader might want. This page is for the reader who has already decided what
 * they are asking — is there room to buy this today — and it answers in the
 * order that question is asked: what you would earn if the company merely
 * repeats itself, what it is worth against what it costs, and under which
 * assumptions that verdict changes.
 *
 * Nothing here is a recommendation and nothing is a forecast. The growth comes
 * out of the filings, the price comes from the market, and the one number that
 * is the reader's own is the return they require — which is why the grid at the
 * bottom shows every answer at once rather than hiding the sensitivity behind a
 * single setting.
 */

const HORIZON = 10;
const POLL_MS = 2_000;
const POLL_LIMIT = 30;
const TERMINAL = .025;
/** The requirements the grid answers for, and the records it answers on. */
const RATES = [.06, .08, .10, .12];

interface Loaded { ticker: string; view: IoCompanyView | null; quote: IoQuote | null; error: string | null }

const LIST_EVENT = "finscope:dcf-symbol";

function subscribe(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener(LIST_EVENT, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(LIST_EVENT, notify);
  };
}

/** The most recent period that reports a measure, and which one it was. */
function latest(view: IoCompanyView, key: string): { value: number | null; period: IoPeriod | null } {
  const series = [...view.annual, ...view.trailing].sort((left, right) => left.end.localeCompare(right.end));
  for (let index = series.length - 1; index >= 0; index--) {
    const value = series[index].values[key];
    if (value != null && Number.isFinite(value)) return { value, period: series[index] };
  }
  return { value: null, period: null };
}

/** What free cash flow compounded at, and over how many years it really did. */
function delivered(periods: IoPeriod[], years: number) {
  const points = withinYears(periods, years).flatMap((period) => {
    const value = period.values.freeCashFlow;
    return value == null || !Number.isFinite(value) ? [] : [{ date: period.end, value }];
  });
  if (points.length < 2) return null;
  const rate = datedCagrOf(points);
  const span = (Date.parse(points[points.length - 1].date) - Date.parse(points[0].date)) / (365.25 * 86_400_000);
  return rate == null || !(span > 0) ? null : { rate, years: span };
}

export function Dcf({ initial }: { initial: string }) {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const asked = new URLSearchParams(search).get("s")?.toUpperCase().replace(/[^A-Z0-9.-]/g, "") ?? "";
  const ticker = asked || initial;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [required, setRequired] = useState(.10);
  /*
   * One growth for the whole page.
   *
   * The grid says where the room is and the chart says what that assumption
   * looks like, so a cell chosen in one has to be the picture drawn in the
   * other — otherwise the reader is comparing a table against a chart of
   * something else.
   */
  const [picked, setPicked] = useState<GrowthChoice | null>(null);
  const current = loaded?.ticker === ticker ? loaded : null;

  /*
   * A company nobody has opened here before is normalized from raw XBRL first,
   * which is far too expensive to do inside a reader's request — so the
   * endpoint answers "being prepared" and hands the work on. This waits for it
   * rather than telling the reader to come back, which is what the company page
   * does and what this page owes anybody who arrives from a link.
   */
  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const [viewResponse, quoteResponse] = await Promise.all([
          fetch(`/api/io/${encodeURIComponent(ticker)}?view=${IO_VIEW}`, { signal: controller.signal }),
          fetch(`/api/io/${encodeURIComponent(ticker)}/quote`, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        if (viewResponse.status === 202) {
          attempts += 1;
          if (attempts <= POLL_LIMIT) { timer = setTimeout(load, POLL_MS); return; }
          setLoaded({ ticker, view: null, quote: null, error: "This company is taking longer than expected to prepare. Ask for it again in a minute." });
          return;
        }
        if (!viewResponse.ok) {
          const body = await viewResponse.json().catch(() => ({})) as { error?: string };
          setLoaded({ ticker, view: null, quote: null, error: body.error ?? "Unavailable." });
          return;
        }
        setLoaded({
          ticker,
          view: await viewResponse.json() as IoCompanyView,
          quote: quoteResponse.ok ? await quoteResponse.json() as IoQuote : null,
          error: null,
        });
      } catch {
        if (!controller.signal.aborted) setLoaded({ ticker, view: null, quote: null, error: "Unreachable." });
      }
    };

    load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [ticker]);

  const choose = (next: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("s", next);
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(LIST_EVENT));
  };

  const view = current?.view ?? null;
  const quote = current?.quote ?? null;

  /*
   * The record, until the reader says otherwise.
   *
   * The company page opens this model on what the price asks, because there the
   * question is what is being claimed. Here the question is whether there is
   * room to buy, and the price's own rate answers it with a nought by
   * construction — so the page opens on the longest record the filings support,
   * which is the one assumption the reader did not have to make.
   */
  const record = useMemo(() => (view ? delivered(view.annual, HORIZON) : null), [view]);
  const near = useMemo(() => (view ? delivered(view.annual, 5) : null), [view]);
  const growth: GrowthChoice = picked
    ?? (record != null && near != null && record.years > near.years + .5 ? "far" : near != null ? "near" : "flat");
  const setGrowth = setPicked;

  /*
   * The three things the verdict is struck from, and nothing else.
   *
   * The cash the company filed, the price the market is asking, and the record
   * that cash has compounded at. Every figure below is one of those three put
   * through the same arithmetic.
   */
  const model = useMemo(() => {
    if (!view) return null;
    const basis = view.basis;
    const cash = latest(view, "freeCashFlow");
    const mismatch = basis && quote?.currency && quote.currency !== basis.currency;
    const marketCap = basis && !mismatch && quote?.price != null && quote.price > 0 ? quote.price * basis.shares : null;
    if (!basis || marketCap == null || cash.value == null || cash.value <= 0) return null;

    const terms = { marketCap, freeCashFlow: cash.value, years: HORIZON, terminalGrowth: TERMINAL };
    const worth = (rate: number, growth: number) => presentValue({ ...terms, discountRate: rate }, growth) / basis.shares;
    /*
     * The rate the strip is struck at: whichever the reader has chosen.
     *
     * The strip and the grid and the chart all answer for the same pair, so
     * the headline moves when a cell is chosen rather than staying on a record
     * the reader has just looked away from.
     */
    const drawn = growth === "flat" ? 0
      : growth === "near" ? near?.rate ?? record?.rate ?? 0
      : growth === "far" ? record?.rate ?? 0
      : impliedGrowth({ ...terms, discountRate: required }).kind === "solved"
        ? (impliedGrowth({ ...terms, discountRate: required }) as { rate: number }).rate
        : record?.rate ?? 0;
    return {
      basis, cash, marketCap, record, terms, worth, drawn,
      price: quote?.price ?? marketCap / basis.shares,
      // What the price earns you if the record simply continues. Nothing in it
      // is the reader's: the growth is filed and the price is the market's.
      earns: record ? impliedReturn(terms, record.rate) : null,
      // And what it must do for the return the reader wants.
      asks: impliedGrowth({ ...terms, discountRate: required }),
    };
  }, [view, quote, required, growth, record, near]);

  /*
   * The rows the grid answers for, in the panel's own vocabulary.
   *
   * The price's own rate is deliberately not one of them: by construction it
   * values the company at exactly its price, so a row of noughts across every
   * column would say nothing. What is left is what the filings support and the
   * floor nobody has to defend.
   */
  const growths = useMemo(() => {
    if (!view) return [];
    const near = delivered(view.annual, 5);
    const far = delivered(view.annual, 10);
    const longer = far != null && near != null && far.years > near.years + .5;
    return [
      ...(near ? [{ id: "near" as const, label: `Delivered · ${Math.round(near.years)} years`, rate: near.rate }] : []),
      ...(longer && far ? [{ id: "far" as const, label: `Delivered · ${Math.round(far.years)} years`, rate: far.rate }] : []),
      { id: "flat" as const, label: "No growth", rate: 0 },
    ];
  }, [view]);

  return (
    <main className="wrap">
      <header className="head">
        <div className="head-row">
          <div>
            <div className="head-id">
              <h1 className="head-ticker">DCF</h1>
              <p className="head-name">{view ? `${view.company.ticker} · ${view.company.name}` : ticker || "Choose a company"}</p>
            </div>
            <div className="head-meta">
              <span className="label">Reverse and forward, on filed cash</span>
              {view ? <a className="label head-compare" href={`/s/${encodeURIComponent(view.company.ticker)}`}>Company page →</a> : null}
            </div>
          </div>
          <div className="dcf-search"><Search size="bar" onPick={choose} /></div>
        </div>
      </header>

      {!current ? (
        <p className="state"><span className="pulse" />Reading the filings</p>
      ) : current.error ? (
        <div className="state"><p className="lead num">{ticker}</p><p>{current.error}</p></div>
      ) : !model ? (
        <div className="state">
          <p className="lead num">{ticker}</p>
          <p>
            {view?.basis == null
              ? "No share count is filed for this company, so no valuation can be struck."
              : "This company's free cash flow is not positive, so there is no cash flow for a price to be a multiple of."}
          </p>
        </div>
      ) : (
        <>
          {/*
            * The verdict, in the order the question is asked: what it earns if
            * nothing changes, what it is worth to you, how far that is from the
            * price, and what the price is.
            */}
          <section className="section" style={{ borderTop: 0, paddingTop: 0 }}>
            <div className="grid-ruled stats stats-four">
              {/* "a year" belongs in the label, not in the figure: a cell that
                  crops its own number is worse than one that says less. */}
              <div className="stat">
                <div className="label">Earns a year</div>
                <div className="stat-value" data-empty={model.earns == null || model.earns.kind === "unavailable"}>
                  {model.earns == null || model.earns.kind === "unavailable"
                    ? ABSENT
                    : model.earns.kind === "solved"
                      ? delta(model.earns.rate)
                      : `${model.earns.direction === "above" ? "> " : "< "}${delta(model.earns.bound, 0)}`}
                </div>
              </div>
              <div className="stat">
                <div className="label">Worth at {percent(required, 0)}</div>
                <div className="stat-value">{writePrice(model.worth(required, model.drawn), model.basis.currency)}</div>
              </div>
              <div className="stat">
                <div className="label">Margin</div>
                <div className="stat-value">{delta(model.worth(required, model.drawn) / model.price - 1, 0)}</div>
              </div>
              <div className="stat">
                <div className="label">Price</div>
                <div className="stat-value">{writePrice(model.price, model.basis.currency)}</div>
              </div>
            </div>
            <p className="stat-note" style={{ marginTop: 10 }}>
              {model.record
                ? `Its free cash flow has compounded at ${delta(model.record.rate)} a year over ${Math.round(model.record.years)} years of filings. Buying at ${writePrice(model.price, model.basis.currency)} earns that record, not a forecast of it.`
                : "The filings do not carry enough free cash flow history to state a record."}
            </p>
          </section>

          {/*
            * Every answer at once, because the setting is the argument.
            *
            * A single value per share hides the fact that it is mostly the
            * reader's own requirement: the same company is worth twice as much
            * to somebody who will accept six percent as to somebody who wants
            * twelve. The grid says so outright — each row a growth the filings
            * support, each column a return somebody might require, each cell
            * how far that value sits from what the market charges today.
            */}
          <section className="section">
            <div className="section-head">
              <h2 className="label">Margin against the price</h2>
              {/* The one control on the page: the strip above, the column
                  marked below and the chart under it all answer for it. */}
              <div className="implied-rate-picker">
                <span className="label">Return you require</span>
                <div className="seg">
                  {RATES.map((rate) => (
                    <button key={rate} type="button" aria-pressed={required === rate} onClick={() => setRequired(rate)}>
                      {percent(rate, 0)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="sheet">
              <table>
                <thead>
                  <tr>
                    <th className="key" scope="col">Growth</th>
                    {RATES.map((rate) => <th key={rate} scope="col">{percent(rate, 0)} required</th>)}
                  </tr>
                </thead>
                <tbody>
                  {growths.map((row) => (
                    <tr key={row.label} data-selected={row.id === growth}>
                      <th className="key" scope="row">
                        {/* The name of the row chooses the row, which is what a
                            reader tries first. The cells choose the pair. */}
                        <button
                          type="button"
                          className="dcf-row"
                          aria-pressed={row.id === growth}
                          onClick={() => setGrowth(row.id)}
                        >
                          {row.label}
                          <span className="screener-sector">{delta(row.rate)}</span>
                        </button>
                      </th>
                      {RATES.map((rate) => {
                        const value = model.worth(rate, row.rate);
                        const margin = value / model.price - 1;
                        const here = row.id === growth && rate === required;
                        return (
                          <td key={rate} data-under={margin > 0} data-here={here}>
                            {/* A cell is the pair it stands for: choosing it
                                sets both, and the chart below draws it. */}
                            <button
                              type="button"
                              className="dcf-cell"
                              aria-pressed={here}
                              onClick={() => { setGrowth(row.id); setRequired(rate); }}
                              title={`${writePrice(value, model.basis.currency)} a share`}
                            >
                              {delta(margin, 0)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="stat-note" style={{ marginTop: 10 }}>
              A filled figure is room: the value at that growth and that requirement is above what the market charges.
              Choosing a cell draws it below; hover one for the value a share it comes from.
            </p>
          </section>

          {/* The model itself, drawn — the same panel the company page carries,
              because two implementations of one arithmetic is one too many. The
              page owns the two settings, so there is one of each on screen. */}
          <ImpliedExpectations
            view={view!}
            quote={quote}
            rate={required}
            onRate={setRequired}
            growth={growth}
            onGrowth={setGrowth}
          />
        </>
      )}
    </main>
  );
}
