"use client";

import { useEffect, useState, type ReactNode } from "react";
import { continueWith, emailSignInLink, useAccount } from "@/components/io/account";
import { openBillingPortal, startCheckout, SUPPORT_EMAIL, useBilling } from "@/components/io/billing";
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
 * Tenqay will be paid, monthly or yearly (PRICES); while in beta the
 * account is optional and everything is free — no payment is taken yet.
 */

export const ONBOARDED_KEY = "finscope.term.onboarded.v1";
export const markOnboarded = () => { try { localStorage.setItem(ONBOARDED_KEY, new Date().toISOString()); } catch { /* Shown again next time. */ } };

const STEPS = ["Welcome", "Markets", "Companies", "KPIs and segments", "Charts", "Portfolio", "Plans"] as const;

/** The two plans, in US dollars, as Léo set them (2026-10-15). The annual saving and monthly equivalent are worked out, not typed. */
const PRICES = { monthly: 29.99, annual: 299.99 } as const;
const dollars = (value: number) => `$${value.toFixed(2)}`;
const SAVING = Math.round((1 - PRICES.annual / (PRICES.monthly * 12)) * 100);

/** What every plan holds: the same product, billed monthly or yearly. */
const INCLUDED = [
  "Real-time markets, rates and Fed expectations",
  "Fundamentals for every listed company, from SEC filings",
  "Operating KPIs, segments and ten-year history",
  "Technical and fundamental charting",
  "Screener and backtesting",
  "Portfolio analytics and valuation models",
  "Alerts by browser and email",
  "Sync across devices",
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
  const [returned] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("checkout")));
  const billing = useBilling(returned === "success");
  const [address, setAddress] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const back = "/t/welcome?step=account";
  const email = async () => {
    setError(null);
    try { await emailSignInLink(address.trim(), back); setSent(address.trim()); } catch (failure) { setError(failure instanceof Error ? failure.message : "The link could not be sent."); }
  };
  const toSignup = () => document.getElementById("t-plans-signup")?.scrollIntoView({ behavior: "smooth", block: "center" });
  const run = async (key: string, action: () => Promise<void>) => {
    setError(null); setBusy(key);
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Billing is unavailable just now."); setBusy(null); }
  };
  const paid = billing?.billing ?? false;
  const paywall = billing?.paywall ?? false;
  const subscription = billing?.entitled ? billing.subscription : null;
  /*
   * What each plan's button does: open the terminal while billing is not set
   * up (the beta), sign in first, subscribe through Stripe, or — on the plan
   * already held — nothing but say so.
   */
  const cta = (plan: "monthly" | "annual") => {
    if (subscription) {
      return subscription.plan === plan
        ? <button type="button" className="t-wel-ghost t-plan-cta" disabled>Current plan</button>
        : <button type="button" className="t-wel-ghost t-plan-cta" disabled={busy != null} onClick={() => void run("portal", openBillingPortal)}>Switch plan</button>;
    }
    if (!paid) return account
      ? <button type="button" className="t-wel-cta t-plan-cta" onClick={() => onFinish()}>Open the terminal</button>
      : <button type="button" className="t-wel-cta t-plan-cta" onClick={toSignup}>Start with the beta</button>;
    if (!account) return <button type="button" className="t-wel-cta t-plan-cta" onClick={toSignup}>Subscribe</button>;
    return <button type="button" className="t-wel-cta t-plan-cta" disabled={busy != null} onClick={() => void run(plan, () => startCheckout(plan))}>{busy === plan ? "Opening checkout…" : "Subscribe"}</button>;
  };
  const renews = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : null;
  return (
    <div className="t-plans">
      <header className="t-plans-head">
        <h2>Plans and pricing</h2>
        <p>{paywall ? "One product, billed monthly or annually. Cancel at any time from your account." : "One product, billed monthly or annually. Complimentary access during the beta; no payment is taken today."}</p>
        {returned === "success" ? (
          <p className="t-plans-status" data-tone={subscription ? "ok" : undefined}>{subscription ? `Your ${subscription.plan ?? ""} subscription is active.` : "Payment received — activating your subscription…"}</p>
        ) : returned === "cancelled" ? <p className="t-plans-status">Checkout was cancelled. No payment was taken.</p> : null}
        {subscription && returned !== "success" ? (
          <p className="t-plans-status" data-tone="ok">
            {`${subscription.plan === "annual" ? "Annual" : "Monthly"} plan · ${subscription.cancelAtPeriodEnd ? "ends" : "renews"} ${renews ?? ""}`}
          </p>
        ) : null}
      </header>

      <div className="t-plans-grid">
        <article className="t-plan" data-tier="monthly" data-current={subscription?.plan === "monthly" || undefined}>
          <div className="t-plan-top"><h3>Monthly</h3><p>Billed every month</p></div>
          <div className="t-plan-price"><b>{dollars(PRICES.monthly)}</b><span>/ month</span></div>
          <p className="t-plan-billed">{dollars(PRICES.monthly * 12)} over twelve months</p>
          {cta("monthly")}
        </article>
        <article className="t-plan" data-tier="annual" data-current={subscription?.plan === "annual" || undefined}>
          <div className="t-plan-top"><h3>Annual <span className="t-plan-save">Save {SAVING}%</span></h3><p>Billed once a year</p></div>
          <div className="t-plan-price"><b>{dollars(PRICES.annual)}</b><span>/ year</span></div>
          <p className="t-plan-billed">{dollars(PRICES.annual / 12)} per month</p>
          {cta("annual")}
        </article>
      </div>
      {error ? <p className="t-wel-error t-plans-error" role="alert">{error}</p> : null}

      <div className="t-plans-included">
        <h3>Included in every plan</h3>
        <ul>{INCLUDED.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>

      <section className="t-plans-signup" id="t-plans-signup" aria-label="Account">
        {account ? (
          <>
            <div>
              <h3>Welcome, {account.name}</h3>
              <p>{subscription || !paywall ? "Your watchlists, portfolios and alerts are synchronised across your devices." : "Choose a plan above to open the terminal."}</p>
            </div>
            <div className="t-plans-signin">
              {subscription || !paywall ? <button type="button" className="t-wel-cta" onClick={() => onFinish()}>Open the terminal</button> : null}
              {subscription ? <button type="button" className="t-wel-ghost" disabled={busy != null} onClick={() => void run("portal", openBillingPortal)}>Manage billing</button> : null}
            </div>
          </>
        ) : (
          <>
            <div><h3>Create your account</h3><p>{paid ? "Sign in to subscribe. Your watchlists, portfolios and alerts follow you across devices." : "Synchronise your watchlists, portfolios and alerts across your devices."}</p></div>
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
              {paywall ? null : <button type="button" className="t-wel-later" onClick={() => onFinish()}>Continue without an account</button>}
            </div>
          </>
        )}
      </section>
      <p className="t-plans-fine">Prices in US dollars. Applicable taxes may be added at checkout.{paid ? " Payments are processed by Stripe." : ""} Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Research information only, not investment advice.</p>
    </div>
  );
}
