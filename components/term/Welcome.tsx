"use client";

import { useEffect, useState, type ReactNode } from "react";
import { continueWith, emailSignInLink, useAccount } from "@/components/io/account";
import { GoogleMark } from "@/components/io/AccountPage";
import { OperatingKpis } from "@/components/io/OperatingKpis";
import { Segments } from "@/components/io/Segments";
import { useCompany } from "@/components/io/use-company";
import { FundamentalCharts } from "./FundamentalCharts";
import { MarketBoard } from "./MarketBoard";
import { ChartWorkspace } from "./ChartWorkspace";
import { TermCompany } from "./TermCompany";
import { TermPortfolio } from "./TermPortfolio";

/**
 * TOUR: on black, without the terminal's frame — what Tenqay is, then each
 * part of it as a live screenshot: the market screen, a company page, its
 * operating KPIs and segments, the charts, the portfolio — then the account
 * and the plans. The screens are the product's own, drawn small and still,
 * so what a reader sees is what they get. Opened once on a first visit (components/term/Launchpad.tsx,
 * ONBOARDED_KEY); always on /t/welcome, TOUR, or SET.
 *
 * Tenqay will be paid, monthly or yearly (PLANS); while it is in beta the
 * account is optional and everything is free — no payment is taken yet.
 */

export const ONBOARDED_KEY = "finscope.term.onboarded.v1";
export const markOnboarded = () => { try { localStorage.setItem(ONBOARDED_KEY, new Date().toISOString()); } catch { /* Shown again next time. */ } };

const STEPS = ["Welcome", "Markets", "Companies", "KPIs and segments", "Charts", "Portfolio", "Account"] as const;

/** The plans, in US dollars, as Léo set them (2026-10-15). The annual saving and monthly equivalent are worked out, not typed. */
const PLANS: Array<{ id: "monthly" | "annual"; name: string; amount: number; months: number; period: string }> = [
  { id: "monthly", name: "Monthly", amount: 29.99, months: 1, period: "per month" },
  { id: "annual", name: "Annual", amount: 299.99, months: 12, period: "per year" },
];
const dollars = (value: number) => `$${value.toFixed(2)}`;
const MONTHLY = PLANS.find((plan) => plan.id === "monthly")!;

const INCLUDED = ["Real-time market data, rates and macroeconomic releases", "Fundamentals for every listed company, sourced from SEC filings", "Operating KPIs, segment data and ten-year financial history", "Technical and fundamental charting, screening and backtesting", "Portfolio analytics, valuation models and alerts across devices"];

