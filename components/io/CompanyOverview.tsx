"use client";

import { useMemo } from "react";
import type { InsiderTransaction } from "@/lib/adapters/insiders";
import { fcfShareGrowthProfile } from "@/lib/io/fcf-share-growth";
import { companyHealth, type HealthPeriod } from "@/lib/io/health";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import type { ScoreState } from "./Score";
import type { ValuationHistoryState } from "./valuation-series";
import { ABSENT, edgarUrl, money, percent, ratio, shortDate } from "./format";

const CORE_METRICS = [
  "revenue",
  "netIncome",
  "freeCashFlow",
  "dilutedShares",
  "cashAndEquivalents",
  "totalDebt",
  "operatingMargin",
  "roic",
] as const;

/** "fortress" is the engine's word; "Fortress" is how the page says it. */
const capitalised = (word: string | null) => word == null ? "Not read" : word[0].toUpperCase() + word.slice(1);

const asHealthPeriod = (period: IoPeriod): HealthPeriod => ({
  label: period.label,
  end: period.end,
  currency: period.currency,
  values: period.values,
});

export function DecisionSummary({
  view,
  score,
  valuation,
}: {
  view: IoCompanyView;
  score: ScoreState;
  valuation: ValuationHistoryState;
}) {
  const current = view.ttm ?? view.annual.at(-1) ?? null;
  const annual = view.annual.at(-1) ?? null;
  const health = useMemo(
    () => companyHealth(current ? asHealthPeriod(current) : null, view.annual.map(asHealthPeriod), view.company.businessType),
    [current, view.annual, view.company.businessType],
  );
  const growth = useMemo(() => fcfShareGrowthProfile(view.annual).fiveYearCagr, [view.annual]);
  const covered = annual ? CORE_METRICS.filter((metric) => annual.values[metric] != null).length : 0;
  const liveValuation = valuation.current?.metrics ?? null;

  const quality = score.kind === "ready"
    ? {
        value: score.score.grade,
        note: score.score.total == null
          ? `${percent(score.score.coverage, 0)} score coverage`
          : `${score.score.total.toFixed(0)}/100 · ${percent(score.score.coverage, 0)} covered`,
      }
    : { value: score.kind === "loading" ? "Reading" : "Not rated", note: "Fixed-scale filing score" };

  const valuationReading = liveValuation?.freeCashFlowYield != null
    ? { value: percent(liveValuation.freeCashFlowYield, 1), note: "Current FCF yield" }
    : liveValuation?.priceToFreeCashFlow != null
      ? { value: ratio(liveValuation.priceToFreeCashFlow, 1), note: "Current price / FCF" }
      : { value: "Not struck", note: view.basisReason ?? "No compatible live valuation" };

  const cells = [
    { label: "Quality", value: quality.value, note: quality.note, href: "#score" },
    { label: "Health", value: health ? capitalised(health.state) : "Not read", note: health ? `${health.answered}/${health.questions.length} tests answered` : "Not applicable or unavailable", href: "#health" },
    { label: "Growth", value: growth.value == null ? ABSENT : percent(growth.value, 1), note: "FCF / share · 5Y CAGR", href: "#financials-section" },
    { label: "Valuation", value: valuationReading.value, note: valuationReading.note, href: "#valuation-section" },
    { label: "Coverage", value: `${covered}/${CORE_METRICS.length}`, note: `${view.annual.length} annual · ${view.quarterly.length} quarterly periods`, href: "#financials-section" },
  ];

  return (
    <section className="section decision-summary" aria-labelledby="decision-summary-title">
      <div className="section-head">
        <h2 className="label" id="decision-summary-title">Decision summary</h2>
        <span className="label">Filed or calculated · never estimated</span>
      </div>
      <div className="decision-grid">
        {cells.map((cell) => (
          <a className="decision-cell" href={cell.href} key={cell.label}>
            <span className="label">{cell.label}</span>
            <strong data-empty={cell.value === ABSENT || cell.value === "Not read" || cell.value === "Not struck"}>{cell.value}</strong>
            <small>{cell.note}</small>
          </a>
        ))}
      </div>
    </section>
  );
}

type ChangeReading = { label: string; value: string; note: string };

function relative(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return current / previous - 1;
}

