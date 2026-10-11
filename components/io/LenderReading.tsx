"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";
import { HEALTH_STATES } from "@/lib/io/health";
import { growthYieldOutOfTen } from "@/lib/io/growth-yield";
import { CAPITAL_BANDS, EARNINGS_BANDS, QUALITY_ROE, lenderHealth, lenderQuality, lenderValuation } from "@/lib/io/lender";
import { fcfShareGrowthProfile } from "@/lib/io/fcf-share-growth";
import type { IoCompanyView } from "@/lib/io/view";
import type { VerdictKey } from "./Verdict";
import { ABSENT, money, price as writePrice } from "./format";

/**
 * The reading behind each answer, for a lender (lib/io/lender.ts).
 *
 * Opened from the "at a glance" line in place of the industrial readings —
 * the Quality Score, the health questions, the growth yield on free cash flow
 * and free cash flow per share — which are struck on figures a lender is not
 * given. Each shows its figures, the band it fell in and the bands themselves.
 */

const pct = (value: number | null | undefined, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(places)}%`);
const bandsText = (bands: Array<{ at: number; state: string }>, places = 0) =>
  bands.map((band) => `${band.state} ≥ ${(band.at * 100).toFixed(places)}%`).join(" · ") + " · strained below";

export function LenderReading({ view, quote, which }: { view: IoCompanyView; quote: { price: number | null; currency?: string | null } | null; which: VerdictKey }) {
  const quality = useMemo(() => lenderQuality(view), [view]);
  const health = useMemo(() => lenderHealth(view), [view]);
  const valuation = useMemo(() => lenderValuation(view, quote), [view, quote]);
  const eps = useMemo(() => fcfShareGrowthProfile(view.annual, "netIncomePerShare"), [view.annual]);
  const currency = view.basis?.currency ?? view.company.currency;

  const titles: Record<VerdictKey, string> = {
    quality: "Quality · return on equity", health: "Financial health · capital and earnings",
    valuation: "Price against growth · on earnings", growth: "Historic growth · earnings per share",
  };

  return (
    <section className="section lender-reading" id={`lender-${which}`}>
      <div className="section-head">
        <h2 className="label">{titles[which]}</h2>
        <span className="label">Read as a lender</span>
      </div>

      {which === "quality" ? (
        <>
          <div className="grid-ruled stats" style={{ "--cols": quality.years.length + 1 } as CSSProperties}>
            <div className="stat"><div className="label">Answer</div><div className="stat-value" data-empty={!quality.answer}>{quality.answer ?? ABSENT}</div><p className="stat-note">{quality.note}</p></div>
            {quality.years.map((year) => (
              <div className="stat" key={year.label}>
                <div className="label">{year.label} ROE</div>
                <div className="stat-value" data-dir={year.netIncome != null && year.netIncome < 0 ? "down" : undefined}>{pct(year.roe)}</div>
              </div>
            ))}
          </div>
          <p className="stat-note">
            A quality lender earns at least {(QUALITY_ROE * 100).toFixed(0)}% a year on its equity on average over five years — above
            the cost of its capital — and has no loss year among them. The Quality Score is not used here: its pillars are struck on
            free cash flow and invested capital, which a lender is not given.
          </p>
        </>
      ) : null}

      {which === "health" ? (
        <>
          <div className="grid-ruled stats">
            <div className="stat"><div className="label">Standing</div><div className="stat-value" data-empty={!health.state}>{health.state ?? "Not read"}</div><p className="stat-note">{health.periodLabel ?? ""}</p></div>
            {health.questions.map((question) => (
              <div className="stat" key={question.id}>
                <div className="label">{question.question}</div>
                <div className="stat-value" data-empty={!question.state}>{question.state ?? ABSENT}</div>
                <p className="stat-note">{question.answer}</p>
              </div>
            ))}
          </div>
          <p className="stat-note">
            The standing is the worse of the two answers. Capital: {bandsText(CAPITAL_BANDS)}. Earnings on assets: {bandsText(EARNINGS_BANDS, 1)}.
            Borrowing, cover and runway — the industrial questions — are not asked: a lender&apos;s borrowings are its raw material.
            Ladder, best first: {[...HEALTH_STATES].reverse().join(", ")}.
          </p>
        </>
      ) : null}

      {which === "valuation" ? (
        <>
          <div className="grid-ruled stats">
            <div className="stat"><div className="label">Mark</div><div className="stat-value" data-empty={valuation.score == null}>{valuation.score == null ? ABSENT : `${growthYieldOutOfTen(valuation.score)}/10`}</div><p className="stat-note">{valuation.verdict ?? valuation.note}</p></div>
            <div className="stat"><div className="label">Earnings yield</div><div className="stat-value">{pct(valuation.reading.fcfYield)}</div><p className="stat-note">{valuation.earnings ? `${money(valuation.earnings.values.netIncome, currency)} net income, ${valuation.earnings.label}, on ${money(valuation.marketCap, currency)} of market value` : "No earnings or no price"}</p></div>
            <div className="stat"><div className="label">Revenue / share growth</div><div className="stat-value">{pct(valuation.reading.growth)}</div><p className="stat-note">{valuation.rate.reason ?? `Five years, counted at no more than 25% a year${valuation.reading.capped ? " (capped)" : ""}`}</p></div>
            <div className="stat"><div className="label">Growth yield</div><div className="stat-value">{pct(valuation.reading.value)}</div><p className="stat-note">The two added: what a buyer earns at today&apos;s price if the business goes on as it has</p></div>
          </div>
          <p className="stat-note">
            The site&apos;s growth yield, with the earnings yield in place of the free-cash-flow yield a lender is not given; the same fixed scale scores
            it — nought at 0%, five at 14%, ten at 28%.{quote?.price != null ? ` Price ${writePrice(quote.price, quote.currency ?? currency)}.` : ""}
          </p>
        </>
      ) : null}

      {which === "growth" ? (
        <>
          <div className="grid-ruled stats">
            <div className="stat"><div className="label">EPS, 5 years</div><div className="stat-value">{pct(eps.fiveYearCagr.value)}</div><p className="stat-note">{eps.fiveYearCagr.reason ?? "A year, compound"}</p></div>
            <div className="stat"><div className="label">EPS, 10 years</div><div className="stat-value">{pct(eps.tenYearCagr.value)}</div><p className="stat-note">{eps.tenYearCagr.reason ?? "A year, compound"}</p></div>
            <div className="stat"><div className="label">Steadiness, 5 years</div><div className="stat-value">{eps.fiveYearRSquared.value == null ? ABSENT : eps.fiveYearRSquared.value.toFixed(2)}</div><p className="stat-note">R² of the line through the years: 1 is a straight compounding line</p></div>
          </div>
          <p className="stat-note">Read from diluted earnings per share, the figure a lender is valued on, in place of free cash flow per share.</p>
        </>
      ) : null}
    </section>
  );
}
