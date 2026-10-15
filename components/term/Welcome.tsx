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
 * Tenqay will be paid — Professional monthly or yearly (PRICES), Enterprise by agreement; while in beta the
 * account is optional and everything is free — no payment is taken yet.
 */

export const ONBOARDED_KEY = "finscope.term.onboarded.v1";
export const markOnboarded = () => { try { localStorage.setItem(ONBOARDED_KEY, new Date().toISOString()); } catch { /* Shown again next time. */ } };

const STEPS = ["Welcome", "Markets", "Companies", "KPIs and segments", "Charts", "Portfolio", "Plans"] as const;

/** Professional, in US dollars, as Léo set it (2026-10-15). The annual saving and monthly equivalent are worked out, not typed. */
const PRICES = { monthly: 29.99, annual: 299.99 } as const;
const dollars = (value: number) => `$${value.toFixed(2)}`;
const SAVING = Math.round((1 - PRICES.annual / (PRICES.monthly * 12)) * 100);
/** Where enterprise enquiries go: an address on Tenqay's own domain, forwarded by Cloudflare Email Routing. */
const SALES = "sales@tenqay.com";

const PRO_FEATURES = [
  "Real-time markets, rates and Fed expectations",
  "Fundamentals for every listed company, from SEC filings",
  "Operating KPIs, segments and ten-year history",
  "Technical and fundamental charting",
  "Screener and backtesting",
  "Portfolio analytics and valuation models",
  "Alerts by browser and email, synced across devices",
];
const ENTERPRISE_FEATURES = [
  "Everything in Professional",
  "Multiple seats under one agreement",
  "Volume pricing",
  "Invoice billing",
  "Priority support",
  "Onboarding for your team",
  "Coverage and data requests",
];
/** The comparison under the plans: one row a capability, what each plan holds. */
const COMPARE: Array<[string, string, string]> = [
  ["Market data, rates and macro", "✓", "✓"],
  ["Company fundamentals and filings", "✓", "✓"],
  ["Operating KPIs and segment data", "✓", "✓"],
  ["Charting, screening and backtesting", "✓", "✓"],
  ["Portfolio analytics and alerts", "✓", "✓"],
  ["Seats", "1", "Multiple"],
  ["Billing", "Card, monthly or annual", "Invoice, annual"],
  ["Support", "Email", "Priority"],
  ["Team onboarding", "—", "✓"],
];

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
                <Shot url="tenqay.com/t/s/DAL#kpi" label="Operating KPIs · Delta" ratio="3 / 2" src="/tour/kpi.webp" alt="Delta's operating KPIs" />
                <Shot url="tenqay.com/t/s/AAPL#seg" label="Segments · Apple" ratio="3 / 2" src="/tour/segments.webp" alt="Apple's revenue by segment" />
              </div>
            </Screen>
          ) : null}
          {step === 4 ? (
            <Screen title="Technical and fundamental charting" line="Advanced charting with indicators and drawing tools, alongside ten years of reported financials.">
              <div className="t-wel-pair">
                <Shot url="tenqay.com/t/chart" label="Chart workspace" ratio="4 / 3" src="/tour/chart.webp" alt="The chart workspace" />
                <Shot url="tenqay.com/t/s/NVDA#gf" label="Fundamental charts · Nvidia" ratio="4 / 3" src="/tour/fundamentals.webp" alt="Nvidia's fundamental charts" />
              </div>
            </Screen>
          ) : null}
          {step === 5 ? (
            <Screen title="Portfolio analytics" line="Performance against benchmarks, risk metrics, income and rebalancing, built from your transactions.">
              <Shot url="tenqay.com/t/portfolio" src="/tour/portfolio.webp" alt="The portfolio screen" />
            </Screen>
          ) : null}
          {step === 6 ? <PlansStep onFinish={finish} /> : null}
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
function Shot({ url, label, src, alt, ratio }: { url: string; label?: string; src: string; alt: string; ratio?: string }) {
  return (
    <figure className="t-wel-shot">
      <figcaption><i /><i /><i /><span>{url}</span>{label ? <b>{label}</b> : null}</figcaption>
      {/* The image keeps its own proportions: a frame of a set ratio cuts it at the foot, never at the sides. */}
      <div className="t-wel-shot-view" style={ratio ? { aspectRatio: ratio } : undefined} data-ratio={ratio ? true : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot; nothing to optimise on the Worker. */}
        <img src={src} alt={alt} loading="eager" decoding="async" />
      </div>
    </figure>
  );
}

