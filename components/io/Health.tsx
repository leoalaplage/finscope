"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import {
  companyHealth, HEALTH_MEANINGS, HEALTH_STATES,
  type HealthPeriod, type HealthQuestion, type HealthReading,
} from "@/lib/io/health";


/**
 * Financial health, under the judgement of the business itself.
 *
 * The Quality Score above asks how good a company this is. This asks whether it
 * survives a bad year, which is a different question with a different answer:
 * Booking is an excellent business whose book equity is minus eleven billion,
 * and Intel is a weak one that could pay every bill falling due tomorrow.
 *
 * Four questions, each with a band, and the verdict is the worst of them — the
 * arithmetic is in `lib/io/health.ts` and the reasoning with it. What this file
 * decides is that the reader meets the verdict first, the readings second and
 * the formulas only if they ask: a reader who wants to know whether a company
 * is sound should not have to hold five ratios in their head to find out.
 */

const state = (question: HealthQuestion) => question.state ?? null;
export function Health({ view }: { view: IoCompanyView }) {
  const [open, setOpen] = useState(false);

  const health = useMemo<HealthReading | null>(() => {
    const as = (period: IoCompanyView["annual"][number]): HealthPeriod =>
      ({ label: period.label, end: period.end, currency: period.currency, values: period.values });
    // The trailing window where there is one: solvency is a question about the
    // balance sheet as it stands, and a filer eight months into its year has
    // moved on from the annual one.
    const current = view.ttm ?? view.annual.at(-1) ?? null;
    return companyHealth(current ? as(current) : null, view.annual.map(as), view.company.businessType);
  }, [view]);

  // Withheld for a bank, a broker or an insurer: every question below is asked
  // of a boundary such a filer does not have. Saying nothing is the honest
  // outcome, and the score above already says why there is no grade.
  if (!health) return null;

  return (
    <section className="section health" id="health">
      <div className="section-head">
        <h2 className="label">Financial health</h2>
        <span className="label">{health.periodLabel} · {health.periodEnd}</span>
      </div>

      {/* The headline is two columns wide, so the row is exactly filled
          however many questions this filer's filings could answer. */}
      <div className="grid-ruled health-grid" style={{ "--health-columns": 2 + health.questions.length } as CSSProperties}>
        <button
          type="button"
          className="stat health-headline score-trigger"
          aria-expanded={open}
          aria-controls={`health-detail-${view.company.ticker}`}
          onClick={() => setOpen((current) => !current)}
        >
          <div className="label">Standing</div>
          <div className="score-trigger-value">
            <span className="stat-value health-verdict" data-empty={!health.state}>{health.state ?? "Not read"}</span>
            <span className="score-open-mark" aria-hidden="true">{open ? "−" : "+"}</span>
          </div>
          <div className="health-meaning">{health.state ? HEALTH_MEANINGS[health.state] : health.reason}</div>
        </button>

        {health.questions.map((question) => (
          <div className="stat" key={question.key}>
            <div className="label">{question.label}</div>
            <div className="stat-value score-word" data-empty={!state(question)}>{state(question) ?? "\u2014"}</div>
            <div className="health-reading">{question.reading}</div>
          </div>
        ))}
      </div>

      {/*
        * The facts that are worth stating and worth not scoring.
        *
        * Negative equity is the one this section exists to get right. Every
        * panel that prints a debt-to-equity ratio reports Booking as more
        * leveraged than a company in default, because its denominator is
        * below zero — so the fact is stated with the cause behind it and the
        * ratio built on it is withheld.
        */}
      {health.notes.length ? (
        <div className="score-lists health-notes">
          {health.notes.map((note) => <p className="stat-note" key={note.key}>{note.text}</p>)}
        </div>
      ) : null}

      {open ? <HealthDetail ticker={view.company.ticker} health={health} /> : null}
    </section>
  );
}

function HealthDetail({ ticker, health }: { ticker: string; health: HealthReading }) {
  return (
    <div className="score-detail" id={`health-detail-${ticker}`}>
      <div className="score-detail-head">
        <div>
          <div className="label">How this was read</div>
          <p className="stat-note">
            The verdict is the worst of the questions answered, never their average: a company with
            ample cash and no interest cover is not in average health, it is in the trouble the
            second answer names. {health.answered} of {health.questions.length} could be answered from these filings.
          </p>
        </div>
        <span className="label">Absolute bands</span>
      </div>

      <div className="health-questions">
        {health.questions.map((question) => (
          <section className="health-question" key={question.key}>
            <h3>{question.question}</h3>
            <p className="health-answer">
              <b data-empty={!question.state}>{question.state ?? "\u2014"}</b>
              <span>{question.reading}</span>
            </p>
            <p className="stat-note">{question.basis}</p>
            {question.aside ? <p className="stat-note health-aside">{question.aside}</p> : null}
          </section>
        ))}
      </div>

      <div className="health-ladder">
        <div className="label">What each standing means</div>
        <dl>
          {[...HEALTH_STATES].reverse().map((band) => (
            <div key={band} data-current={band === health.state}>
              <dt>{band}</dt>
              <dd>{HEALTH_MEANINGS[band]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
