"use client";

import { useEffect, useState } from "react";
import type { AuditEntry, AuditReport, AuditTotals, Disagreement, MoveEntry, StaleEntry } from "@/lib/coverage-audit";
import { ABSENT, shortDate } from "./format";

/**
 * The day's data audit, for whoever keeps the site honest.
 *
 * Counts first, each against the day before, because what matters is whether
 * the site got better or worse; then the companies behind every count, each a
 * link to its page, so a hole can be looked at in one click.
 */

const MEASURE_NAMES: Record<string, string> = {
  revenue: "revenue", netIncome: "net income", operatingCashFlow: "operating cash flow",
  capitalExpenditures: "capital expenditure", freeCashFlow: "free cash flow", dilutedShares: "diluted shares",
};

const COUNTS: Array<{ key: keyof AuditTotals; label: string; note: string }> = [
  { key: "missingFcfLatest", label: "Latest period without FCF", note: "Free cash flow absent from the newest trailing period (or year, for annual-only filers), where the site does not withhold it by design." },
  { key: "stale", label: "Behind the SEC", note: "The company has filed a 10-K or 10-Q for a later period than any the site holds, more than two days ago." },
  { key: "disagree", label: "Disagrees with the SEC", note: "A latest-year revenue, net income or operating cash flow more than 2% away from the same company's figure in the SEC's own frames." },
  { key: "missingTtm", label: "Latest TTM missing a measure", note: "Revenue, net income, operating cash flow, capital expenditure, free cash flow or diluted shares absent from the newest trailing period." },
  { key: "missingAnnual", label: "Latest year missing a measure", note: "The same six measures, on the newest annual period." },
  { key: "recentTtmGaps", label: "FCF gaps, last two years", note: "At least one of the last eight trailing periods without free cash flow." },
  { key: "moved", label: "Moved without a filing", note: "A latest figure that changed by more than 20% on a rebuild of the same period." },
  { key: "notBuilt", label: "Not checked yet", note: "No check on file for the current data version: the company has not been rebuilt since the audit began." },
];

type State = { kind: "loading" } | { kind: "absent" } | { kind: "ready"; report: AuditReport };

export function Status() {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || response.status === 202) { setState({ kind: "absent" }); return; }
        setState({ kind: "ready", report: await response.json() as AuditReport });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ kind: "absent" }); });
    return () => controller.abort();
  }, []);

  return (
    <>
      <header className="head">
        <div className="head-id">
          <h1 className="head-ticker">Data status</h1>
          <p className="head-note">Every company in the S&amp;P 500, checked daily against what it filed with the SEC</p>
        </div>
        <div className="head-meta">
          {state.kind === "ready" ? (
            <>
              <span className="label">{state.report.checked} of {state.report.members} checked</span>
              <span className="label">Gathered {shortDate(state.report.builtAt)}</span>
            </>
          ) : null}
        </div>
      </header>

      {state.kind === "loading" ? (
        <div className="state"><p className="load-copy">Reading the audit…</p></div>
      ) : state.kind === "absent" ? (
        <div className="state"><p>The first audit has not been gathered yet. It is written once a day by the scheduled run.</p></div>
      ) : (
        <Report report={state.report} />
      )}
    </>
  );
}

function Report({ report }: { report: AuditReport }) {
  return (
    <>
      <section className="section" style={{ borderTop: 0 }}>
        <div className="grid-ruled stats">
          {COUNTS.map(({ key, label, note }) => {
            const today = report.totals[key] ?? 0;
            const before = report.previousTotals?.[key];
            const change = before == null ? null : today - before;
            return (
              <div className="stat" key={key} title={note}>
                <div className="label">{label}</div>
                <div className="stat-value" data-empty={today === 0}>{today}</div>
                {/* Up is worse on every count here. */}
                <div className="price-change" data-dir={change == null || change === 0 ? undefined : change > 0 ? "down" : "up"}>
                  {change == null ? "first day" : change === 0 ? "same as before" : `${change > 0 ? "+" : "−"}${Math.abs(change)} since ${report.history.at(-2)?.date ?? "before"}`}
                </div>
              </div>
            );
          })}
        </div>
        {report.regressions.length ? (
          <p className="stat-note" style={{ marginTop: 10 }}>
            Worse than the previous audit: {report.regressions.map((key) => COUNTS.find((count) => count.key === key)?.label ?? key).join(", ")}.
          </p>
        ) : null}
      </section>

      <Entries title="Latest period without FCF" entries={report.issues.missingFcfLatest} />
      <Stale entries={report.issues.stale} />
      <Disagreements entries={report.issues.disagreements ?? []} compared={report.compared ?? 0} />
      <Moves entries={report.issues.moved} />
      <Entries title="Latest TTM missing a measure" entries={report.issues.missingTtm} />
      <Entries title="Latest year missing a measure" entries={report.issues.missingAnnual} />
      <Entries title="FCF gaps, last two years" entries={report.issues.recentTtmGaps} />
      {report.issues.notBuilt.length ? (
        <section className="section">
          <div className="section-head"><h2 className="label">Not checked yet</h2><span className="label">{report.issues.notBuilt.length}</span></div>
          <p className="stat-note">{report.issues.notBuilt.map((ticker, index) => (
            <span key={ticker}>{index ? " · " : ""}<a href={`/s/${encodeURIComponent(ticker)}`}>{ticker}</a></span>
          ))}</p>
        </section>
      ) : null}
      <History report={report} />
    </>
  );
}