function PlansStep({ onFinish }: { onFinish: (href?: string) => void }) {
  const { account, providers } = useAccount();
  const [billing, setBilling] = useState<"monthly" | "annual">("annual");
  const [address, setAddress] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const back = "/t/welcome?step=account";
  const email = async () => {
    setError(null);
    try { await emailSignInLink(address.trim(), back); setSent(address.trim()); } catch (failure) { setError(failure instanceof Error ? failure.message : "The link could not be sent."); }
  };
  const toSignup = () => document.getElementById("t-plans-signup")?.scrollIntoView({ behavior: "smooth", block: "center" });
  return (
    <div className="t-plans">
      <header className="t-plans-head">
        <h2>Plans and pricing</h2>
        <p>Complimentary access during the beta. Paid plans begin at launch; no payment is taken today.</p>
        <div className="t-plans-toggle" role="group" aria-label="Billing period">
          <button type="button" aria-pressed={billing === "monthly"} onClick={() => setBilling("monthly")}>Monthly</button>
          <button type="button" aria-pressed={billing === "annual"} onClick={() => setBilling("annual")}>Annual <span>Save {SAVING}%</span></button>
        </div>
      </header>

      <div className="t-plans-grid">
        <article className="t-plan" data-tier="pro">
          <div className="t-plan-top">
            <h3>Professional</h3>
            <p>For individual investors and analysts</p>
          </div>
          <div className="t-plan-price">
            {billing === "monthly" ? <><b>{dollars(PRICES.monthly)}</b><span>/ month</span></> : <><b>{dollars(PRICES.annual / 12)}</b><span>/ month</span></>}
          </div>
          <p className="t-plan-billed">{billing === "monthly" ? "Billed monthly" : `${dollars(PRICES.annual)} billed annually`}</p>
          {account
            ? <button type="button" className="t-wel-cta t-plan-cta" onClick={() => onFinish()}>Open the terminal</button>
            : <button type="button" className="t-wel-cta t-plan-cta" onClick={toSignup}>Start with the beta</button>}
          <ul>{PRO_FEATURES.map((feature) => <li key={feature}>{feature}</li>)}</ul>
        </article>

        <article className="t-plan" data-tier="enterprise">
          <div className="t-plan-top">
            <h3>Enterprise</h3>
            <p>For teams, advisory firms and institutions</p>
          </div>
          <div className="t-plan-price"><b>Custom</b></div>
          <p className="t-plan-billed">Annual agreement · volume pricing</p>
          <a className="t-wel-ghost t-plan-cta" href={`mailto:${SALES}?subject=${encodeURIComponent("Tenqay Enterprise")}`}>Contact sales</a>
          <ul>{ENTERPRISE_FEATURES.map((feature) => <li key={feature}>{feature}</li>)}</ul>
        </article>
      </div>

      <table className="t-plans-compare">
        <thead><tr><th>Compare plans</th><th>Professional</th><th>Enterprise</th></tr></thead>
        <tbody>{COMPARE.map(([row, pro, enterprise]) => <tr key={row}><th>{row}</th><td>{pro}</td><td>{enterprise}</td></tr>)}</tbody>
      </table>

      <section className="t-plans-signup" id="t-plans-signup" aria-label="Account">
        {account ? (
          <>
            <div><h3>Welcome, {account.name}</h3><p>Your watchlists, portfolios and alerts are synchronised across your devices.</p></div>
            <button type="button" className="t-wel-cta" onClick={() => onFinish()}>Open the terminal</button>
          </>
        ) : (
          <>
            <div><h3>Create your account</h3><p>Synchronise your watchlists, portfolios and alerts across your devices.</p></div>
            <div className="t-plans-signin">
              {providers.google ? <button type="button" className="t-wel-google" onClick={() => continueWith("google", back)}><GoogleMark />Continue with Google</button> : null}
              {providers.email ? (
                sent ? <p className="t-wel-sent">A sign-in link is on its way to <b>{sent}</b>.</p> : (
                  <form className="t-wel-email" onSubmit={(event) => { event.preventDefault(); void email(); }}>
                    <input type="email" required value={address} onChange={(event) => setAddress(event.target.value)} placeholder="you@company.com" autoComplete="email" aria-label="Email address" />
                    <button type="submit" className="t-wel-cta" disabled={!address.trim()}>Continue with email</button>
                  </form>
                )
              ) : null}
              {error ? <p className="t-wel-error" role="alert">{error}</p> : null}
              <button type="button" className="t-wel-later" onClick={() => onFinish()}>Continue without an account</button>
            </div>
          </>
        )}
      </section>
      <p className="t-plans-fine">Prices in US dollars. Applicable taxes may be added at checkout. Research information only, not investment advice.</p>
    </div>
  );
}
