"use client";

import { Etf } from "@/components/io/Etf";
import { About } from "@/components/io/About";
import { useRef, useState, type CSSProperties } from "react";
import { stated } from "@/lib/sector";
import { useCompany } from "@/components/io/use-company";
import { useCompanyChart } from "@/components/io/use-company-chart";
import { PriceSection } from "@/components/io/PriceSection";
import { Stats } from "@/components/io/Stats";
import { Verdict, type VerdictKey } from "@/components/io/Verdict";
import { Score, useCompanyScore } from "@/components/io/Score";
import { Health } from "@/components/io/Health";
import { GrowthYield } from "@/components/io/GrowthYield";
import { FcfShareGrowth } from "@/components/io/FcfShareGrowth";
import { Multiples } from "@/components/io/Multiples";
import { Growth } from "@/components/io/Growth";
import { Statements } from "@/components/io/Statements";
import { ValuationCharts } from "@/components/io/ValuationCharts";
import { DcfModel } from "@/components/io/DcfModel";
import { Insiders, useInsiders } from "@/components/io/Insiders";
import { Holders } from "@/components/io/Holders";
import { CompanyNews } from "@/components/io/CompanyNews";
import { PendingEarnings } from "@/components/io/PendingEarnings";
import { LenderReading } from "@/components/io/LenderReading";
import { readsAsLender } from "@/lib/io/lender";
import { ABSENT, delta, direction, edgarUrl, price as writePrice, shortDate } from "@/components/io/format";
import { EarningsReaction } from "./EarningsReaction";
import { FundamentalCharts } from "./FundamentalCharts";
import { Estimates } from "@/components/io/Estimates";
import { Segments } from "@/components/io/Segments";
import { Reports } from "@/components/io/Reports";
import { Panel } from "./Panel";
import { Seasonality } from "./Seasonality";

/** The reading an answer at a glance opens, under a code of its own. */
const DETAIL_CODES: Record<VerdictKey, string> = { quality: "QS", health: "HLTH", valuation: "PG", growth: "FCF" };

/**
 * One company, as a terminal screen.
 *
 * The same figures as the document page (components/io/Company.tsx), read
 * through the same two hooks, laid out as panels instead of a column: the price
 * graph and the key statistics side by side at the top, the grade under the
 * statistics, then the financial analysis, the statements, valuation, and the
 * people and news around the company. Every panel is named by the function code
 * that brings it into view, so `AAPL FA` from anywhere lands on Apple's figures.
 *
 * Nothing is folded away. A terminal screen is read by scanning it, and a fold
 * is a thing a scanning eye does not open.
 */
