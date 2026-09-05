"use client";

import { useEffect, useState } from "react";
import { ABSENT, percent } from "./format";

/**
 * The Quality Score, on the page it is about.
 *
 * The screener has computed this from the beginning and a company page never
 * showed it — the one judgement FinScope makes was missing from the one screen
 * built around a company.
 *
 * The score is a measurement, not a rank. Each metric is read against a fixed
 * scale — anchors set from analysis convention, not from any table — so this
 * grade says something about the company rather than about the company it
 * happened to be scored beside. Nothing about the crowd needs stating, because
 * there is no crowd.
 */

interface Pillars { Quality: number | null; Health: number | null; Growth: number | null; Value: number | null }

interface Scored {
  grade: string;
  total: number | null;
  coverage: number;
  pillars: Pillars;
  alerts: string[];
  strengths: string[];
  weaknesses: string[];
  valuation: string;
  modelVersion: string;
  period: { label: string; end: string; retrievedAt: string };
  source: string;
  details: MetricDetail[];
  history: HistoryPoint[];
}

interface MetricDetail {
  key: string;
  label: string;
  pillar: keyof Pillars;
  raw: number | null;
  score: number | null;
  configuredWeight: number;
  effectiveWeight: number;
  contribution: number | null;
  description: string;
  formula: string;
  source: string;
  status: "derived" | "estimate" | "missing";
  period: string;
}

interface HistoryPoint {
  id: string;
  recordedAt: string;
  periodEnd: string;
  periodLabel: string;
  dataRetrievedAt: string;
  modelVersion: string;
  grade: string;
  total: number | null;
  coverage: number;
  pillars: Pillars;
}

type State = { kind: "loading" } | { kind: "absent" } | { kind: "ready"; score: Scored };

const PILLARS: Array<keyof Pillars> = ["Quality", "Health", "Growth", "Value"];
const write = (value: number | null) => (value == null ? ABSENT : value.toFixed(0));

