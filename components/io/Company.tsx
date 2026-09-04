"use client";

import { useEffect, useState } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import { Multiples } from "./Multiples";
import { CHART_ANCHOR, PriceSection } from "./PriceSection";
import { Statements } from "./Statements";
import { Stats } from "./Stats";
import type { IoQuote } from "./quote";
import { fundamentalWindow, type Frequency, type Range } from "./ranges";
import { ABSENT, delta, direction, edgarUrl, price as writePrice, shortDate } from "./format";

/**
 * One company, one screen.
 *
 * The two halves arrive separately and on purpose. Filings are settled for a
 * quarter and cached for a day; a price is settled for no time at all and
 * cached for five minutes. Waiting for both would mean the slower one decides
 * when the page appears, so the statements draw as soon as they land and the
 * headline price fills in beside them.
 *
 * A company nobody has opened here before has to be normalized from raw XBRL
 * first, which is far too expensive to do inside a reader's request — so the
 * endpoint answers "being prepared" and hands the work to a second invocation.
 * This polls for it rather than pretending the wait is not happening.
 */

const POLL_MS = 2_000;
const POLL_LIMIT = 30;

/**
 * Every state names the company it is about.
 *
 * A reader moving from one company to the next keeps this component mounted, so
 * without that name the previous company's statements would stay on screen
 * under the new company's ticker until the fetch landed. Clearing them in an
 * effect would work and would cost a second render of the stale page first;
 * carrying the ticker means the stale state simply is not this ticker's, and
 * the loading view is what renders.
 */
type State =
  | { kind: "loading"; ticker: string; progress: number }
  | { kind: "building"; ticker: string; progress: number }
  | { kind: "failed"; ticker: string; message: string }
  | { kind: "ready"; ticker: string; view: IoCompanyView };

