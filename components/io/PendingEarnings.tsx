"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ComboChart } from "@/components/term/FundamentalCharts";
import type { ChartData, Preset } from "@/lib/term/fundamental-charts";
import type { EarningsReleaseFiling, ReleaseReading } from "@/lib/adapters/earnings";
import type { ReleaseMetric } from "@/lib/adapters/earnings-release";
import type { EpsSurprise, Estimates } from "@/lib/estimates";
import type { IoCompanyView } from "@/lib/io/view";
import { ABSENT, money, price, shortDate } from "./format";

interface EarningsAnswer { cik?: string; filing?: EarningsReleaseFiling | null }
interface EstimatesAnswer { estimates?: Estimates; surprises?: EpsSurprise[] }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-30" as Nasdaq names the quarter: "Sep 2026". A 52-week quarter ending in the first days of a month is the month before's. */
const fiscalEndName = (iso: string) => {
  const date = new Date(`${iso}T12:00:00Z`);
  if (date.getUTCDate() <= 7) date.setUTCDate(0);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};
const signed = (value: number | null, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(places)}%`);
const tone = (value: number | null) => (value == null ? undefined : value >= 0 ? "up" : "down");
/** Growth on a year, where it means something: not from a loss. */
const growth = (value: number, base: number) => (base > 0 ? value / base - 1 : null);
/** "Q3 FY2026" as a column heading: "Q3 FY26". */
const short = (label: string) => label.replace(/FY20(\d\d)/, "FY$1");

/**
 * The latest earnings release when it is newer than the figures drawn.
 *
 * A second request, not part of `IoCompanyView`: that view is cached for a
 * day, which is the gap this exists to close.
 */
export function useEarningsRelease(view: IoCompanyView): EarningsReleaseFiling | null {
  const [answer, setAnswer] = useState<{ ticker: string; filing: EarningsReleaseFiling | null }>({ ticker: view.company.ticker, filing: null });
  const latestFigures = [...view.quarterly, ...view.annual].map((period) => period.publishedAt).sort().at(-1) ?? view.retrievedAt;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ cik: view.company.cik, after: latestFigures.slice(0, 10) });
    fetch(`/api/io/${encodeURIComponent(view.company.ticker)}/earnings?${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<EarningsAnswer> : null))
      .then((payload) => {
        if (controller.signal.aborted || !payload) return;
        const sameCik = payload.cik === view.company.cik.padStart(10, "0");
        const candidate = payload.filing ?? null;
        setAnswer({ ticker: view.company.ticker, filing: sameCik && candidate && candidate.filingDate > latestFigures.slice(0, 10) ? candidate : null });
      })
      .catch(() => { /* The filed statements stay usable when the index is not. */ });
    return () => controller.abort();
  }, [view.company.cik, view.company.ticker, latestFigures]);

  return answer.ticker === view.company.ticker ? answer.filing : null;
}

/** The consensus and every reported quarter against it, from /api/estimates. */
export function useEpsHistory(ticker: string): { estimates: Estimates | null; surprises: EpsSurprise[] } | null {
  const [answer, setAnswer] = useState<{ ticker: string; body: EstimatesAnswer | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/estimates/${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<EstimatesAnswer> : null))
      .then((body) => { if (!controller.signal.aborted) setAnswer({ ticker, body }); })
      .catch(() => { if (!controller.signal.aborted) setAnswer({ ticker, body: null }); });
    return () => controller.abort();
  }, [ticker]);
  if (answer?.ticker !== ticker) return null;
  return { estimates: answer.body?.estimates ?? null, surprises: answer.body?.surprises ?? answer.body?.estimates?.surprises ?? [] };
}

const ROWS: Array<{ metric: ReleaseMetric; label: string }> = [
  { metric: "revenue", label: "Revenue" },
  { metric: "operatingIncome", label: "Operating income" },
  { metric: "netIncome", label: "Net income" },
  { metric: "dilutedEps", label: "Diluted EPS" },
];