export function Welcome() {
  const [step, setStep] = useState(0);
  const last = STEPS.length - 1;
  const go = (next: number) => setStep(Math.max(0, Math.min(last, next)));
  const finish = (href = "/t") => { markOnboarded(); window.location.assign(href); };
  useEffect(() => {
    // Seen is enough: a reader who leaves halfway is not sent back on every visit.
    markOnboarded();
    // Back from signing in, the tour reopens on its last step — after hydration, since the page is static.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get("step") === "account") setStep(STEPS.length - 1);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("input, select, textarea")) return;
      if (event.key === "ArrowRight") setStep((current) => Math.min(last, current + 1));
      if (event.key === "ArrowLeft") setStep((current) => Math.max(0, current - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  return (
    <div className="io term t-tour">
      <main className="t-wel" id="main-content">
        <div className="t-wel-progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
          <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <div className="t-wel-meta">
          <span>Step {step + 1} of {STEPS.length}</span>
          {/* Skipping lands on the plans: every new reader sees them before the terminal. */}
          {step < last ? <button type="button" className="t-wel-later" onClick={() => go(last)}>Skip</button> : <span />}
        </div>

        <section className="t-wel-body" aria-live="polite">
          {step === 0 ? <Intro onNext={() => go(1)} /> : null}
          {step === 1 ? (
            <Screen title="Market overview" line="Real-time indices, futures, rates, currencies, sector performance and market breadth.">
              <Shot url="tenqay.com/t/market"><MarketBoard /></Shot>
            </Screen>
          ) : null}
          {step === 2 ? (
            <Screen title="Company analysis" line="Pricing, key statistics, quality scoring and company profiles, sourced from SEC filings.">
              <Shot url="tenqay.com/t/s/NVDA"><TermCompany ticker="NVDA" /></Shot>
            </Screen>
          ) : null}
          {step === 3 ? (
            <Screen title="Operating KPIs and segment data" line="Company-reported operating metrics and segment breakdowns, extracted from earnings releases and filings.">
              <div className="t-wel-pair">
                <Shot url="tenqay.com/t/s/DAL#kpi" label="Operating KPIs · Delta"><div className="t-panel-pad"><OperatingKpis ticker="DAL" cik="0000027904" /></div></Shot>
                <Shot url="tenqay.com/t/s/AAPL#seg" label="Segments · Apple"><Segments ticker="AAPL" cik="0000320193" /></Shot>
              </div>
            </Screen>
          ) : null}
          {step === 4 ? (
            <Screen title="Technical and fundamental charting" line="Advanced charting with indicators and drawing tools, alongside ten years of reported financials.">
              <div className="t-wel-pair">
                <Shot url="tenqay.com/t/chart" label="Chart workspace"><ChartWorkspace /></Shot>
                <Shot url="tenqay.com/t/s/NVDA#gf" label="Fundamental charts · Nvidia"><CompanyCharts ticker="NVDA" /></Shot>
              </div>
            </Screen>
          ) : null}
          {step === 5 ? (
            <Screen title="Portfolio analytics" line="Performance against benchmarks, risk metrics, income and rebalancing, built from your transactions.">
              <Shot url="tenqay.com/t/portfolio"><TermPortfolio /></Shot>
            </Screen>
          ) : null}
          {step === 6 ? <AccountStep onFinish={finish} /> : null}
        </section>

        {step > 0 ? (
          <footer className="t-wel-foot">
            <button type="button" className="t-wel-ghost" onClick={() => go(step - 1)}>Back</button>
            {step < last ? <button type="button" className="t-wel-cta" onClick={() => go(step + 1)}>Continue</button> : null}
          </footer>
        ) : null}
      </main>
    </div>
  );
}

function Intro({ onNext }: { onNext: () => void }) {
  return (
    <div className="t-wel-intro">
      <p className="t-wel-mark">TENQAY</p>
      <h1>Market intelligence for every investor.</h1>
      <p className="t-wel-sub">Real-time market data, company fundamentals and macroeconomic analysis in a single platform.</p>
      <button type="button" className="t-wel-cta t-wel-big" onClick={onNext}>Get started</button>
    </div>
  );
}

function Screen({ title, line, children }: { title: string; line: string; children: ReactNode }) {
  return (
    <div className="t-wel-screen">
      <div className="t-wel-title">
        <div><h2>{title}</h2><p>{line}</p></div>
      </div>
      {children}
    </div>
  );
}

/** A live screen of the terminal, drawn small and still inside a window frame: a screenshot that is never out of date. */
function Shot({ url, label, children }: { url: string; label?: string; children: ReactNode }) {
  return (
    <figure className="t-wel-shot">
      <figcaption><i /><i /><i /><span>{url}</span>{label ? <b>{label}</b> : null}</figcaption>
      <div className="t-wel-shot-view" inert>
        <div className="t-wel-shot-page">{children}</div>
      </div>
    </figure>
  );
}

function CompanyCharts({ ticker }: { ticker: string }) {
  const { state } = useCompany(ticker);
  if (state.kind === "ready") return <FundamentalCharts view={state.view} />;
  return <p className="t-empty">{state.kind === "failed" ? "The filings could not be read just now." : `Reading ${ticker}'s filings…`}</p>;
}

function AccountStep({ onFinish }: { onFinish: (href?: string) => void }) {
  const { account, providers } = useAccount();
  const [address, setAddress] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const back = "/t/welcome?step=account";
  const email = async () => {
    setError(null);
    try { await emailSignInLink(address.trim(), back); setSent(address.trim()); } catch (failure) { setError(failure instanceof Error ? failure.message : "The link could not be sent."); }
  };
  return (
    <div className="t-wel-account">
      <div className="t-wel-signup">
        {account ? (
          <>
            <h2>Welcome, {account.name}</h2>
            <p>Your watchlists, portfolios and alerts are now synchronised across your devices.</p>
            <button type="button" className="t-wel-cta t-wel-big" onClick={() => onFinish()}>Open the terminal →</button>
          </>
        ) : (
          <>
            <h2>Create your account</h2>
            <p>Synchronise your watchlists, portfolios and alerts across your devices.</p>
            {providers.google ? <button type="button" className="t-wel-google" onClick={() => continueWith("google", back)}><GoogleMark />Continue with Google</button> : null}
            {providers.email ? (
              sent ? <p className="t-wel-sent">Check your inbox: a sign-in link is on its way to <b>{sent}</b>.</p> : (
                <form className="t-wel-email" onSubmit={(event) => { event.preventDefault(); void email(); }}>
                  <input type="email" required value={address} onChange={(event) => setAddress(event.target.value)} placeholder="you@example.com" autoComplete="email" aria-label="Email address" />
                  <button type="submit" className="t-wel-cta" disabled={!address.trim()}>Continue with email</button>
                </form>
              )
            ) : null}
            {error ? <p className="t-wel-error" role="alert">{error}</p> : null}
            <button type="button" className="t-wel-later" onClick={() => onFinish()}>Continue without an account →</button>
          </>
        )}
      </div>
      <div className="t-wel-plans">
        <p className="t-wel-beta">Complimentary access during the beta · No payment required</p>
        <div className="t-wel-plan-row">
          {PLANS.map((plan) => {
            const saving = plan.months > 1 ? 1 - plan.amount / (MONTHLY.amount * plan.months) : null;
            return (
              <div key={plan.id} className="t-wel-plan" data-plan={plan.id}>
                <b>{plan.name}{saving ? <span className="t-wel-save">Save {Math.round(saving * 100)}%</span> : null}</b>
                <span className="t-wel-price">{dollars(plan.amount)}<small> {plan.period}</small></span>
                <small>{plan.months > 1 ? `${dollars(plan.amount / plan.months)} a month, billed once a year` : "Billed every month"}</small>
              </div>
            );
          })}
        </div>
        <ul className="t-wel-included">{INCLUDED.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>
    </div>
  );
}
