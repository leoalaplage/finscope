"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { IO_VIEW } from "@/lib/io/view-version";
import { impliedGrowth, impliedReturn, presentValue, terminalShare, valuePath } from "@/lib/io/implied-growth";
import type { ImpliedGrowthTerms } from "@/lib/io/implied-growth";
import { costOfEquity, returnsOf, type CostOfEquity } from "@/lib/io/cost-of-equity";
import { MultiLine, type Series } from "./Plot";
import { Search } from "./Search";
import { rememberCompany } from "@/lib/io/last-company";
import { useRememberedCompany } from "./remembered";
import { logLinearFit } from "@/lib/log-linear.js";
import { withinYears } from "./ranges";
import type { IoQuote } from "./quote";
import { ABSENT, datedCagrOf, delta, money, percent, price as writePrice } from "./format";

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
/**
 * How many of those years hold the rate before it fades to the terminal one.
 *
 * A rate held flat for a decade and then dropped to two and a half per cent
 * overnight is a shape no business has ever had. Five and five is the ordinary
 * two-stage form, and it is not cosmetic: Tesla's price asks 43.5% a year on
 * the flat reading and 61.2% on the fade, because the later years are worth
 * less and the early ones have to carry more.
 */
const HOLD = 5;
const POLL_MS = 2_000;
const POLL_LIMIT = 30;
const TERMINAL = .025;
/** The round numbers a reader may prefer to this company's own cost of equity. */
const RATES = [.06, .08, .10, .12];
/** Five years of weekly returns, which is what a beta is normally measured on. */
const BETA_YEARS = 5;
/** The index the beta is measured against, as this site already serves it. */
const MARKET = "SPY";
/** Which growth the chart is drawn at: a filed record, or the reader's own. */
type GrowthChoice = "near" | "far" | "own";

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

/**
 * The most recent period that reports a positive figure, and which one it was.
 *
 * A discounted cash flow needs cash to discount, so a company whose newest
 * trailing window is negative used to get no page at all: Amazon, spending
 * more on capital projects than it earned last year, and Oracle, doing the
 * same on a larger scale. Both have filed positive free cash flow for most of
 * their history and both are among the largest companies here.
 *
 * The site already does this for its score, which reads the newest period that
 * can be scored rather than refusing the company. So does this: the newest
 * window with cash in it, named on screen, and the negative one stated beside
 * it. A page that says "we are pricing 2024's cash because 2025's was
 * negative, and here is how negative" tells a reader more than a blank does.
 */
function latestPositive(view: IoCompanyView, key: string): { value: number | null; period: IoPeriod | null; skipped: { value: number; period: IoPeriod } | null } {
  const series = [...view.annual, ...view.trailing].sort((left, right) => left.end.localeCompare(right.end));
  let skipped: { value: number; period: IoPeriod } | null = null;
  for (let index = series.length - 1; index >= 0; index--) {
    const value = series[index].values[key];
    if (value == null || !Number.isFinite(value)) continue;
    if (value > 0) return { value, period: series[index], skipped };
    // The newest reading is what the reader expects to see, so a page that
    // prices an older one has to say what it passed over and why.
    if (!skipped) skipped = { value, period: series[index] };
  }
  return { value: null, period: null, skipped };
}

/**
 * What free cash flow compounded at, and over how many years it really did.
 *
 * A compound rate across a change of sign is not a slow rate, it is a
 * meaningless one — a company that burned two billion and now earns four has
 * no growth rate between those two numbers — so `datedCagrOf` refuses it. That
 * refusal used to end the sentence: five of the twenty-seven companies here
 * had one negative year somewhere in the decade and the page said nothing at
 * all about what any of them had done. Chevron burned cash in 2020 and has
 * earned it every year since.
 *
 * So a window that cannot be measured is shortened until it can: the run of
 * consecutive positive years ending at the newest one. What comes back says
 * how long it actually covers, and the page prints that span rather than the
 * span it asked for, which is what it did before for its own reasons.
 *
 * A shortened window still has to be long enough to be a record. Amazon's run
 * is two years across a capital-spending boom and compounds at minus fifty-one
 * per cent a year; stated as "it has delivered", that is worse than saying
 * nothing. Four years is the floor — long enough that one heavy year of
 * investment does not become the company's rate — and below it the page says
 * the filings do not carry a record, which they do not.
 */
