"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { IO_VIEW } from "@/lib/io/view-version";
import { impliedGrowth, impliedReturn, presentValue } from "@/lib/io/implied-growth";
import { ImpliedExpectations, type GrowthChoice } from "./ImpliedExpectations";
import { Search } from "./Search";
import { rememberCompany } from "@/lib/io/last-company";
import { useRememberedCompany } from "./remembered";
import { withinYears } from "./ranges";
import type { IoQuote } from "./quote";
import { ABSENT, datedCagrOf, delta, percent, price as writePrice } from "./format";

/**
 * One company, one question: what would have to be true for this price.
 *
 * A discounted cash flow is normally a machine a reader has to drive — a growth
 * rate, a discount rate, a terminal assumption, a horizon — and it answers
 * whatever it is fed. This page turns it round and asks the only version of the
 * question that needs nothing from the reader: at today's price, what growth
 * would the company have to deliver? That number is arithmetic on the price,
 * not a forecast, and it can be set beside what the company has actually done
 * and read in a sentence.
 *
 * So the page opens answered. One control moves it — the return you want a year
 * — and it is a control with a plain label rather than four bare percentages.
 * A second, optional, lets a reader put their own growth rate in; everything
 * else on screen is filed or is arithmetic on filings.
 *
 * It carried a strip of four statistics, three named cases, a growth field and
 * a twelve-cell grid of margins, and a reader had to understand all four to
 * read any of them. What replaced them is one sentence and one number.
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
  /*
   * The company you were last reading, when the address does not name one.
   *
   * The two pages are one reading: a company page links to this one for the
   * company it shows, and arriving here from the bar — which names no company —
   * should not throw the reader back to whatever the registry happens to list
   * first. Read once, after mount, because the document is a prerendered
   * constant and this is a fact about the device rather than about the page.
   */
  const remembered = useRememberedCompany();
  const ticker = asked || remembered || initial;

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
  /*
   * The growth the reader assumes, which starts on what the company did.
   *
   * The filings anchor the question and cannot answer it: the reader is buying
   * the next ten years, not the last ten. So the records are rows and this is a
   * figure they can set — opened on the longest record so it starts somewhere
   * real, and named "you assume" everywhere it appears so it is never mistaken
   * for something filed.
   */
  const [assumed, setAssumed] = useState<number | null>(null);
  const current = loaded?.ticker === ticker ? loaded : null;

  // A shared address is authoritative on first arrival and when the ticker in
  // the address changes. Invalid assumptions are ignored rather than guessed.
  /* The URL is an external store; applying a browser navigation to the model is
     precisely the synchronization this effect owns. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const address = new URLSearchParams(search);
    const rate = Number(address.get("r"));
    const growth = Number(address.get("g"));
    if (Number.isFinite(rate) && rate >= .01 && rate <= .30) setRequired(rate);
    if (Number.isFinite(growth) && growth >= -.50 && growth <= 1) { setAssumed(growth); setPicked("own"); }
  }, [asked, search]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
        // The company page and this one share a memory, so the bar's "Company"
        // returns to the filer whose valuation is on screen.
        rememberCompany(ticker);
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
    ?? (record != null && near != null && record.years > near.years + .5 ? "far" : "near");
  // Opened on the longest record the filings support, rounded to the half point
  // the control steps in, and the reader's from the first edit onwards.
  const custom = assumed ?? Math.round((record?.rate ?? near?.rate ?? 0) * 200) / 200;
  /** The two settings live in the address, so a reading can be sent as a link. */
  const writeScenario = (rate: number, growthRate: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set("s", ticker);
    url.searchParams.set("r", rate.toFixed(4));
    url.searchParams.set("g", growthRate.toFixed(4));
    window.history.replaceState(null, "", url);
  };
  const assume = (next: number) => {
    const growthRate = Math.min(1, Math.max(-.5, next));
    setAssumed(growthRate);
    setPicked("own");
    writeScenario(required, growthRate);
  };
  const setGrowth = (next: GrowthChoice) => {
    setPicked(next);
    const growthRate = next === "near" ? near?.rate ?? custom : next === "far" ? record?.rate ?? custom : custom;
    writeScenario(required, growthRate);
  };
  const requireReturn = (rate: number) => {
    setRequired(rate); writeScenario(rate, custom);
  };

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
    const drawn = growth === "own" ? custom
      : growth === "near" ? near?.rate ?? record?.rate ?? 0
      : growth === "far" ? record?.rate ?? 0
      : impliedGrowth({ ...terms, discountRate: required }).kind === "solved"
        ? (impliedGrowth({ ...terms, discountRate: required }) as { rate: number }).rate
        : record?.rate ?? 0;
    return {
      basis, cash, marketCap, record, terms, worth, drawn,
      price: quote?.price ?? marketCap / basis.shares,
      /*
       * What the price earns at the growth on screen.
       *
       * It followed the record alone while the growth was a record, and stayed
       * there once the reader could set their own — so the strip answered for
       * one assumption while the grid and the chart answered for another. Every
       * figure on this page is now the same pair: this growth, this
       * requirement.
       */
      earns: impliedReturn(terms, drawn),
      // And what it must do for the return the reader wants.
      asks: impliedGrowth({ ...terms, discountRate: required }),
    };
  }, [view, quote, required, growth, record, near, custom]);

  /*
   * The growth today's price is asking for, and the sentence that reads it.
   *
   * `impliedGrowth` will not always solve: a company priced above anything a
   * ten-year projection can reach returns a bound instead of a rate, and the
   * page says which side of it the price sits on rather than inventing a
   * figure. The comparison sentence is only written where both halves are
   * numbers, because "more than the record" is a claim and needs two of them.
   */
  const priceAsks = model?.asks.kind === "solved" ? model.asks.rate : null;
  const sentence = (() => {
    if (!model) return "";
    const price = writePrice(model.price, model.basis.currency);
    const name = view?.company.name ?? ticker;
    if (model.asks.kind === "beyond") {
      return model.asks.direction === "above"
        ? `No growth this model can project justifies ${price}: even at ${percent(model.asks.bound, 0)} a year for ten years, ten years of this company's free cash flow discounted at ${percent(required, 0)} comes to less than the price.`
        : `${price} is below what ten years of this company's free cash flow is worth at ${percent(required, 0)} even if that cash flow never grows again.`;
    }
    if (model.asks.kind !== "solved") return model.asks.reason;
    const asks = model.asks.rate;
    const head = `To pay ${price} today and still earn ${percent(required, 0)} a year, ${name}'s free cash flow has to grow ${percent(asks, 1)} a year for ten years.`;
    if (!model.record) return `${head} The filings do not carry enough free cash flow history to say what it has grown at before.`;
    const done = model.record.rate;
    const over = `Over the ${Math.round(model.record.years)} years it has filed, it grew ${percent(done, 1)} a year.`;
    const verdict = Math.abs(asks - done) < .005
      ? "The price is asking for about what the company has delivered."
      : asks > done
        ? "The price is asking for more than the company has delivered."
        : "The price is asking for less than the company has delivered.";
    return `${head} ${over} ${verdict}`;
  })();

  return (
    <main className="wrap dcf-page" id="main-content" tabIndex={-1}>
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
            * The page, answered before anything is touched.
            *
            * Three readings and a sentence. The first is arithmetic on the
            * price and the second is arithmetic on the filings, so the
            * comparison between them is a fact rather than a view — which is
            * the whole reason this page asks the question backwards.
            */}
          <section className="section verdict" style={{ borderTop: 0, paddingTop: 0 }}>
            <div className="section-head">
              <h2 className="label">Is there room to buy?</h2>
              {/*
                * The one control, and it says what it is.
                *
                * Four bare percentages beside a heading are four percentages of
                * nothing. This is the only figure on the page nobody filed, and
                * every number here moves with it.
                */}
              <label className="verdict-rate">
                <span className="label">The return you want a year</span>
                <span className="seg">
                  {RATES.map((rate) => (
                    <button key={rate} type="button" aria-pressed={required === rate} onClick={() => requireReturn(rate)}>
                      {percent(rate, 0)}
                    </button>
                  ))}
                </span>
              </label>
            </div>

            <div className="grid-ruled stats stats-three">
              <div className="stat">
                <div className="label">The price asks for</div>
                <div className="stat-value" data-empty={priceAsks == null}>{priceAsks == null ? ABSENT : percent(priceAsks, 1)}</div>
                <div className="stat-note">a year, for ten years</div>
              </div>
              <div className="stat">
                <div className="label">It has delivered</div>
                <div className="stat-value" data-empty={model.record == null}>
                  {model.record == null ? ABSENT : percent(model.record.rate, 1)}
                </div>
                <div className="stat-note">
                  {model.record == null ? "no filed record" : `a year, over ${Math.round(model.record.years)} years of filings`}
                </div>
              </div>
              <div className="stat">
                <div className="label">Worth at that record</div>
                <div className="stat-value" data-empty={model.record == null}>
                  {model.record == null ? ABSENT : writePrice(model.worth(required, model.record.rate), model.basis.currency)}
                </div>
                <div className="stat-note">
                  {model.record == null
                    ? `against ${writePrice(model.price, model.basis.currency)} today`
                    : `${delta(model.worth(required, model.record.rate) / model.price - 1, 0)} against ${writePrice(model.price, model.basis.currency)} today`}
                </div>
              </div>
            </div>

            <p className="verdict-sentence">{sentence}</p>

            {/*
              * The second control, and the last: optional, and named as an
              * assumption. Everything above it is filed or is arithmetic on a
              * filing; this is the reader putting a number of their own in, and
              * the model below redraws on it.
              */}
            <label className="verdict-assume">
              <span className="label">Or try your own growth</span>
              <input
                type="number"
                inputMode="decimal"
                step=".5"
                min={-50}
                max={100}
                value={Number((custom * 100).toFixed(2))}
                onChange={(event) => {
                  const typed = Number(event.target.value);
                  if (Number.isFinite(typed)) assume(typed / 100);
                }}
                aria-label="Growth in free cash flow you assume, in percent a year"
              />
              <span className="label">% a year</span>
            </label>
          </section>

          {/* The model itself, drawn — the same panel the company page carries,
              because two implementations of one arithmetic is one too many. The
              page owns the two settings, so there is one of each on screen. */}
          <ImpliedExpectations
            view={view!}
            quote={quote}
            rate={required}
            growth={growth}
            onGrowth={setGrowth}
            custom={custom}
          />
        </>
      )}
    </main>
  );
}
