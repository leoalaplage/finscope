"use client";

import { Etf } from "./Etf";
import { About } from "./About";
import { useEffect, useState } from "react";
import { stated } from "@/lib/sector";
import { FcfShareGrowth } from "./FcfShareGrowth";
import { Growth } from "./Growth";
import { Score, useCompanyScore } from "./Score";
import { Health } from "./Health";
import { Multiples } from "./Multiples";
import { Fold } from "./Fold";
import { CompanyEvents } from "./CompanyEvents";
import { Dividends } from "./Dividends";
import { PeerValuation } from "./PeerValuation";
import { DebtMaturities } from "./DebtMaturities";
import { ThesisNotes } from "./ThesisNotes";
import { GrowthYield } from "./GrowthYield";
import { LenderReading } from "./LenderReading";
import { Estimates } from "./Estimates";
import { Segments } from "./Segments";
import { Reports } from "./Reports";
import { readsAsLender } from "@/lib/io/lender";
import { Verdict, type VerdictKey } from "./Verdict";
import { CHART_ANCHOR, PriceSection } from "./PriceSection";
import { Statements } from "./Statements";
import { Stats } from "./Stats";
import { Holders } from "./Holders";
import { Insiders, useInsiders } from "./Insiders";
import { ValuationCharts } from "./ValuationCharts";
import { DcfModel } from "./DcfModel";
import { FundamentalCharts } from "@/components/term/FundamentalCharts";
import { ABSENT, delta, direction, edgarUrl, price as writePrice, shortDate } from "./format";
import { PendingEarnings } from "./PendingEarnings";
import { useCompany } from "./use-company";
import { useCompanyChart } from "./use-company-chart";

/**
 * One company, one screen. Its figures and price come from useCompany
 * (components/io/use-company.ts), which the terminal reads as well.
 */