function Entries({ title, entries }: { title: string; entries: AuditEntry[] }) {
  if (!entries.length) return null;
  return (
    <section className="section">
      <div className="section-head"><h2 className="label">{title}</h2><span className="label">{entries.length}</span></div>
      <div className="sheet">
        <table>
          <thead><tr><th className="key" scope="col">Company</th><th scope="col">Period</th><th scope="col">Missing</th></tr></thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`${entry.ticker}-${entry.period}`}>
                <th className="key" scope="row"><a className="key-open" href={`/s/${encodeURIComponent(entry.ticker)}`}>{entry.ticker}</a></th>
                <td>{entry.period}</td>
                <td>{entry.measures.map((measure) => MEASURE_NAMES[measure] ?? measure).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stale({ entries }: { entries: StaleEntry[] }) {
  if (!entries.length) return null;
  return (
    <section className="section">
      <div className="section-head"><h2 className="label">Behind the SEC</h2><span className="label">{entries.length}</span></div>
      <div className="sheet">
        <table>
          <thead><tr><th className="key" scope="col">Company</th><th scope="col">Held</th><th scope="col">Filed</th><th scope="col">For period</th><th scope="col">On</th></tr></thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.ticker}>
                <th className="key" scope="row"><a className="key-open" href={`/s/${encodeURIComponent(entry.ticker)}`}>{entry.ticker}</a></th>
                <td>{entry.held ?? ABSENT}{entry.heldEnd ? ` · ${shortDate(entry.heldEnd)}` : ""}</td>
                <td>{entry.form}</td>
                <td>{shortDate(entry.reportDate)}</td>
                <td>{shortDate(entry.filingDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Disagreements({ entries, compared }: { entries: Disagreement[]; compared: number }) {
  if (!compared) return null;
  const write = (value: number) => `${(value / 1e9).toFixed(3)}bn`;
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="label">Disagrees with the SEC</h2>
        <span className="label">{entries.filter((entry) => !entry.scale && !entry.otherFiling).length} read differently from the same filing · {entries.length} listed · {compared} figures checked</span>
      </div>
      {entries.length ? (
        <div className="sheet">
          <table>
            <thead><tr><th className="key" scope="col">Company</th><th scope="col">Measure</th><th scope="col">Period</th><th scope="col">FinScope</th><th scope="col">SEC frame</th><th scope="col">Gap</th></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={`${entry.ticker}-${entry.measure}`}>
                  <th className="key" scope="row"><a className="key-open" href={`/s/${encodeURIComponent(entry.ticker)}`}>{entry.ticker}</a></th>
                  <td>{MEASURE_NAMES[entry.measure] ?? entry.measure}</td>
                  <td>{entry.period}</td>
                  <td>{write(entry.ours)}</td>
                  <td title={`${entry.concept} · ${entry.accession}`}>{write(entry.filed)}</td>
                  <td>
                    {entry.filed === 0 ? ABSENT : `${(((entry.ours - entry.filed) / Math.abs(entry.filed)) * 100).toFixed(1)}%`}
                    {entry.scale ? <span className="dim"> · frame in the wrong scale</span> : entry.otherFiling ? <span className="dim"> · frame reads another filing</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="stat-note">Every latest-year revenue, net income and operating cash flow checked agrees with the SEC&apos;s frames to within 2%.</p>
      )}
    </section>
  );
}

function Moves({ entries }: { entries: MoveEntry[] }) {
  if (!entries.length) return null;
  const write = (value: number) => (Math.abs(value) >= 1e6 ? `${(value / 1e9).toFixed(2)}bn` : value.toLocaleString("en-US"));
  return (
    <section className="section">
      <div className="section-head"><h2 className="label">Moved without a filing</h2><span className="label">{entries.length}</span></div>
      <div className="sheet">
        <table>
          <thead><tr><th className="key" scope="col">Company</th><th scope="col">Measure</th><th scope="col">Period</th><th scope="col">Was</th><th scope="col">Now</th></tr></thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`${entry.ticker}-${entry.measure}`}>
                <th className="key" scope="row"><a className="key-open" href={`/s/${encodeURIComponent(entry.ticker)}`}>{entry.ticker}</a></th>
                <td>{MEASURE_NAMES[entry.measure] ?? entry.measure}</td>
                <td>{entry.period}</td>
                <td>{write(entry.from)}</td>
                <td>{write(entry.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function History({ report }: { report: AuditReport }) {
  if (report.history.length < 2) return null;
  const days = report.history.slice(-14).reverse();
  return (
    <section className="section">
      <div className="section-head"><h2 className="label">The last {days.length} audits</h2></div>
      <div className="sheet">
        <table>
          <thead><tr><th className="key" scope="col">Day</th>{COUNTS.map((count) => <th key={count.key} scope="col">{count.label}</th>)}</tr></thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <th className="key" scope="row">{shortDate(day.date)}</th>
                {COUNTS.map((count) => <td key={count.key}>{day.totals[count.key] ?? ABSENT}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