const SHORTEST_RECORD = 4;
function delivered(periods: IoPeriod[], years: number) {
  const points = withinYears(periods, years).flatMap((period) => {
    const value = period.values.freeCashFlow;
    return value == null || !Number.isFinite(value) ? [] : [{ date: period.end, value }];
  });
  if (points.length < 2) return null;
  const measured = (from: Array<{ date: string; value: number }>) => {
    if (from.length < 2) return null;
    const rate = datedCagrOf(from);
    const span = (Date.parse(from[from.length - 1].date) - Date.parse(from[0].date)) / (365.25 * 86_400_000);
    return rate == null || !(span > 0) ? null : { rate, years: span };
  };

  /*
   * The whole window first, and the shortened one only where it fails.
   *
   * Shortening unconditionally would rewrite answers that were already right:
   * Booking has one negative year in 2020 and a measurable decade around it,
   * and taking only the run since would state 37.9% a year instead of 11.6%.
   * The short window exists for the case where there is no other, not as a
   * preference.
   */
  const whole = measured(points);
  if (whole) return { ...whole, whole: true };

  // From the newest backwards, stopping at the first year that was not positive.
  let first = points.length;
  while (first > 0 && points[first - 1].value > 0) first -= 1;
  const run = measured(points.slice(first));
  return run && run.years >= SHORTEST_RECORD ? { ...run, whole: false } : null;
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
  /*
   * The reader's own choice, and nothing until they make one.
   *
   * Held as null rather than as a number so the default can be this company's
   * cost of equity the moment it arrives, without an effect writing over a
   * state the reader may already have touched.
   */
  const [chosen, setChosen] = useState<number | null>(null);
  /*
   * Carried with the company it was measured for.
   *
   * A beta belongs to a filer, and a page that keeps the last one while the
   * next is being fetched prices Palantir at Johnson & Johnson's cost of
   * capital for a second — which is a wrong number on screen, not a slow one.
   */
  const [risk, setRisk] = useState<{ ticker: string; value: CostOfEquity | null } | null>(null);
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
    /*
     * A parameter that is not there is not a nought.
     *
     * `Number(null)` is 0, and nought is a valid growth rate — so arriving at
     * /dcf?s=AAPL with no assumption at all set the reader's own rate to zero
     * and offered them a row reading "if it grows at your own rate · 0.0% a
     * year". The required return escaped it only because its floor is one per
     * cent. Both are read as absent unless the address actually carries them.
     */
    const address = new URLSearchParams(search);
    const asRate = (name: string) => {
      const raw = address.get(name);
      if (raw == null || raw.trim() === "") return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const rate = asRate("r");
    const growth = asRate("g");
    if (rate != null && rate >= .01 && rate <= .30) setChosen(rate);
    if (growth != null && growth >= -.50 && growth <= 1) { setAssumed(growth); setPicked("own"); }
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
   * What this company's own risk implies, from figures this site already holds.
   *
   * Three requests the page did not make before: five years of this company's
   * weekly closes, the same weeks of the S&P 500, and the ten-year Treasury.
   * They arrive after the filings and the price, and nothing waits for them —
   * a page that cannot reach them falls back to the reader's own choice, which
   * is what it had before.
   */
  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    const end = new Date();
    const from = new Date(end);
    from.setUTCFullYear(from.getUTCFullYear() - BETA_YEARS);
    const window = `frequency=weekly&start=${from.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`;
    const closes = async (symbol: string) => {
      const response = await fetch(`/api/market/${encodeURIComponent(symbol)}?${window}`, { signal: controller.signal });
      if (!response.ok) return null;
      const body = await response.json() as { bars?: Array<{ close?: number | null; adjustedClose?: number | null }> };
      return (body.bars ?? []).map((bar) => bar.adjustedClose ?? bar.close ?? null);
    };
    (async () => {
      try {
        const [company, market, macro] = await Promise.all([
          closes(ticker),
          closes(MARKET),
          fetch("/api/macro", { signal: controller.signal }).then((response) => response.ok ? response.json() as Promise<{ indicators?: Array<{ id: string; value: number | null }> }> : null),
        ]);
        if (controller.signal.aborted || !company || !market) return;
        const yields = macro?.indicators?.find((item) => item.id === "treasury-10y")?.value ?? null;
        setRisk({ ticker, value: costOfEquity(yields == null ? null : yields / 100, returnsOf(company), returnsOf(market)) });
      } catch {
        // The reader's own choice remains, which is what the page had before.
      }
    })();
    return () => controller.abort();
  }, [ticker]);

  /*
   * The rate every figure on the page is struck at.
   *
   * The reader's if they have chosen one, this company's cost of equity if not,
   * and ten per cent where neither is available. Derived rather than held in
   * state, so the computed rate can arrive late without overwriting a choice
   * already made.
   */
  const priced = risk?.ticker === ticker ? risk.value : null;
  const required = chosen ?? priced?.rate ?? .10;
  /* A computed rate has a decimal and a chosen one does not, and "7%" beside a
     control reading 7.2% is the same number written two ways. */
  const wanted = percent(required, Math.round(required * 1000) % 10 === 0 ? 0 : 1);

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
    setChosen(rate); writeScenario(rate, custom);
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
    const cash = latestPositive(view, "freeCashFlow");
    const mismatch = basis && quote?.currency && quote.currency !== basis.currency;
    const marketCap = basis && !mismatch && quote?.price != null && quote.price > 0 ? quote.price * basis.shares : null;
    if (!basis || marketCap == null || cash.value == null || cash.value <= 0) return null;

    const terms = { marketCap, freeCashFlow: cash.value, years: HORIZON, terminalGrowth: TERMINAL, holdYears: HOLD };
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
  /*
   * How much of the answer is the perpetuity, and which cash it was struck on.
   *
   * The first is the caveat a discounted cash flow never carries: ten years of
   * projected cash is the part anybody can argue about, and everything after
   * it is one number standing for the rest of time. On these terms it is
   * routinely two thirds of the value, and a reader trusting the figure above
   * should know how much of it they are trusting.
   */
  const perpetuity = model && priceAsks != null ? terminalShare({ ...model.terms, discountRate: required }, priceAsks) : null;

  /*
   * Whether the year this is all compounded from looks like the decade behind it.
   *
   * A discounted cash flow grows one filed figure forward for ten years, so
   * that figure carries the whole answer, and choosing it is not neutral. The
   * obvious corrections do not work: the median of the decade punishes any
   * company that grew — Mastercard's free cash flow is a near-perfect straight
   * line and its median still sits ninety-nine per cent below the last point —
   * and a line fitted through the decade is right where the deviation is noise
   * and stale where it is a change of regime. Lilly's cash flow really did step
   * up; the line through the ten years before it says four billion against the
   * eighteen it filed.
   *
   * So the base is not corrected. It is checked, and where it stands well clear
   * of the trend the page says so — one sentence, and the reader decides
   * whether they are looking at a new level or a good year.
   */
  const AWAY_FROM_TREND = .25;
  const base = useMemo(() => {
    if (!view || !model?.cash.period) return null;
    const annual = withinYears(view.annual, 10)
      .flatMap((period) => {
        const value = period.values.freeCashFlow;
        return value == null || !Number.isFinite(value) ? [] : [{ date: period.end, value }];
      });
    if (annual.length < 4) return null;
    const start = Date.parse(annual[0].date);
    const years = (date: string) => (Date.parse(date) - start) / (365.25 * 86_400_000);
    const fit = logLinearFit(annual.map((point) => ({ x: years(point.date), value: point.value })));
    if (!fit) return null;
    const line = fit.at(years(model.cash.period.end));
    if (!(line > 0) || model.cash.value == null) return null;
    const off = model.cash.value / line - 1;
    return Math.abs(off) < AWAY_FROM_TREND ? null : { off, line };
  }, [view, model]);

  /*
   * The finding, in two halves: what is true, and what it means.
   *
   * The second half is the one sentence on this page a reader could act on, so
   * it is highlighted the way today's move is on the market table — the width
   * of the words, in the same green and red, with the words themselves saying
   * which way it goes for anyone who cannot separate the two hues.
   */
  const reading = (() => {
    if (!model) return null;
    const price = writePrice(model.price, model.basis.currency);
    const name = view?.company.name ?? ticker;
    if (model.asks.kind === "beyond") {
      return model.asks.direction === "above"
        ? { fact: `No growth this model can project justifies ${price}: even at ${percent(model.asks.bound, 0)} a year for ten years, ten years of this company's free cash flow discounted at ${wanted} comes to less than the price.`, verdict: null, dir: null }
        : { fact: `${price} is below what ten years of this company's free cash flow is worth at ${wanted} even if that cash flow never grows again.`, verdict: null, dir: null };
    }
    if (model.asks.kind !== "solved") return { fact: model.asks.reason, verdict: null, dir: null };
    const asks = model.asks.rate;
    const head = `To pay ${price} today and still earn ${wanted} a year, ${name}'s free cash flow has to grow ${percent(asks, 1)} a year for ten years.`;
    if (!model.record) return { fact: `${head} The filings do not carry enough free cash flow history to say what it has grown at before.`, verdict: null, dir: null };
    const done = model.record.rate;
    // A shortened window says so, because "the 8 years it has filed" would be
    // a false claim about a company that has filed a decade of them.
    const span = Math.round(model.record.years);
    const over = model.record.whole
      ? `Over the ${span} ${span === 1 ? "year" : "years"} it has filed, it grew ${percent(done, 1)} a year.`
      : `A rate across its last negative year would mean nothing, so the window stops there: over the ${span} ${span === 1 ? "year" : "years"} since, it grew ${percent(done, 1)} a year.`;
    const fact = `${head} ${over}`;
    if (Math.abs(asks - done) < .005) {
      return { fact, verdict: "The price is asking for about what the company has delivered.", dir: "flat" as const };
    }
    return asks > done
      ? { fact, verdict: "The price is asking for more than the company has delivered.", dir: "down" as const }
      : { fact, verdict: "The price is asking for less than the company has delivered.", dir: "up" as const };
  })();

  /*
   * The same question the other way round, and the reason this page needs no
   * assumption at all.
   *
   * Requiring a return and solving for growth is one reading; taking the growth
   * the company has actually delivered and solving for the return is the other,
   * and it is the one most readers mean by "is this worth buying". Both records
   * are on offer because they routinely disagree — a five-year rate off a
   * pandemic trough against a decade that contains it — and the reader's own
   * rate is the third row rather than the price of admission.
   */
  const earnings = useMemo(() => {
    if (!model) return [];
    const rows: Array<{ id: GrowthChoice; label: string; rate: number }> = [];
    if (near) rows.push({ id: "near", label: `If it grows like the last ${Math.round(near.years)} years`, rate: near.rate });
    if (record && (!near || record.years > near.years + .5)) {
      rows.push({ id: "far", label: `If it grows like the last ${Math.round(record.years)} years`, rate: record.rate });
    }
    /*
     * The reader's own rate is a row only once it is a number somebody chose.
     *
     * It opens on the longest record the filings support; where there is no
     * record — Amazon, Oracle, both spending more than they earn — there is
     * nothing for it to open on, and a row reading "if it grows at your own
     * rate · 0.0% a year" offers a default nobody set as though it were an
     * assumption somebody made.
     */
    if (assumed != null || record != null || near != null) {
      rows.push({ id: "own", label: "If it grows at your own rate", rate: custom });
    }
    return rows.map((row) => ({ ...row, earns: impliedReturn(model.terms, row.rate) }));
  }, [model, near, record, custom, assumed]);

  /** A return that solves, a bound where it does not, and nothing invented. */
  const earned = (result: ReturnType<typeof impliedReturn>) => result.kind === "solved"
    ? percent(result.rate, 1)
    : result.kind === "beyond"
      ? `${result.direction === "above" ? "over " : "under "}${percent(result.bound, 0)}`
      : ABSENT;

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
                  {/* This company's own cost of equity first, and pressed until
                      the reader picks otherwise: a round number is a choice
                      nobody made, and moving it four points moves the answer by
                      seven to twelve. */}
                  {priced ? (
                    <button type="button" aria-pressed={chosen == null} onClick={() => { setChosen(null); writeScenario(priced.rate, custom); }}>
                      {percent(priced.rate, 1)}
                    </button>
                  ) : null}
                  {RATES.map((rate) => (
                    <button key={rate} type="button" aria-pressed={chosen === rate} onClick={() => requireReturn(rate)}>
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
                  {model.record == null
                    ? "no filed record"
                    : `a year, over ${Math.round(model.record.years)} ${Math.round(model.record.years) === 1 ? "year" : "years"}`
                      + (model.record.whole ? " of filings" : " since its last year of burning cash")}
                </div>
              </div>
              <div className="stat">
                <div className="label">Fair value at that record</div>
                <div className="stat-value" data-empty={model.record == null}>
                  {model.record == null ? ABSENT : writePrice(model.worth(required, model.record.rate), model.basis.currency)}
                </div>
                <div className="stat-note">
                  {model.record == null
                    ? `against ${writePrice(model.price, model.basis.currency)} today`
                    /* The margin of safety, named: how far the value sits above
                       what the market charges, or how far short it falls. */
                    : `${delta(model.worth(required, model.record.rate) / model.price - 1, 0)} margin against ${writePrice(model.price, model.basis.currency)} today`}
                </div>
              </div>
            </div>

            <p className="verdict-sentence">
              {reading?.fact}
              {reading?.verdict ? <> <span className="day-mark" data-dir={reading.dir}>{reading.verdict}</span></> : null}
            </p>

            {/*
              * And what that same record would earn you at today's price.
              *
              * The page asked the reader for a growth rate and gave back a
              * value; this asks nothing and gives back the figure the question
              * is really about. The reader's own rate is the last row, so the
              * field below is an addition to the answer rather than the way in
              * to it.
              */}
            {earnings.length ? (
              <ul className="verdict-earns">
                {earnings.map((row) => (
                  <li key={row.id} data-selected={row.id === growth}>
                    <button type="button" aria-pressed={row.id === growth} onClick={() => setGrowth(row.id)}>
                      <span>{row.label}</span>
                      <small>{percent(row.rate, 1)} a year</small>
                    </button>
                    <span className="verdict-earns-value" data-empty={row.earns.kind === "unavailable"}>
                      {earned(row.earns)}
                    </span>
                    <span className="label">a year, buying today</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {/*
              * What the reader is trusting, and what it was struck on.
              *
              * Two facts a discounted cash flow normally hides: how much of it
              * is the period nobody can observe, and which filed window the
              * cash came from when the newest one could not be used.
              */}
            <p className="stat-note verdict-terms">
              {/* Where the rate came from, when it came from this company
                  rather than from the reader. */}
              {chosen == null && priced
                ? `${percent(priced.rate, 1)} is this company's cost of equity: ${percent(priced.riskFree, 2)} on the ten-year Treasury plus a beta of ${priced.beta.toFixed(2)} against the S&P 500 at a ${percent(priced.premium, 0)} equity risk premium. `
                : null}
              {perpetuity == null
                ? null
                : `${percent(perpetuity, 0)} of that value is the perpetuity after year ${HORIZON} rather than the ten years projected. `}
              {/* A sum of billions is written as billions: a share price wants
                  its cents and a cash flow does not. */}
              {model.cash.period ? `Struck on ${model.cash.period.label}'s free cash flow of ${money(model.cash.value, model.basis.currency)}` : null}
              {model.cash.skipped
                ? `, because ${model.cash.skipped.period.label} was ${money(model.cash.skipped.value, model.basis.currency)} — the company spent more than it earned.`
                : model.cash.period ? "." : null}
              {/* The whole answer compounds from that one year, so a year
                  unlike the decade behind it is worth naming. Whether it is a
                  new level or a good year is a judgement about the business,
                  not about the arithmetic, and it stays the reader's. */}
              {base
                ? ` That is ${base.off > 0 ? `${(1 + base.off).toFixed(1)}\u00d7` : `${(100 * (1 + base.off)).toFixed(0)}% of`} what the decade's trend puts at the same date — the answer above rests on a year unlike the ten behind it.`
                : null}
            </p>

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
                /* Empty rather than nought where no record set it: the field
                   should not read as an assumption until one is made. */
                value={assumed == null && record == null && near == null ? "" : Number((custom * 100).toFixed(2))}
                onChange={(event) => {
                  const typed = Number(event.target.value);
                  if (Number.isFinite(typed)) assume(typed / 100);
                }}
                aria-label="Growth in free cash flow you assume, in percent a year"
              />
              <span className="label">% a year</span>
            </label>
          </section>

          {/*
            * One chart, both halves of the question.
            *
            * The vertical gap at year nought is the margin on buying today —
            * what it is worth against what it costs. The slope after it is the
            * potential, and where a line meets the flat one is the year the
            * company is worth what you would pay for it now. Nothing here is a
            * colour: each line is dashed differently and named at its own end,
            * the way every multi-series chart on this site is.
            */}
          <ValueOverTime model={model} required={required} rows={earnings} />
        </>
      )}
    </main>
  );
}

/**
 * What it is worth, year by year, against what it costs today.
 *
 * A discounted cash flow's answer is one number and its argument is a shape:
 * the same company is worth two different things to two readers who disagree
 * about growth by two points a year. This draws the shape — one line for each
 * rate the company has actually delivered, and a flat one at the price.
 *
 * Two things are read off it and neither needs explaining. The vertical gap at
 * the left is the margin on buying now. Where a rising line meets the flat one
 * is the year the business becomes worth what the market is charging for it
 * today — and a line that never meets it is a price this record does not
 * justify inside the horizon.
 */
function ValueOverTime({ model, required, rows }: {
  model: { terms: Omit<ImpliedGrowthTerms, "discountRate">; basis: { shares: number; currency: string }; price: number };
  required: number;
  rows: Array<{ id: string; label: string; rate: number }>;
}) {
  const [year, setYear] = useState<number | null>(null);

  const series = useMemo<Series[]>(() => {
    const horizon = model.terms.years;
    const dated = (index: number) => (index === 0 ? "today" : `+${index}y`);
    /*
     * The reader's own rate only earns a line where it is their own.
     *
     * It opens on the longest record, so drawing it unconditionally would put
     * a second line exactly on top of the first and label the same series
     * twice.
     */
    const drawn = rows.filter((row, index) =>
      row.id !== "own" || !rows.some((other, place) => place < index && Math.abs(other.rate - row.rate) < .005));
    /*
     * Short names, because the name is set on the line itself.
     *
     * The rows above already say what each rate is and what it earns; a line
     * carrying "Worth if it grows like the last 5 years" at its own end runs
     * off the chart and repeats a sentence the reader has just read.
     */
    const paths = drawn.map((row) => ({
      label: row.id === "own" ? "Your rate" : row.id === "near" ? "5-year rate" : "10-year rate",
      points: valuePath({ ...model.terms, discountRate: required }, row.rate)
        .map((value, index) => ({ date: dated(index), value: value / model.basis.shares })),
    }));
    return [
      ...paths,
      {
        label: "What it costs today",
        points: Array.from({ length: horizon + 1 }, (unused, index) => ({ date: dated(index), value: model.price })),
      },
    ];
  }, [model, required, rows]);

  const at = year == null ? 0 : year;
  /*
   * The last series is the price, and every other one is measured against it.
   *
   * A single margin figure would have to pick one of the rates and call it the
   * answer; there are two or three on screen precisely because they disagree.
   * So each line carries its own gap, marked the way today's move is on the
   * market table.
   */
  const cost = series.at(-1)?.points[at]?.value ?? model.price;
  const readings = series.slice(0, -1).map((entry) => {
    const value = entry.points[at]?.value ?? null;
    return { label: entry.label, value, gap: value == null || !(cost > 0) ? null : value / cost - 1 };
  });

  return (
    <section className="section" id="worth">
      <div className="section-head">
        <h2 className="label">What it is worth, year by year</h2>
        <span className="label">
          Discounted at {percent(required, 1)} · {model.terms.holdYears ?? model.terms.years} years at the rate, then fading to {percent(model.terms.terminalGrowth, 1)}
        </span>
      </div>

      {/* The readout says the year and every line at it, so the chart needs no
          tooltip following the cursor and no legend in a corner. */}
      <div className="worth-readout">
        <span className="worth-year">{year == null ? "Today" : `In ${year} ${year === 1 ? "year" : "years"}`}</span>
        {readings.map((reading) => (
          <span className="worth-reading" key={reading.label}>
            <span className="label">{reading.label}</span>
            {reading.value == null ? ABSENT : writePrice(reading.value, model.basis.currency)}
            {reading.gap == null ? null : (
              <span className="day-mark" data-dir={reading.gap >= 0 ? "up" : "down"}>{delta(reading.gap, 0)}</span>
            )}
          </span>
        ))}
        <span className="worth-reading worth-cost">
          <span className="label">It costs</span>
          {writePrice(cost, model.basis.currency)}
        </span>
      </div>

      <MultiLine series={series} onHover={setYear} />
    </section>
  );
}
