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
}

type State = { kind: "loading" } | { kind: "absent" } | { kind: "ready"; score: Scored };

const PILLARS: Array<keyof Pillars> = ["Quality", "Health", "Growth", "Value"];
const write = (value: number | null) => (value == null ? ABSENT : value.toFixed(0));

export function Score({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/io/${encodeURIComponent(ticker)}/score`, { signal: controller.signal });
        if (!response.ok) { setState({ kind: "absent" }); return; }
        setState({ kind: "ready", score: await response.json() as Scored });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "absent" });
      }
    })();
    return () => controller.abort();
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
        <div className="stat score-headline">
          <div className="label">Grade</div>
          <div className="stat-value score-grade" data-empty={!rated}>{score.grade}</div>
          <div className="stat-note">
            {rated ? `${write(score.total)} / 100` : `${percent(score.coverage, 0)} of the measures`}
          </div>
        </div>
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
    </section>
  );
}