/** The quarter's figures from the release beside the same quarter a year earlier, as filed. */
function ReleaseTable({ reading, currency }: { reading: ReleaseReading; currency: string }) {
  const shown = ROWS.filter((row) => reading.figures[row.metric]);
  if (!shown.length) return null;
  return (
    <div className="sheet release-sheet">
      <table>
        <thead><tr><th className="key" /><th>{short(reading.quarter)}</th><th>{short(reading.yearAgo)}</th><th>y/y</th></tr></thead>
        <tbody>
          {shown.map(({ metric, label }) => {
            const figure = reading.figures[metric]!;
            const write = metric === "dilutedEps" ? (value: number) => price(value, currency) : (value: number) => money(value, currency);
            const change = growth(figure.value, figure.yearAgo);
            return (
              <tr key={metric} title={`Read from "${figure.row}" in ${figure.document}`}>
                <td className="key">{label}</td>
                <td><b>{write(figure.value)}</b></td>
                <td>{write(figure.yearAgo)}</td>
                <td data-dir={tone(change)}>{signed(change)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Earnings per share against what analysts expected for the quarter just released. */
function AgainstConsensus({ reading, history, currency }: { reading: ReleaseReading; history: ReturnType<typeof useEpsHistory>; currency: string }) {
  if (!history) return null;
  const name = fiscalEndName(reading.periodEnd);
  const reported = history.surprises.find((entry) => entry.fiscalEnd === name);
  if (reported?.eps != null && reported.consensus != null) {
    return (
      <p className="release-consensus">
        Adjusted EPS <b>{price(reported.eps, currency)}</b> against a consensus of {price(reported.consensus, currency)}:{" "}
        <b data-dir={tone(reported.surprise)}>{reported.surprise == null ? ABSENT : `${reported.surprise >= 0 ? "beat by" : "missed by"} ${Math.abs(reported.surprise).toFixed(1)}%`}</b>
        <span> · Zacks, as Nasdaq publishes it</span>
      </p>
    );
  }
  const consensus = history.estimates?.quarterly.find((entry) => entry.fiscalEnd === name)?.consensus ?? null;
  const eps = reading.figures.dilutedEps?.value ?? null;
  if (consensus == null) return null;
  return (
    <p className="release-consensus">
      Consensus for the quarter <b>{price(consensus, currency)}</b>
      {eps != null ? <> · diluted EPS in the release <b>{price(eps, currency)}</b> (GAAP; the consensus is usually on adjusted earnings, published here once Nasdaq has it)</> : null}
    </p>
  );
}

/** The release's headline: when it came, what it reads for, and where to open it. */
function ReleaseHead({ filing, reading }: { filing: EarningsReleaseFiling; reading: ReleaseReading | null }) {
  const figures = reading ? Object.keys(reading.figures).length : 0;
  return (
    <div className="earnings-pending-head">
      <div>
        <span className="label">New results · {reading?.quarter ?? "earnings release"} · {filing.form} filed {shortDate(filing.filingDate)}</span>
        <p>{figures
          ? "From the company's press release, before its 10-Q or 10-K: unaudited, each figure proven against the same quarter a year earlier as filed. The statements are still the previous quarter's."
          : "The release is out; its figures could not be proven against the filed ones, so none is shown. The statements are still the previous quarter's."}</p>
      </div>
      <a className="label" href={reading?.documents[0]?.url ?? filing.sourceUrl} target="_blank" rel="noreferrer">Open the release →</a>
    </div>
  );
}

/**
 * A release that is newer than the filed figures: what it says, now, at the
 * top of the document site's company page.
 *
 * The figures are read from the release itself and proven against the filed
 * year-ago quarter (lib/adapters/earnings-release.ts); one that cannot be
 * proven is not shown. They stay preliminary until the 10-Q or 10-K is filed,
 * when the statements take them over and this disappears.
 */
export function PendingEarnings({ view }: { view: IoCompanyView }) {
  const filing = useEarningsRelease(view);
  const history = useEpsHistory(view.company.ticker);
  if (!filing) return null;
  const reading = filing.reading ?? null;
  return (
    <aside className="earnings-pending" role="status" aria-label="New earnings release">
      <ReleaseHead filing={filing} reading={reading} />
      {reading ? <ReleaseTable reading={reading} currency={view.company.currency} /> : null}
      {reading ? <AgainstConsensus reading={reading} history={history} currency={view.company.currency} /> : null}
    </aside>
  );
}

/**
 * One line at the top of the terminal's company page while a release is newer
 * than the filed figures: the quarter's headline figures and their change on
 * a year, a link down to EE for the rest.
 */
export function ReleaseStrip({ view }: { view: IoCompanyView }) {
  const filing = useEarningsRelease(view);
  if (!filing) return null;
  const reading = filing.reading ?? null;
  const currency = view.company.currency;
  const parts = ROWS.flatMap(({ metric, label }) => {
    const figure = reading?.figures[metric];
    if (!figure) return [];
    const change = growth(figure.value, figure.yearAgo);
    return [{ label, value: metric === "dilutedEps" ? price(figure.value, currency) : money(figure.value, currency), change }];
  });
  return (
    <a className="t-release-strip" href="#ee">
      <b>New results</b>
      <span>{reading?.quarter ?? "Earnings release"} · {filing.form} {shortDate(filing.filingDate)}</span>
      {parts.map((part) => (
        <span key={part.label}>{part.label} <em>{part.value}</em> <i data-dir={tone(part.change)}>{signed(part.change)}</i></span>
      ))}
      <span className="t-release-more">EE ↓</span>
    </a>
  );
}

/**
 * EE, the terminal's earnings panel: the latest release where it is newer than
 * the filed figures, how the company has done against the consensus, and the
 * chart of it, quarter by quarter.
 */
export function EarningsBoard({ view, lastFiled }: { view: IoCompanyView; lastFiled: { label: string; filingDate: string } | null }) {
  const filing = useEarningsRelease(view);
  const history = useEpsHistory(view.company.ticker);
  const [mode, setMode] = useState<"quarterly" | "annual">("quarterly");
  const reading = filing?.reading ?? null;
  const currency = view.company.currency;
  const pending = reading?.figures.dilutedEps ? { fiscalEnd: fiscalEndName(reading.periodEnd), eps: reading.figures.dilutedEps.value } : null;
  const scored = (history?.surprises ?? []).filter((entry) => entry.surprise != null);
  const beats = scored.filter((entry) => entry.surprise! > 0).length;
  // The median, not the mean: a quarter expected near zero gives a surprise of hundreds of per cent and would be the average on its own.
  const sorted = scored.map((entry) => entry.surprise!).sort((left, right) => left - right);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) / 100 : null;
  const next = history?.estimates?.quarterly[0] ?? null;

  const facts = (
    <dl className="t-ee-facts">
      <div><dt>Beat the consensus</dt><dd>{scored.length ? `${beats} of ${scored.length}` : ABSENT}</dd></div>
      <div><dt>Median surprise</dt><dd data-dir={tone(median)}>{signed(median)}</dd></div>
      <div><dt>Next quarter</dt><dd>{next ? `${price(next.consensus, currency)} · ${shortQuarter(next.fiscalEnd)}` : ABSENT}</dd></div>
    </dl>
  );
  return (
    <div className="t-ee" data-release={filing ? true : undefined}>
      <div className="t-ee-text">
        {filing ? (
          <div className="earnings-pending">
            <ReleaseHead filing={filing} reading={reading} />
            {reading ? <ReleaseTable reading={reading} currency={currency} /> : null}
            {reading ? <AgainstConsensus reading={reading} history={history} currency={currency} /> : null}
          </div>
        ) : (
          <p className="t-dim t-ee-none">No release since {lastFiled ? <><span className="t-amber">{lastFiled.label}</span>, filed {shortDate(lastFiled.filingDate)}</> : "the filed figures"}.</p>
        )}
        {facts}
      </div>
      <figure className="t-gf-card t-ee-chart">
        <figcaption>
          <h3>{mode === "quarterly" ? "EPS against the consensus" : "EPS by fiscal year · filed, then the consensus"}</h3>
          <div className="seg" role="group" aria-label="Periods">
            <button type="button" aria-pressed={mode === "quarterly"} onClick={() => setMode("quarterly")}>Quarterly</button>
            <button type="button" aria-pressed={mode === "annual"} onClick={() => setMode("annual")}>Annual</button>
          </div>
        </figcaption>
        {mode === "quarterly"
          ? <EpsChart history={history} pending={pending} currency={currency} />
          : <AnnualEpsChart view={view} history={history} currency={currency} />}
      </figure>
    </div>
  );
}

const shortQuarter = (name: string) => name.replace(/^(\w{3}) 20(\d\d)$/, "$1 ’$2");

/**
 * Earnings per share against the consensus, quarter by quarter, on the
 * terminal's own chart (ComboChart): the consensus in grey, what was reported
 * beside it in green where it beat and red where it missed, the surprise as a
 * line on the right axis. A quarter just released and not yet scored is drawn
 * from its release, in amber — GAAP, where the consensus is on adjusted
 * earnings — and the coming quarter has its consensus alone.
 */
export function EpsChart({ history, pending, currency }: {
  history: ReturnType<typeof useEpsHistory>;
  pending: { fiscalEnd: string; eps: number } | null;
  currency: string;
}) {
  if (!history) return <p className="t-empty">Reading the consensus…</p>;
  const scored = [...history.surprises].reverse().filter((entry) => entry.eps != null || entry.consensus != null).slice(-12);
  const bars: Array<{ name: string; reported: string | null; eps: number | null; consensus: number | null; surprise: number | null; state: "beat" | "miss" | "pending" | "none" }> = scored.map((entry) => ({
    name: entry.fiscalEnd, reported: entry.reported, eps: entry.eps, consensus: entry.consensus, surprise: entry.surprise,
    state: entry.surprise == null ? "none" : entry.surprise >= 0 ? "beat" : "miss",
  }));
  if (pending && !bars.some((bar) => bar.name === pending.fiscalEnd)) {
    const consensus = history.estimates?.quarterly.find((entry) => entry.fiscalEnd === pending.fiscalEnd)?.consensus ?? null;
    bars.push({ name: pending.fiscalEnd, reported: null, eps: pending.eps, consensus, surprise: consensus ? (pending.eps / consensus - 1) * 100 : null, state: "pending" });
  }
  // The coming quarter: its consensus alone.
  const next = history.estimates?.quarterly.find((entry) => !bars.some((bar) => bar.name === entry.fiscalEnd));
  if (next?.consensus != null) bars.push({ name: next.fiscalEnd, reported: null, eps: null, consensus: next.consensus, surprise: null, state: "none" });
  if (!bars.length) return <p className="t-empty">No analyst consensus is published for this company.</p>;

  const colour = { beat: "var(--gain)", miss: "var(--loss)", pending: "var(--amber)", none: "var(--c6)" };
  const data: ChartData = {
    labels: bars.map((bar) => shortQuarter(bar.name)),
    names: bars.map((bar) => `${bar.name}${bar.state === "pending" ? " · just released, GAAP from the 8-K" : bar.reported ? ` · reported ${shortDate(bar.reported)}` : bar.eps == null ? " · to come" : ""}`),
    series: [
      { spec: { id: "consensus", label: "Consensus", kind: "bar", axis: "left", color: "var(--ink-3)", value: () => null }, values: bars.map((bar) => bar.consensus) },
      { spec: { id: "reported", label: "Reported EPS", kind: "bar", axis: "left", color: "var(--c6)", value: () => null }, values: bars.map((bar) => bar.eps), colors: bars.map((bar) => colour[bar.state]) },
      { spec: { id: "surprise", label: "Surprise (right)", kind: "line", axis: "right", color: "var(--c5)", value: () => null }, values: bars.map((bar) => (bar.surprise == null ? null : bar.surprise / 100)) },
    ],
  };
  const preset: Preset = { id: "eps-consensus", title: "Earnings per share against the consensus", left: "perShare", right: "percent", series: data.series.map((entry) => entry.spec) };
  return (
    <>
      <ComboChart preset={preset} data={data} currency={currency} height={220} />
      <ul className="t-gf-legend">
        <li data-kind="bar" style={{ "--key": "var(--ink-3)" } as CSSProperties}><i aria-hidden="true" />Consensus</li>
        <li data-kind="bar" style={{ "--key": "var(--gain)" } as CSSProperties}><i aria-hidden="true" />Beat</li>
        <li data-kind="bar" style={{ "--key": "var(--loss)" } as CSSProperties}><i aria-hidden="true" />Missed</li>
        {bars.some((bar) => bar.state === "pending") ? <li data-kind="bar" style={{ "--key": "var(--amber)" } as CSSProperties}><i aria-hidden="true" />Just released (GAAP)</li> : null}
        <li data-kind="line" style={{ "--key": "var(--c5)" } as CSSProperties}><i aria-hidden="true" />Surprise</li>
      </ul>
      <p className="t-study-note">Reported EPS as Zacks scores it (adjusted), against the consensus before the release, as Nasdaq publishes both. The last bar is the coming quarter&apos;s consensus.</p>
    </>
  );
}

/**
 * Earnings per share by fiscal year: as filed in each 10-K for the years past,
 * then the consensus for the years ahead with the analysts' range in the
 * tooltip, and the growth on a year as a line. The filed figure is GAAP and the
 * consensus is on adjusted earnings, which the note says. No past year's
 * consensus is drawn: none was kept before October 2026.
 */
function AnnualEpsChart({ view, history, currency }: { view: IoCompanyView; history: ReturnType<typeof useEpsHistory>; currency: string }) {
  if (!history) return <p className="t-empty">Reading the consensus…</p>;
  const filed = view.annual
    .map((period) => ({ name: fiscalEndName(period.end), label: `FY${String(period.fiscalYear).slice(2)}`, eps: period.reportedEps ?? period.values.netIncomePerShare ?? null, filed: period.filingDate }))
    .filter((year) => year.eps != null)
    .slice(-7);
  const yearOf = (name: string) => Number(name.split(" ")[1]);
  const lastFiledYear = filed.length ? yearOf(filed.at(-1)!.name) : -Infinity;
  const ahead = (history.estimates?.yearly ?? []).filter((entry) => entry.consensus != null && yearOf(entry.fiscalEnd) > lastFiledYear).slice(0, 3);
  if (!filed.length && !ahead.length) return <p className="t-empty">No annual earnings per share to draw.</p>;

  const rows = [
    ...filed.map((year) => ({ label: year.label, name: `${year.label} · filed ${shortDate(year.filed)} (GAAP)`, eps: year.eps, consensus: null as number | null })),
    ...ahead.map((entry) => ({
      label: `FY${String(yearOf(entry.fiscalEnd)).slice(2)}E`,
      name: `FY${yearOf(entry.fiscalEnd)} · consensus of ${entry.analysts ?? "?"} analyst${entry.analysts === 1 ? "" : "s"}, ${price(entry.low, currency)} to ${price(entry.high, currency)}`,
      eps: null as number | null, consensus: entry.consensus,
    })),
  ];
  const level = rows.map((row) => row.eps ?? row.consensus);
  const data: ChartData = {
    labels: rows.map((row) => row.label),
    names: rows.map((row) => row.name),
    series: [
      { spec: { id: "filed", label: "Filed EPS", kind: "bar", axis: "left", color: "var(--c6)", value: () => null }, values: rows.map((row) => row.eps) },
      { spec: { id: "consensus", label: "Consensus", kind: "bar", axis: "left", color: "var(--ink-3)", value: () => null }, values: rows.map((row) => row.consensus) },
      { spec: { id: "growth", label: "On a year (right)", kind: "line", axis: "right", color: "var(--c5)", value: () => null },
        values: level.map((value, index) => (index > 0 && value != null && level[index - 1] != null && level[index - 1]! > 0 ? value / level[index - 1]! - 1 : null)) },
    ],
  };
  const preset: Preset = { id: "eps-annual", title: "Earnings per share by fiscal year", left: "perShare", right: "percent", series: data.series.map((entry) => entry.spec) };
  return (
    <>
      <ComboChart preset={preset} data={data} currency={currency} height={220} />
      <ul className="t-gf-legend">
        <li data-kind="bar" style={{ "--key": "var(--c6)" } as CSSProperties}><i aria-hidden="true" />Filed (10-K, GAAP)</li>
        <li data-kind="bar" style={{ "--key": "var(--ink-3)" } as CSSProperties}><i aria-hidden="true" />Consensus (adjusted)</li>
        <li data-kind="line" style={{ "--key": "var(--c5)" } as CSSProperties}><i aria-hidden="true" />On a year</li>
      </ul>
      <p className="t-study-note">Filed diluted EPS from each 10-K, then the analysts&apos; consensus for the years ahead (Zacks, via Nasdaq). Filed figures are GAAP; the consensus is on adjusted earnings.</p>
    </>
  );
}