export function Score({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/io/${encodeURIComponent(ticker)}/score`, { signal: controller.signal });
        if (response.status === 202) {
          if (attempts < 30) {
            attempts += 1;
            timer = setTimeout(load, 2_000);
          } else {
            setState({ kind: "absent" });
          }
          return;
        }
        if (!response.ok) { setState({ kind: "absent" }); return; }
        setState({ kind: "ready", score: await response.json() as Scored });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "absent" });
      }
    };
    load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [ticker]);

  // A score that cannot be struck is simply not shown. The page is about the
  // filings; the judgement is an addition to them, not a precondition.
  if (state.kind === "absent") return null;
  if (state.kind === "loading") return null;

  const { score } = state;
  const rated = score.grade !== "NR";

  return (
    <section className="section score" id="score">
      <div className="section-head">
        <h2 className="label">Quality Score</h2>
        <span className="label">On a fixed scale</span>
      </div>

      <div className="grid-ruled score-grid">
        <button
          type="button"
          className="stat score-headline score-trigger"
          aria-expanded={open}
          aria-controls={`score-detail-${ticker}`}
          onClick={() => setOpen((current) => !current)}
        >
          <div className="label">Grade</div>
          <div className="score-trigger-value">
            <span className="stat-value score-grade" data-empty={!rated}>{score.grade}</span>
            <span className="score-open-mark" aria-hidden="true">{open ? "−" : "+"}</span>
          </div>
        </button>
        {PILLARS.map((pillar) => (
          <div className="stat" key={pillar}>
            <div className="label">{pillar}</div>
            <div className="stat-value" data-empty={score.pillars[pillar] == null}>{write(score.pillars[pillar])}</div>
          </div>
        ))}
        <div className="stat">
          <div className="label">Valuation</div>
          <div className="stat-value score-word" data-empty={!score.valuation || score.valuation === "n/a"}>{score.valuation || ABSENT}</div>
        </div>
      </div>

      {!rated ? (
        <p className="stat-note" style={{ marginTop: 10 }}>
          Not rated: {percent(score.coverage, 0)} of the scored measures are available for this filer, below the
          three-quarters the grade requires. The pillars above are struck on what is there.
        </p>
      ) : null}
      {score.strengths.length || score.weaknesses.length ? (
        <div className="score-lists">
          {score.strengths.length ? (
            <p className="stat-note"><span className="label">Strongest</span> {score.strengths.slice(0, 3).join(" · ")}</p>
          ) : null}
          {score.weaknesses.length ? (
            <p className="stat-note"><span className="label">Weakest</span> {score.weaknesses.slice(0, 3).join(" · ")}</p>
          ) : null}
        </div>
      ) : null}
      {score.alerts.length ? (
        <p className="stat-note" style={{ marginTop: 6 }}><span className="label">Alerts</span> {score.alerts.join(" · ")}</p>
      ) : null}
      {open ? <ScoreDetail ticker={ticker} score={score} /> : null}
    </section>
  );
}

const PERCENT_KEYS = new Set(["ROIC", "ROIC5", "OpM", "FCFM5", "FCF_NI", "GM5", "ShOut5", "SBC", "Rev5", "RevFwd3", "LevFCF5", "NI5", "RevPS5", "FCFPS5", "FCFYield"]);

function rawValue(metric: MetricDetail) {
  if (metric.raw == null) return ABSENT;
  return PERCENT_KEYS.has(metric.key) ? `${metric.raw.toFixed(1)}%` : `${metric.raw.toFixed(2)}×`;
}

function ScoreDetail({ ticker, score }: { ticker: string; score: Scored }) {
  return (
    <div className="score-detail" id={`score-detail-${ticker}`}>
      <div className="score-detail-head">
        <div>
          <div className="label">Score audit</div>
          <p className="stat-note">{score.source} · {score.period.label} ending {score.period.end}</p>
        </div>
        <span className="label">Model {score.modelVersion}</span>
      </div>

      <div className="score-pillars-detail">
        {PILLARS.map((pillar) => (
          <section key={pillar} className="score-pillar-detail">
            <h3>{pillar}</h3>
            {score.details.filter((metric) => metric.pillar === pillar).map((metric) => (
              <details className="score-metric-detail" key={metric.key}>
                <summary>
                  <span>
                    <strong>{metric.label}</strong>
                    <small>{rawValue(metric)}</small>
                  </span>
                  <span className="score-metric-numbers">
                    <b data-empty={metric.score == null}>{metric.score == null ? ABSENT : metric.score.toFixed(0)}</b>
                    <small>{metric.contribution == null ? "No contribution" : `${metric.contribution.toFixed(1)} pts`}</small>
                  </span>
                </summary>
                <div className="score-metric-proof">
                  <p>{metric.description}</p>
                  <dl>
                    <div><dt>Formula</dt><dd>{metric.formula}</dd></div>
                    <div><dt>Source</dt><dd>{metric.source}</dd></div>
                    <div><dt>Period</dt><dd>{metric.period}</dd></div>
                    <div><dt>Effective weight</dt><dd>{metric.effectiveWeight.toFixed(1)}%</dd></div>
                    <div><dt>Status</dt><dd>{metric.status}</dd></div>
                  </dl>
                </div>
              </details>
            ))}
          </section>
        ))}
      </div>

      <ScoreHistory points={score.history} currentVersion={score.modelVersion} />
    </div>
  );
}

function ScoreHistory({ points, currentVersion }: { points: HistoryPoint[]; currentVersion: string }) {
  const usable = points.filter((point) => point.total != null);
  const coords = usable.map((point, index) => ({
    point,
    x: usable.length <= 1 ? 300 : 20 + index * (560 / (usable.length - 1)),
    y: 110 - point.total! * 0.01 * 90,
  }));
  return (
    <section className="score-history">
      <div className="score-detail-head">
        <div>
          <h3>Quality Score history</h3>
          <p className="stat-note">One immutable snapshot per filing period and model version.</p>
        </div>
        <span className="label">{usable.length} {usable.length === 1 ? "snapshot" : "snapshots"}</span>
      </div>
      {usable.length ? (
        <>
          <svg className="score-history-chart" viewBox="0 0 600 130" role="img" aria-label="Quality Score history from zero to one hundred">
            <line x1="20" y1="20" x2="580" y2="20" />
            <line x1="20" y1="65" x2="580" y2="65" />
            <line x1="20" y1="110" x2="580" y2="110" />
            {coords.length > 1 ? <polyline points={coords.map(({ x, y }) => `${x},${y}`).join(" ")} /> : null}
            {coords.map(({ point, x, y }) => (
              <circle key={point.id} cx={x} cy={y} r="4">
                <title>{point.periodLabel}: {point.total!.toFixed(1)} ({point.grade})</title>
              </circle>
            ))}
          </svg>
          <div className="score-history-labels">
            {coords.map(({ point }) => (
              <span key={point.id}>
                <small>{point.periodEnd}</small>
                <strong>{point.grade} · {point.total!.toFixed(1)}</strong>
                {point.modelVersion !== currentVersion ? <small>Model {point.modelVersion}</small> : null}
              </span>
            ))}
          </div>
        </>
      ) : <p className="stat-note">History will begin with the first scored filing under this model.</p>}
    </section>
  );
}