export function TermCompany({ ticker }: { ticker: string }) {
  const { state, quote, valuationQuote } = useCompany(ticker);
  const scoreState = useCompanyScore(ticker);
  const insiderState = useInsiders(ticker);
  /*
   * Which answer at a glance is open, and the column's height when it opened.
   *
   * The graph sets the band and must not move when a reading opens: the
   * column is held at the height it had, the reading takes the news's room
   * and pushes the earnings release down, and the column scrolls if the
   * reading needs more than the band has.
   */
  const [detail, setDetail] = useState<{ ticker: string; key: VerdictKey | null; height: number | null }>({ ticker, key: null, height: null });
  const column = useRef<HTMLDivElement>(null);
  const openDetail = detail.ticker === ticker ? detail.key : null;
  const {
    selectedMetrics, selectMetric, range, setRange, frequency, chooseFrequency,
    rebased, setRebased, withPrice, setWithPrice, valuation,
  } = useCompanyChart(ticker, state, quote);

  if (state.kind === "failed") {
    return (
      <div className="t-loading">
        <p>{ticker} &lt;GO&gt;</p>
        <p className="t-dim">{state.message}</p>
      </div>
    );
  }

  // A fund has a page of its own: what it holds and costs, not statements it does not file.
  if (state.kind === "fund") return <Etf ticker={ticker} surface="terminal" />;

  if (state.kind !== "ready") {
    const label = state.kind === "building" ? "READING FILINGS" : "LOADING";
    return (
      <div className="t-loading">
        <p>{ticker} US EQUITY</p>
        <p className="t-dim" aria-live="polite">{label} · ~{state.progress}%</p>
        <div
          className="t-bar-track"
          role="progressbar"
          aria-label={`${ticker} loading progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={state.progress}
        >
          <span style={{ width: `${state.progress}%` }} />
        </div>
      </div>
    );
  }

  const view = state.view;
  const company = view.company;
  // A lender is read on its own terms (lib/io/lender.ts); the Quality Score keeps the first answer where it grades the company.
  const graded = scoreState.kind === "ready" && scoreState.score.grade !== "NR";
  const lenderDetail = (key: VerdictKey) => readsAsLender(view, key, graded);
  const periods = [...view.annual, ...view.quarterly].sort((a, b) => a.filingDate.localeCompare(b.filingDate));
  const lastFiled = periods.at(-1) ?? null;
  const filing = lastFiled ? edgarUrl(company.cik, lastFiled.accession) : null;
  const moved = quote?.change == null ? null : `${quote.change < 0 ? "−" : "+"}${writePrice(Math.abs(quote.change), quote.currency)}`;
  const identity = [company.exchange, company.sector].map(stated).filter((part): part is string => part != null);
  // The registry's placeholder for a filer it resolved on the fly says nothing about the business.
  const description = company.description && !company.description.startsWith("Dynamically resolved") ? company.description : null;

  return (
    <>
      <header className="t-head">
        <h1 className="t-head-ticker">{company.ticker}</h1>
        <div>
          <p className="t-head-name">{company.name}</p>
          <div className="t-head-meta">
            {identity.map((part) => <span key={part}>{part}</span>)}
            {company.cik ? <span>CIK {Number(company.cik)}</span> : null}
            <span>{quote?.currency ?? company.currency}</span>
          </div>
        </div>
        <div className="t-head-price">
          <span className="t-head-last">{quote ? writePrice(quote.price, quote.currency) : ABSENT}</span>
          <span className="t-head-move" data-dir={direction(quote?.changePercent ?? null)}>
            {moved == null || quote?.changePercent == null ? ABSENT : `${moved}  ${delta(quote.changePercent)}`}
          </span>
        </div>
      </header>

      <div className="t-grid t-company">
        <Chapter area="c-top" number={1} title="Snapshot" note="the price, the key numbers, the verdict, the latest news" />
        <Panel code="GP" area="gp" className="t-fill t-gp">
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
            chartPage="/t/chart"
            surface="terminal"
          />
        </Panel>

        {/*
          * One column beside the graph, and the two always the same height: the
          * column's last panel takes what the graph leaves, and the graph grows
          * when the column is the taller — which it is while an answer of the
          * line at a glance is open, right under that line.
          */}
        <div
          className="t-col t-mcol" ref={column}
          data-held={openDetail && detail.height ? true : undefined}
          style={{ gridArea: "side", "--held": detail.height ? `${detail.height}px` : undefined } as CSSProperties}
        >
          <Panel code="DES" title="Key statistics" className="t-side"
            actions={view.current ? <span>{view.current.label}</span> : null}
          >
            {/* The company's own description where its report can be read; the registry's line otherwise. */}
            <div className="t-panel-pad"><About ticker={company.ticker} /></div>
            {description ? <p className="t-panel-pad t-dim t-about-fallback">{description}</p> : null}
            <Stats view={view} quote={valuationQuote} />
          </Panel>

          <Panel code="SC" className="t-side">
            <Verdict view={view}
              quote={valuationQuote}
              score={scoreState.kind === "ready" ? scoreState.score : null}
              scoreLoading={scoreState.kind === "loading"}
              open={openDetail}
              onToggle={(key) => setDetail({
                ticker,
                key: openDetail === key ? null : key,
                height: openDetail === key ? null : openDetail ? detail.height : column.current?.offsetHeight ?? null,
              })}
            />
          </Panel>

          {openDetail ? (
            <Panel code={DETAIL_CODES[openDetail]} className="t-side-detail">
              {lenderDetail(openDetail) ? <LenderReading view={view} quote={valuationQuote} which={openDetail} /> : null}
              {openDetail === "quality" && !lenderDetail(openDetail) ? <Score key={`score-${company.ticker}`} ticker={company.ticker} state={scoreState} /> : null}
              {openDetail === "health" && !lenderDetail(openDetail) ? <Health view={view} /> : null}
              {openDetail === "valuation" && !lenderDetail(openDetail) ? <GrowthYield view={view} quote={valuationQuote} /> : null}
              {openDetail === "growth" && !lenderDetail(openDetail) ? <FcfShareGrowth view={view} /> : null}
            </Panel>
          ) : null}

          <Panel code="EE" title="Earnings release">
            <PendingEarnings
              view={view}
              empty={
                <p className="t-panel-pad t-dim">
                  No release newer than the filed figures.
                  {lastFiled ? <> Last filed: <span className="t-amber">{lastFiled.label}</span> on {shortDate(lastFiled.filingDate)}.</> : null}
                </p>
              }
            />
          </Panel>

          {/* Last, and scrolling inside whatever height the graph leaves. */}
          <Panel code="CN" className="t-side-news">
            <CompanyNews key={company.ticker} ticker={company.ticker} />
          </Panel>
        </div>

        {/*
          * The page reads the way an analyst reads a company: what it is and
          * how it trades (above), what it does and how it has grown, what it
          * has just reported against what was expected, what it costs against
          * what it is worth, who owns it, and every filed line last. Each
          * chapter is headed, so the thread is visible as well as followed.
          */}
        <Chapter area="c-biz" number={2} title="The business" note="what it sells, what it earns, how it has grown" />
        <Panel code="SEG" title="Segments · revenue, margin and backlog by slice, as filed" area="seg">
          <Segments key={`seg-${company.ticker}`} ticker={company.ticker} cik={company.cik} />
        </Panel>
        {/* The figures and their growth side by side, one height: twelve small multiples fill the figures' half as the growth table fills its own. */}
        <Panel code="FA" area="fa" className="t-fill t-fa">
          <Multiples view={view} selected={selectedMetrics} onSelect={selectMetric} range="MAX" frequency="ttm" collapsedCount={12} />
        </Panel>
        <Panel code="GR" area="gr" className="t-fill">
          <Growth view={view} selected={selectedMetrics} onSelect={selectMetric} />
        </Panel>
        <Panel code="GF" title="Fundamental charts" area="gf">
          <FundamentalCharts key={`gf-${company.ticker}`} view={view} />
        </Panel>

        <Chapter area="c-res" number={3} title="The results" note="what it reported, what is expected, how the stock takes them" />
        <Panel code="RPT" title="Quarterly reports · filed figures, surprise and the stock's reaction" area="rpt">
          <Reports key={`rpt-${company.ticker}`} view={view} />
        </Panel>
        <Panel code="EST" title="Analysts' estimates · forecasts, not filings" area="est">
          <Estimates key={`est-${company.ticker}`} ticker={company.ticker} price={quote?.price ?? null} currency={quote?.currency ?? company.currency} />
        </Panel>
        {/*
          * Two stacks rather than two rows: a short panel beside a tall one left
          * a hole under it in each row. Stacked, the heights even out and the
          * last panel of each stack takes the difference.
          */}
        <div className="t-mcol" style={{ gridArea: "left" }}>
          <Panel code="ERX" title="Earnings reaction · last 12 releases">
            <EarningsReaction key={`erx-${company.ticker}`} ticker={company.ticker} cik={company.cik} />
          </Panel>
        </div>
        <div className="t-mcol" style={{ gridArea: "right" }}>
          <Panel code="SEAS" title="Seasonality · monthly returns">
            <Seasonality key={`seas-${company.ticker}`} symbol={company.ticker} />
          </Panel>
        </div>

        <Chapter area="c-val" number={4} title="The valuation" note="what it costs against its own history, and what the cash is worth" />
        <Panel code="VAL" title="Valuation multiples · through time, against their own range" area="val">
          {/* The multiples through time, each against its own median and range. */}
          <ValuationCharts key={`valc-${company.ticker}`} view={view} quote={valuationQuote} />
        </Panel>
        <Panel code="DCF" title="Discounted cash flow · the value of the cash, against the price" area="dcf">
          <DcfModel key={`dcf-${company.ticker}`} view={view} quote={valuationQuote} />
        </Panel>

        <Chapter area="c-own" number={5} title="Ownership" note="who buys, who sells, who holds" />
        <Panel code="INS" area="ins">
          <Insiders key={`insiders-${company.ticker}`} state={insiderState} />
        </Panel>
        <Panel code="HDS" area="hds">
          <Holders key={`holders-${company.ticker}`} ticker={company.ticker} view={view} />
        </Panel>

        <Chapter area="c-acc" number={6} title="The accounts" note="every filed line, year by year" />
        <Panel code="FS" area="st">
          <Statements view={view} selected={selectedMetrics} onSelect={selectMetric} />
        </Panel>

        <div className="t-panel t-src" style={{ gridArea: "src" }}>
          <span>Source</span>
          {filing
            ? <a href={filing} target="_blank" rel="noreferrer">SEC EDGAR · {lastFiled?.label} filed {shortDate(lastFiled?.filingDate)}</a>
            : <span>SEC EDGAR</span>}
          <span>Filings read {shortDate(view.retrievedAt)}</span>
          {quote?.asOf ? <span>Price {shortDate(quote.asOf)}</span> : null}
        </div>
      </div>
    </>
  );
}

/** A chapter of the company page: a numbered band across the grid. */
function Chapter({ area, number, title, note }: { area: string; number: number; title: string; note: string }) {
  return (
    <div className="t-chapter" style={{ gridArea: area }} role="separator" aria-label={`${number}. ${title}`}>
      <b>{number}</b>
      <span className="t-chapter-title">{title}</span>
      <span className="t-chapter-note">{note}</span>
    </div>
  );
}