function changed(view: IoCompanyView): { current: IoPeriod; previous: IoPeriod; readings: ChangeReading[] } | null {
  const usingTrailing = view.ttm != null && view.trailing.length >= 5;
  const series = usingTrailing ? view.trailing : view.annual;
  const current = series.at(-1);
  const previous = usingTrailing ? series.at(-5) : series.at(-2);
  if (!current || !previous) return null;

  const readings: ChangeReading[] = [];
  const addRelative = (label: string, metric: string, positive: string, negative: string) => {
    const value = relative(current.values[metric], previous.values[metric]);
    if (value == null) return;
    readings.push({ label, value: `${value >= 0 ? "+" : "−"}${percent(Math.abs(value), 1)}`, note: value > 0 ? positive : value < 0 ? negative : "Unchanged" });
  };
  addRelative("Revenue", "revenue", "Higher year over year", "Lower year over year");
  addRelative("Free cash flow", "freeCashFlow", "More cash generated", "Less cash generated");

  const margin = current.values.operatingMargin;
  const priorMargin = previous.values.operatingMargin;
  if (margin != null && priorMargin != null) {
    const points = (margin - priorMargin) * 10_000;
    readings.push({ label: "Operating margin", value: `${points >= 0 ? "+" : "−"}${Math.abs(points).toFixed(0)} bp`, note: points > 0 ? "Margin expanded" : points < 0 ? "Margin compressed" : "Unchanged" });
  }
  addRelative("Diluted shares", "dilutedShares", "Share count increased", "Share count decreased");

  return { current, previous, readings };
}

export function WhatChanged({ view }: { view: IoCompanyView }) {
  const change = useMemo(() => changed(view), [view]);
  if (!change) return null;
  const source = edgarUrl(view.company.cik, change.current.accession);

  return (
    <section className="section what-changed" id="what-changed" aria-labelledby="what-changed-title">
      <div className="section-head">
        <h2 className="label" id="what-changed-title">What changed</h2>
        {source ? <a className="label head-compare" href={source} target="_blank" rel="noreferrer">{change.current.label} filing →</a> : null}
      </div>
      <p className="change-period">{change.current.label} through {shortDate(change.current.end)} against {change.previous.label}</p>
      {change.readings.length ? (
        <div className="change-grid">
          {change.readings.map((reading) => (
            <div className="change-cell" key={reading.label}>
              <span className="label">{reading.label}</span>
              <strong>{reading.value}</strong>
              <small>{reading.note}</small>
            </div>
          ))}
        </div>
      ) : <p className="stat-note">No comparable core measure is available across these two periods.</p>}
    </section>
  );
}

type TimelineEvent = {
  id: string;
  date: string;
  kind: string;
  title: string;
  detail: string;
  href: string | null;
};

export function CompanyTimeline({ view, insiders }: { view: IoCompanyView; insiders: InsiderTransaction[] }) {
  const events = useMemo<TimelineEvent[]>(() => {
    const filings = [...view.annual.slice(-3), ...view.quarterly.slice(-6)]
      .filter((period, index, all) => all.findIndex((candidate) => candidate.accession === period.accession) === index)
      .map((period) => ({
        id: `filing-${period.accession}`,
        date: period.publishedAt || period.filingDate,
        kind: period.fiscalQuarter ? "Results" : "Filing",
        title: period.fiscalQuarter ? `${period.fiscalQuarter} results filed` : `${period.label} annual filing`,
        detail: `Period ended ${shortDate(period.end)}`,
        href: edgarUrl(view.company.cik, period.accession),
      }));
    const dealing = insiders
      .filter((transaction) => transaction.kind === "open-market")
      .map((transaction, index) => ({
        // One Form 4 can carry several rows for the same owner, date and
        // security. Its order inside the filing distinguishes those rows.
        id: `insider-${transaction.accession}-${transaction.owner}-${transaction.date}-${index}`,
        date: transaction.date,
        kind: "Insider",
        title: `${transaction.owner} · ${transaction.direction === "acquired" ? "purchase" : "sale"}`,
        detail: transaction.value == null ? transaction.codeLabel : money(transaction.value, "USD"),
        href: transaction.sourceUrl,
      }));
    /*
     * Each kind is capped before they are merged, or one drowns the other.
     *
     * Apple files a Form 4 most weeks and an annual report once a year. Taking
     * the ten newest events of any kind gave a section headed "filings,
     * results and insider decisions" that was ten insider sales by the same
     * officer, and the filings it promised were four years down a list that
     * stops at ten.
     */
    const newest = (events: TimelineEvent[], count: number) =>
      [...events].sort((left, right) => right.date.localeCompare(left.date)).slice(0, count);
    return [...newest(filings, 5), ...newest(dealing, 5)]
      .sort((left, right) => right.date.localeCompare(left.date));
  }, [insiders, view]);

  if (!events.length) return null;
  return (
    <section className="section company-timeline" id="timeline" aria-labelledby="timeline-title">
      <div className="section-head">
        <h2 className="label" id="timeline-title">Company timeline</h2>
        <span className="label">Filings · results · insider decisions</span>
      </div>
      <ol>
        {events.map((event) => (
          <li key={event.id}>
            <time dateTime={event.date}>{shortDate(event.date)}</time>
            <span className="timeline-kind">{event.kind}</span>
            {event.href ? (
              <a href={event.href} target="_blank" rel="noreferrer">
                <strong>{event.title}</strong>
                <small>{event.detail}</small>
              </a>
            ) : (
              <span className="timeline-copy">
                <strong>{event.title}</strong>
                <small>{event.detail}</small>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
