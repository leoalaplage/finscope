"use client";

import { useState } from "react";
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
import { ValuationHistory } from "@/components/io/ValuationHistory";
import { Insiders, useInsiders } from "@/components/io/Insiders";
import { Holders } from "@/components/io/Holders";
import { CompanyNews } from "@/components/io/CompanyNews";
import { PendingEarnings } from "@/components/io/PendingEarnings";
import { LenderReading } from "@/components/io/LenderReading";
import { readsAsLender } from "@/lib/io/lender";
import { ABSENT, delta, direction, edgarUrl, price as writePrice, shortDate } from "@/components/io/format";
import { EarningsReaction } from "./EarningsReaction";
import { FundamentalCharts } from "./FundamentalCharts";
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
  const [detail, setDetail] = useState<{ ticker: string; key: VerdictKey | null }>({ ticker, key: null });
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
        <Panel code="GP" area="gp">
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
          />
        </Panel>

        {/* One column, so the grade sits under the statistics however tall the graph is. */}
        <div className="t-col" style={{ gridArea: "side" }}>
          <Panel code="DES" title="Key statistics" className="t-side"
            actions={view.current ? <span>{view.current.label}</span> : null}
          >
            {description ? <p className="t-panel-pad t-dim">{description}</p> : null}
            <Stats view={view} quote={valuationQuote} />
          </Panel>

          <Panel code="SC" className="t-side">
            <Verdict view={view}
              quote={valuationQuote}
              score={scoreState.kind === "ready" ? scoreState.score : null}
              scoreLoading={scoreState.kind === "loading"}
              open={openDetail}
              onToggle={(key) => setDetail({ ticker, key: openDetail === key ? null : key })}
            />
          </Panel>
        </div>

        <Panel code="EE" title="Earnings release" area="ee">
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

        <Panel code="GF" title="Fundamental charts" area="gf">
          <FundamentalCharts key={`gf-${company.ticker}`} view={view} />
        </Panel>

        <Panel code="ERX" title="Earnings reaction · last 12 releases" area="erx">
          <EarningsReaction key={`erx-${company.ticker}`} ticker={company.ticker} cik={company.cik} />
        </Panel>
        <Panel code="SEAS" title="Seasonality · monthly returns" area="seas">
          <Seasonality key={`seas-${company.ticker}`} symbol={company.ticker} />
        </Panel>

        {openDetail ? (
          <Panel code={DETAIL_CODES[openDetail]} area="dt">
            {lenderDetail(openDetail) ? <LenderReading view={view} quote={valuationQuote} which={openDetail} /> : null}
            {openDetail === "quality" && !lenderDetail(openDetail) ? <Score key={`score-${company.ticker}`} ticker={company.ticker} state={scoreState} /> : null}
            {openDetail === "health" && !lenderDetail(openDetail) ? <Health view={view} /> : null}
            {openDetail === "valuation" && !lenderDetail(openDetail) ? <GrowthYield view={view} quote={valuationQuote} /> : null}
            {openDetail === "growth" && !lenderDetail(openDetail) ? <FcfShareGrowth view={view} /> : null}
          </Panel>
        ) : null}

        <Panel code="FA" area="fa">
          <Multiples view={view} selected={selectedMetrics} onSelect={selectMetric} range="MAX" frequency="ttm" />
        </Panel>
        <Panel code="GR" area="gr">
          <Growth view={view} selected={selectedMetrics} onSelect={selectMetric} />
        </Panel>
        <Panel code="FS" area="st">
          <Statements view={view} selected={selectedMetrics} onSelect={selectMetric} />
        </Panel>
        <Panel code="VAL" area="val">
          <ValuationHistory state={valuation} selected={selectedMetrics} onSelect={selectMetric} />
        </Panel>
        <Panel code="INS" area="ins">
          <Insiders key={`insiders-${company.ticker}`} state={insiderState} />
        </Panel>
        <Panel code="HDS" area="hds">
          <Holders key={`holders-${company.ticker}`} ticker={company.ticker} view={view} />
        </Panel>
        <Panel code="CN" area="cn">
          <CompanyNews key={company.ticker} ticker={company.ticker} />
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
