"use client";

import { useEffect, useState, type ReactNode } from "react";
import { continueWith, emailSignInLink, useAccount } from "@/components/io/account";
import { GoogleMark } from "@/components/io/AccountPage";

/**
 * TOUR: on black, without the terminal's frame — what Tenqay is, then each
 * part of it as a screenshot of the live product: the market screen, a
 * company page, its operating KPIs and segments, the charts, the portfolio —
 * then the account and the plans. The screenshots are taken from tenqay.com
 * by scripts/tour-screenshots.mjs (public/tour/*.webp), as a first-time
 * visitor sees it, so the tour loads at once and asks the data for nothing. Opened once on a first visit (components/term/Launchpad.tsx,
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
          {step === 0 ? <Intro onNext={() => go(1)} onPlans={() => go(last)} /> : null}
          {step === 1 ? (
            <Screen title="Market overview" line="Real-time indices, futures, rates, currencies, sector performance and market breadth.">
              <Shot url="tenqay.com/t/market" src="/tour/market.webp" alt="The market screen" />
            </Screen>
          ) : null}
          {step === 2 ? (
            <Screen title="Company analysis" line="Pricing, key statistics, quality scoring and company profiles, sourced from SEC filings.">
              <Shot url="tenqay.com/t/s/NVDA" src="/tour/company.webp" alt="Nvidia's company page" />
            </Screen>
          ) : null}
          {step === 3 ? (
            <Screen title="Operating KPIs and segment data" line="Company-reported operating metrics and segment breakdowns, extracted from earnings releases and filings.">
              <div className="t-wel-pair">
                <Shot url="tenqay.com/t/s/DAL#kpi" label="Operating KPIs · Delta" src="/tour/kpi.webp" alt="Delta's operating KPIs" />
                <Shot url="tenqay.com/t/s/AAPL#seg" label="Segments · Apple" src="/tour/segments.webp" alt="Apple's revenue by segment" />
              </div>
            </Screen>
          ) : null}
          {step === 4 ? (
            <Screen title="Technical and fundamental charting" line="Advanced charting with indicators and drawing tools, alongside ten years of reported financials.">
              <div className="t-wel-pair">
                <Shot url="tenqay.com/t/chart" label="Chart workspace" src="/tour/chart.webp" alt="The chart workspace" />
                <Shot url="tenqay.com/t/s/NVDA#gf" label="Fundamental charts · Nvidia" src="/tour/fundamentals.webp" alt="Nvidia's fundamental charts" />
              </div>
            </Screen>
          ) : null}
          {step === 5 ? (
            <Screen title="Portfolio analytics" line="Performance against benchmarks, risk metrics, income and rebalancing, built from your transactions.">
              <Shot url="tenqay.com/t/portfolio" src="/tour/portfolio.webp" alt="The portfolio screen" />
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

/**
 * Page one, as the established platforms open theirs: the positioning, who it
 * is for, one primary action with the terms beside it, the plans one click
 * away, where the data comes from — and the product itself, not a picture of
 * a mood.
 */
function Intro({ onNext, onPlans }: { onNext: () => void; onPlans: () => void }) {
  return (
    <div className="t-wel-hero">
      <div className="t-wel-hero-text">
        <p className="t-wel-mark">TENQAY</p>
        <h1>Market intelligence.</h1>
        <p className="t-wel-sub">Live markets, company fundamentals and macroeconomic data in one terminal — for individual investors and professionals.</p>
        <div className="t-wel-hero-actions">
          <button type="button" className="t-wel-cta t-wel-big" onClick={onNext}>Get started</button>
          <button type="button" className="t-wel-ghost t-wel-big" onClick={onPlans}>View plans</button>
        </div>
        <p className="t-wel-terms">Free during the beta · No payment required</p>
        <ul className="t-wel-points">
          <li>Fundamentals sourced from SEC filings</li>
          <li>Operating KPIs and segment data</li>
          <li>Real-time markets, rates and Fed expectations</li>
          <li>Charting, screening, portfolio analytics and alerts</li>
        </ul>
        <p className="t-wel-sources">Data from SEC EDGAR, the Federal Reserve, the Bureau of Labor Statistics and the Bureau of Economic Analysis.</p>
      </div>
      <Shot url="tenqay.com/t/s/NVDA" src="/tour/company.webp" alt="Nvidia's company page in Tenqay" />
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

/** A screenshot of the terminal inside a window frame. */
function Shot({ url, label, src, alt }: { url: string; label?: string; src: string; alt: string }) {
  return (
    <figure className="t-wel-shot">
      <figcaption><i /><i /><i /><span>{url}</span>{label ? <b>{label}</b> : null}</figcaption>
      <div className="t-wel-shot-view">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot; nothing to optimise on the Worker. */}
        <img src={src} alt={alt} loading="eager" decoding="async" />
      </div>
    </figure>
  );
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