export function Company({ ticker }: { ticker: string }) {
  const { state, quote, valuationQuote } = useCompany(ticker);
  const scoreState = useCompanyScore(ticker);
  const insiderState = useInsiders(ticker);
  // Which answer of the line at a glance is open, for this company only.
  const [detail, setDetail] = useState<{ ticker: string; key: VerdictKey | null }>({ ticker, key: null });
  const openDetail = detail.ticker === ticker ? detail.key : null;
  const {
    selectedMetrics, selectMetric, range, setRange, frequency, chooseFrequency,
    rebased, setRebased, withPrice, setWithPrice, valuation,
  } = useCompanyChart(ticker, state, quote);

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
    if (!selectedMetrics.length) return;
    const chart = document.getElementById(CHART_ANCHOR);
    if (!chart || chart.getBoundingClientRect().top >= 0) return;
    chart.scrollIntoView({ behavior: "auto", block: "start" });
  }, [selectedMetrics.length]);

  if (state.kind === "failed") {
    return (
      <main className="wrap" id="main-content" tabIndex={-1}>
        <div className="state">
          <p className="lead num">{ticker}</p>
          <p>{state.message}</p>
        </div>
      </main>
    );
  }

  // A fund has a page of its own: what it holds and costs, not statements it does not file.
  if (state.kind === "fund") return <Etf ticker={ticker} />;

  if (state.kind !== "ready") {
    const label = state.kind === "building" ? "Reading the filings" : "Opening company";
    return (
      <main className="wrap" id="main-content" tabIndex={-1}>
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
  const identity = [company.exchange, company.sector].map(stated).filter((part): part is string => part != null);

  return (
    <main className="wrap" id="main-content" tabIndex={-1}>
      <header className="head">
        <div className="head-row">
          <div>
            <div className="head-id">
              <h1 className="head-ticker">{company.ticker}</h1>
              <p className="head-name">{company.name}</p>
            </div>
            <div className="head-meta">
              {/*
                * A venue we do not know is not a venue called "US listing", and
                * a sector we do not know is not a sector called "Unclassified".
                * Both are the placeholders a dynamically resolved filer carries
                * until the SEC's own classification is read for it, and the
                * research workspace has always dropped them. This page printed
                * them in capitals across the top of the company instead.
                */}
              {identity.map((part) => <span className="label" key={part}>{part}</span>)}
              {company.cik ? <span className="label">CIK {Number(company.cik)}</span> : null}
              {/* The natural next move after reading one company is to hold it
                  against another, and the two pages did not know each other. */}
              <a className="label head-compare" href={`/compare?s=${encodeURIComponent(company.ticker)}`}>Compare →</a>
              {/* The model has a page of its own now, and it opens on this
                  company: the two screens are one reading, not two. */}
              <a className="label head-compare" href={`/dcf?s=${encodeURIComponent(company.ticker)}`}>DCF →</a>
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

      {/* What the company does, in its own words (components/io/About.tsx). */}
      <About ticker={company.ticker} />

      <PendingEarnings view={view} />

      {/*
        * One company in six chapters, in the order an analyst reads it — the
        * terminal's order (components/term/TermCompany.tsx), so the two pages
        * are one reading. What a reader comes for stays open; the long records
        * (statements, insiders, holders, news) are named folds, which say what
        * the page holds and cost nothing until opened.
        *
        * The chart is the top of a company, and a measure chosen below has to
        * have somewhere to be drawn.
        */}
      <Chapter number={1} title="Snapshot" />
      <PriceSection
        ticker={company.ticker}
        currency={quote?.currency ?? company.currency}
        view={view}
        metricKeys={selectedMetrics}
        onClearMetric={() => selectMetric(null)}
        range={range}
        onRange={setRange}
        frequency={frequency}
        onFrequency={chooseFrequency}
        rebased={rebased}
        onRebased={setRebased}
        withPrice={withPrice}
        onWithPrice={setWithPrice}
        valuation={valuation}
      />
      <Stats view={view} quote={valuationQuote} />

      {/*
        * Four answers in one line, each opening its own reading beneath it
        * (components/io/Verdict.tsx); pressing it again closes it.
        */}
      <Verdict view={view}
        quote={valuationQuote}
        score={scoreState.kind === "ready" ? scoreState.score : null}
        scoreLoading={scoreState.kind === "loading"}
        open={openDetail}
        onToggle={(key) => setDetail({ ticker, key: openDetail === key ? null : key })}
      />
      {openDetail && readsAsLender(view, openDetail, scoreState.kind === "ready" && scoreState.score.grade !== "NR")
        ? <LenderReading view={view} quote={valuationQuote} which={openDetail} />
        : <>
          {openDetail === "quality" ? <Score key={`score-${company.ticker}`} ticker={company.ticker} state={scoreState} /> : null}
          {openDetail === "health" ? <Health view={view} /> : null}
          {openDetail === "valuation" ? <GrowthYield view={view} quote={valuationQuote} /> : null}
          {openDetail === "growth" ? <FcfShareGrowth view={view} /> : null}
        </>}

      {/* What the company has announced, by the SEC's own categories (components/io/CompanyEvents.tsx). */}
      <Fold title="Your notes"><ThesisNotes key={`note-${company.ticker}`} view={view} quote={quote} /></Fold>
      <Fold title="Corporate events"><CompanyEvents key={`evt-${company.ticker}`} ticker={company.ticker} cik={company.cik} /></Fold>

      <Chapter number={2} title="Business" />
      {/* The company in slices, as filed (components/io/Segments.tsx). */}
      <Segments key={`seg-${company.ticker}`} ticker={company.ticker} cik={company.cik} />
      {/*
        * Always the whole trailing history, whatever the chart shows: the
        * figures are a record, not a view of the chart.
        */}
      <Multiples view={view} selected={selectedMetrics} onSelect={selectMetric} range="MAX" frequency="ttm" />
      <Growth view={view} selected={selectedMetrics} onSelect={selectMetric} />
      <section className="section-panel" aria-label="Fundamental charts">
        <h3>Fundamental charts</h3>
        <FundamentalCharts key={`gf-${company.ticker}`} view={view} />
      </section>

      <Chapter number={3} title="Results" />
      {/* What analysts expect, labelled as forecasts (components/io/Estimates.tsx). */}
      <Estimates key={`est-${company.ticker}`} ticker={company.ticker} price={quote?.price ?? null} currency={quote?.currency ?? company.currency} />
      {/* Each quarter as filed, against the consensus, and how the stock took it (components/io/Reports.tsx). */}
      <Reports key={`rpt-${company.ticker}`} view={view} />

      <Chapter number={4} title="Valuation" />
      {/* The multiples through time, each against its own median and range. */}
      <ValuationCharts key={`valc-${company.ticker}`} view={view} quote={valuationQuote} />
      <section className="section-panel" id="peer" aria-label="Against peers">
        <h3>Against peers</h3>
        <PeerValuation key={`peer-${company.ticker}`} view={view} quote={valuationQuote} />
      </section>
      <section className="section-panel" id="dcf" aria-label="Discounted cash flow">
        <h3>Discounted cash flow</h3>
        <DcfModel key={`dcf-${company.ticker}`} view={view} quote={valuationQuote} />
      </section>

      <section className="section-panel" id="dvd" aria-label="Dividends">
        <h3>Dividends</h3>
        <Dividends key={`dvd-${company.ticker}`} view={view} price={quote?.price ?? null} />
      </section>

      <Chapter number={5} title="Ownership" />
      {/*
        * Each keyed by the company, so moving to another starts it over rather
        * than leaving one filer's insiders under another's name.
        */}
      <Fold title="Insider dealing"><Insiders key={`insiders-${company.ticker}`} state={insiderState} /></Fold>
      <Fold title="Institutional holders"><Holders key={`holders-${company.ticker}`} ticker={company.ticker} view={view} /></Fold>

      <Chapter number={6} title="Accounts" />
      <section className="section-panel" id="ddis" aria-label="Debt maturities">
        <h3>Debt maturities</h3>
        <DebtMaturities key={`ddis-${company.ticker}`} view={view} />
      </section>
      <Fold title="Statements">
        <Statements view={view} selected={selectedMetrics} onSelect={selectMetric} />
      </Fold>

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

/** A chapter's heading: its name, over a rule. */
function Chapter({ number, title }: { number: number; title: string }) {
  return (
    <div className="chapter" role="separator" aria-label={`${number}. ${title}`}>
      <h2 className="chapter-title">{title}</h2>
    </div>
  );
}
