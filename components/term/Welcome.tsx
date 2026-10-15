"use client";

import { useEffect, useState } from "react";
import { continueWith, emailSignInLink, useAccount } from "@/components/io/account";
import { GoogleMark } from "@/components/io/AccountPage";
import { OperatingKpis } from "@/components/io/OperatingKpis";
import { Segments } from "@/components/io/Segments";
import { useCompany } from "@/components/io/use-company";
import { FundamentalCharts } from "./FundamentalCharts";
import { MarketBoard } from "./MarketBoard";

/**
 * TOUR: four steps on black — what Tenqay is, the market screen as it stands,
 * a company's operating figures, segments and fundamental charts, then the
 * account and the plans. Shown with the product's own live screens rather
 * than described. Opened once on a first visit (components/term/Launchpad.tsx,
 * ONBOARDED_KEY); always on /t/welcome, TOUR, or SET.
 *
 * Tenqay will be paid, monthly or yearly (PLANS); while it is in beta the
 * account is optional and everything is free — no payment is taken yet.
 */

export const ONBOARDED_KEY = "finscope.term.onboarded.v1";
export const markOnboarded = () => { try { localStorage.setItem(ONBOARDED_KEY, new Date().toISOString()); } catch { /* Shown again next time. */ } };

const STEPS = ["Tenqay", "Markets", "Companies", "Account"] as const;

/** The plans, in euros, as Léo set them (2026-10-15). The annual saving and monthly equivalent are worked out, not typed. */
const PLANS: Array<{ id: "monthly" | "annual"; name: string; amount: number; months: number; period: string }> = [
  { id: "monthly", name: "Monthly", amount: 29.99, months: 1, period: "per month" },
  { id: "annual", name: "Annual", amount: 299.99, months: 12, period: "per year" },
];
const euros = (value: number) => `€${value.toFixed(2)}`;
const MONTHLY = PLANS.find((plan) => plan.id === "monthly")!;

const INCLUDED = ["Every US-listed company, from its filings", "Operating KPIs, segments, 10 years of figures", "Markets, rates, the Fed and the US economy, live", "Screener, backtests, DCF, portfolio and alerts"];

const COMPANY_TABS = [
  { id: "kpi", code: "KPI", label: "Operating KPIs", ticker: "DAL" },
  { id: "seg", code: "SEG", label: "Segments", ticker: "AAPL" },
  { id: "gf", code: "GF", label: "Fundamental charts", ticker: "NVDA" },
] as const;

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
    <div className="t-wel">
      <header className="t-wel-head">
        <ol className="t-wel-dots" aria-label="Steps">
          {STEPS.map((name, index) => (
            <li key={name} data-state={index === step ? "now" : index < step ? "done" : undefined}>
              <button type="button" onClick={() => go(index)} aria-current={index === step ? "step" : undefined}>{name}</button>
            </li>
          ))}
        </ol>
        <button type="button" className="t-wel-skip" onClick={() => finish()}>Skip</button>
      </header>

      <section className="t-wel-body" aria-live="polite">
        {step === 0 ? <Intro onNext={() => go(1)} /> : null}
        {step === 1 ? <MarketsStep /> : null}
        {step === 2 ? <CompaniesStep /> : null}
        {step === 3 ? <AccountStep onFinish={finish} /> : null}
      </section>

      {step > 0 ? (
        <footer className="t-wel-foot">
          <button type="button" className="t-wel-ghost" onClick={() => go(step - 1)}>← Back</button>
          {step < last ? <button type="button" className="t-wel-cta" onClick={() => go(step + 1)}>Next →</button> : null}
        </footer>
      ) : null}
    </div>
  );
}

function Intro({ onNext }: { onNext: () => void }) {
  return (
    <div className="t-wel-intro">
      <p className="t-wel-mark">TENQAY</p>
      <h1>The terminal for US stocks.</h1>
      <p className="t-wel-sub">Markets, filings and the economy — on one black screen.</p>
      <div className="t-wel-four">
        <div><span>MKT</span><b>Markets, live</b></div>
        <div><span>KPI</span><b>Operating KPIs</b></div>
        <div><span>SEG</span><b>Segments</b></div>
        <div><span>GF</span><b>Fundamental charts</b></div>
      </div>
      <button type="button" className="t-wel-cta t-wel-big" onClick={onNext}>See it →</button>
    </div>
  );
}

function StepTitle({ code, title, line, href }: { code: string; title: string; line: string; href?: string }) {
  return (
    <div className="t-wel-title">
      <span className="t-code">{code}</span>
      <div><h2>{title}</h2><p>{line}</p></div>
      {href ? <a className="t-wel-ghost" href={href} target="_blank" rel="noreferrer">Open ↗</a> : null}
    </div>
  );
}

function MarketsStep() {
  return (
    <>
      <StepTitle code="MKT" title="The whole market on one screen" line="Indices, futures, rates, sectors, breadth and movers — live." href="/t/market" />
      {/* The real market screen, drawn small: what a reader gets, not a picture of it. */}
      <div className="t-wel-window" aria-label="The market screen, live">
        <div className="t-wel-window-inner"><MarketBoard /></div>
      </div>
    </>
  );
}

function CompaniesStep() {
  const [tab, setTab] = useState<(typeof COMPANY_TABS)[number]["id"]>("kpi");
  const current = COMPANY_TABS.find((entry) => entry.id === tab)!;
  return (
    <>
      <StepTitle code="DES" title="Every company, read from its filings" line="The figures most sites leave out — from 10-Ks, 10-Qs and earnings releases." href={`/t/s/${current.ticker}#${current.id}`} />
      <div className="t-wel-tabs" role="tablist">
        {COMPANY_TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)}>
            <span>{entry.code}</span>{entry.label}<small>{entry.ticker}</small>
          </button>
        ))}
      </div>
      <div className="t-wel-stage">
        {tab === "kpi" ? <div className="t-panel-pad"><OperatingKpis ticker="DAL" cik="0000027904" /></div> : null}
        {tab === "seg" ? <Segments ticker="AAPL" cik="0000320193" /> : null}
        {tab === "gf" ? <CompanyCharts ticker="NVDA" /> : null}
      </div>
    </>
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
            <h2>You&apos;re in, {account.name}.</h2>
            <p>Your list, portfolio, notes and alerts now follow you to every device.</p>
            <button type="button" className="t-wel-cta t-wel-big" onClick={() => onFinish()}>Open the terminal →</button>
          </>
        ) : (
          <>
            <h2>Create your account</h2>
            <p>Keep your list, portfolio and alerts on every device.</p>
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
        <p className="t-wel-beta">Free during the beta · no card needed</p>
        <div className="t-wel-plan-row">
          {PLANS.map((plan) => {
            const saving = plan.months > 1 ? 1 - plan.amount / (MONTHLY.amount * plan.months) : null;
            return (
              <div key={plan.id} className="t-wel-plan" data-plan={plan.id}>
                <b>{plan.name}{saving ? <span className="t-wel-save">Save {Math.round(saving * 100)}%</span> : null}</b>
                <span className="t-wel-price">{euros(plan.amount)}<small> {plan.period}</small></span>
                <small>{plan.months > 1 ? `${euros(plan.amount / plan.months)} a month, billed once a year` : "Billed every month"}</small>
              </div>
            );
          })}
        </div>
        <ul className="t-wel-included">{INCLUDED.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>
    </div>
  );
}
