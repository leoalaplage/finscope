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
 * A score here is a rank rather than a measurement: every metric is a
 * percentile among the companies it was scored with, so the same filer is a
 * different number in a different crowd. The universe is therefore stated
 * beside the grade rather than assumed, and it is fixed, so a grade on one page
 * means what a grade on another does.
 */

interface Pillars { Quality: number | null; Health: number | null; Growth: number | null; Value: number | null }

interface Scored {
  grade: string;
  total: number | null;
  rank: number;
  coverage: number;
  pillars: Pillars;
  alerts: string[];
  strengths: string[];
  weaknesses: string[];
  valuation: string;
  universe: { label: string; size: number };
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
        <span className="label">Against {score.universe.label}</span>
      </div>

      <div className="grid-ruled score-grid">
        <div className="stat score-headline">
          <div className="label">Grade</div>
          <div className="stat-value score-grade" data-empty={!rated}>{score.grade}</div>
          <div className="stat-note">
            {rated ? `${write(score.total)} / 100 · rank ${score.rank} of ${score.universe.size}` : `${percent(score.coverage, 0)} of the measures`}
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
        <div className="stat">
          <div className="label">Coverage</div>
          <div className="stat-value">{percent(score.coverage, 0)}</div>
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