export function Company({ ticker }: { ticker: string }) {
  const [loaded, setLoaded] = useState<State>({ kind: "loading", ticker, progress: 6 });
  const [quoted, setQuoted] = useState<IoQuote | null>(null);
  const [selection, setSelection] = useState<{ ticker: string; metric: string | null }>({ ticker, metric: null });
  const [range, setRange] = useState<Range>("1Y");
  /*
   * A frequency the reader asked for, and the range they asked for it on.
   *
   * The range already implies one — MAX means the annual series, because MAX
   * drawn from trailing figures is six years and a reader asking for everything
   * should get everything. The reader can override that, and moving the range
   * drops the override rather than carrying it somewhere it was never chosen:
   * the override simply is not this range's, so the implied frequency answers
   * again. No effect resets anything.
   */
  const [override, setOverride] = useState<{ range: Range; frequency: Frequency } | null>(null);

  const state: State = loaded.ticker === ticker ? loaded : { kind: "loading", ticker, progress: 6 };
  const quote = quoted?.ticker === ticker ? quoted : null;
  const selectedMetric = selection.ticker === ticker ? selection.metric : null;
  const selectMetric = (metric: string | null) => setSelection({ ticker, metric });
  const frequency: Frequency = override?.range === range ? override.frequency : fundamentalWindow(range).frequency;
  const chooseFrequency = (next: Frequency) => setOverride({ range, frequency: next });

  /*
   * A measure chosen from a statement row brings the chart to the reader.
   *
   * The chart is at the top of the page and the statements run to the bottom of
   * it, so a row clicked down there would otherwise change something nobody can
   * see. Done after the commit rather than in the click handler: the handler
   * runs before React swaps the chart, and the element the scroll was started
   * on is the one being unmounted.
   *
   * It moves only when the chart has actually left the screen — pulling the
   * page from under someone already looking at it is worse than not moving —
   * and it jumps rather than glides. Animating seventeen hundred pixels is a
   * second and a half of blur, and it is a no-op outright wherever the browser
   * has animations turned off, which would leave the reader where they were
   * wondering what their click did.
   */
  useEffect(() => {
    if (!selectedMetric) return;
    const chart = document.getElementById(CHART_ANCHOR);
    if (!chart || chart.getBoundingClientRect().top >= 0) return;
    chart.scrollIntoView({ behavior: "auto", block: "start" });
  }, [selectedMetric]);

  useEffect(() => {
    const controller = new AbortController();
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        // The view shape is edge-cached by URL as well as keyed in KV. Carry
        // its schema in the request so a deployment never pairs a new client
        // with an hour-old response from the previous shape.
        const response = await fetch(`/api/io/${encodeURIComponent(ticker)}?view=iov5`, { signal: controller.signal });
        if (response.status === 202) {
          attempts += 1;
          if (attempts <= POLL_LIMIT) {
            // Cloudflare exposes readiness, not byte-level build progress. The
            // percentage therefore follows the bounded polling window and is
            // explicitly labelled as an estimate; it never claims completion
            // before a real dataset arrives.
            const progress = Math.min(95, 12 + Math.round((attempts / POLL_LIMIT) * 83));
            setLoaded({ kind: "building", ticker, progress });
            timer = setTimeout(load, POLL_MS);
          } else {
            setLoaded({ kind: "failed", ticker, message: "This company is taking longer than expected to prepare. Ask for it again in a minute." });
          }
          return;
        }
        const body = await response.json() as Record<string, unknown>;
        if (!response.ok) {
          const stated = body?.error;
          setLoaded({ kind: "failed", ticker, message: typeof stated === "string" ? stated : `${ticker} could not be loaded.` });
          return;
        }
        setLoaded({ kind: "ready", ticker, view: body as unknown as IoCompanyView });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoaded({ kind: "failed", ticker, message: error instanceof Error ? error.message : "Unreachable." });
      }
    };

    load();

    fetch(`/api/io/${encodeURIComponent(ticker)}/quote`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (body && !controller.signal.aborted) setQuoted(body as IoQuote); })
      .catch(() => { /* The page states a price when there is one and nothing when there is not. */ });

    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [ticker]);

  if (state.kind === "failed") {
    return (
      <main className="wrap">
        <div className="state">
          <p className="lead num">{ticker}</p>
          <p>{state.message}</p>
        </div>
      </main>
    );
  }

  if (state.kind !== "ready") {
    const label = state.kind === "building" ? "Reading the filings" : "Opening company";
    return (
      <main className="wrap">
        <div className="state">
          <p className="lead num">{ticker}</p>
          <p className="load-copy" aria-live="polite">{label} · about {state.progress}%</p>
          <div
            className="load-track"
            role="progressbar"
            aria-label={`${ticker} loading progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.progress}
            aria-valuetext={`About ${state.progress}%`}
          >
            <span style={{ width: `${state.progress}%` }} />
          </div>
        </div>
      </main>
    );
  }

  const view = state.view;
  const company = view.company;
  const latest = view.annual[view.annual.length - 1] ?? view.quarterly[view.quarterly.length - 1] ?? null;
  const filing = latest ? edgarUrl(company.cik, latest.accession) : null;
  // The sign is written on both halves of the move, because on a site with one
  // ink the sign is the only thing carrying direction.
  const moved = quote?.change == null
    ? null
    : `${quote.change < 0 ? "\u2212" : "+"}${writePrice(Math.abs(quote.change), quote.currency)}`;

  return (
    <main className="wrap">
      <header className="head">
        <div className="head-row">
          <div>
            <div className="head-id">
              <h1 className="head-ticker">{company.ticker}</h1>
              <p className="head-name">{company.name}</p>
            </div>
            <div className="head-meta">
              <span className="label">{company.exchange}</span>
              <span className="label">{company.sector}</span>
              {company.cik ? <span className="label">CIK {Number(company.cik)}</span> : null}
            </div>
          </div>

          <div className="price-block">
            <div className="price">{quote ? writePrice(quote.price, quote.currency) : ABSENT}</div>
            <div className="price-change" data-dir={direction(quote?.changePercent ?? null)}>
              {moved == null || quote?.changePercent == null ? ABSENT : `${moved} · ${delta(quote.changePercent)}`}
            </div>
          </div>
        </div>
      </header>

      <PriceSection
        ticker={company.ticker}
        currency={quote?.currency ?? company.currency}
        view={view}
        metricKey={selectedMetric}
        onClearMetric={() => selectMetric(null)}
        range={range}
        onRange={setRange}
        frequency={frequency}
        onFrequency={chooseFrequency}
      />
      <Stats view={view} quote={quote} />
      <Multiples view={view} selected={selectedMetric} onSelect={selectMetric} range={range} frequency={frequency} />
      <Statements view={view} selected={selectedMetric} onSelect={selectMetric} />

      <footer className="foot">
        <span className="label">Source</span>
        {filing
          ? <a className="label" href={filing} target="_blank" rel="noreferrer">SEC EDGAR · {latest?.label} filed {shortDate(latest?.filingDate)}</a>
          : <span className="label">SEC EDGAR</span>}
        <span className="label">Filings read {shortDate(view.retrievedAt)}</span>
        {quote?.asOf ? <span className="label">Price {shortDate(quote.asOf)}</span> : null}
      </footer>
    </main>
  );
}
