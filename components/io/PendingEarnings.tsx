"use client";

import { useEffect, useState, type ReactNode } from "react";
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
/** Growth on a year, where it means something: not across a loss. */
const growth = (value: number, base: number) => (base > 0 && value > -Infinity ? value / base - 1 : null);

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
        <thead><tr><th className="key">{reading.quarter}</th><th>Reported</th><th>{reading.yearAgo}</th><th>On a year</th></tr></thead>
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

/**
 * A release that is newer than the filed figures: what it says, now.
 *
 * The figures are read from the release itself and proven against the filed
 * year-ago quarter (lib/adapters/earnings-release.ts); one that cannot be
 * proven is not shown. They stay preliminary until the 10-Q or 10-K is filed,
 * when the statements below take them over and this disappears.
 */
export function PendingEarnings({ view, empty = null, chart = false }: {
  view: IoCompanyView;
  /** What to draw when no release is newer than the figures; the terminal's EE panel says so. */
  empty?: ReactNode;
  /** The EPS-against-consensus chart under it, as the terminal's EE panel draws it. */
  chart?: boolean;
}) {
  const filing = useEarningsRelease(view);
  const history = useEpsHistory(view.company.ticker);
  const reading = filing?.reading ?? null;
  const currency = view.company.currency;
  const pendingEps = reading?.figures.dilutedEps ? { fiscalEnd: fiscalEndName(reading.periodEnd), eps: reading.figures.dilutedEps.value } : null;
  const drawn = chart ? <EpsChart history={history} pending={pendingEps} currency={currency} /> : null;

  if (!filing) return <>{empty}{drawn}</>;
  const figures = reading ? Object.keys(reading.figures).length : 0;
  return (
    <>
      <aside className="earnings-pending" role="status" aria-label="New earnings release">
        <div className="earnings-pending-head">
          <div>
            <span className="label">New results · {reading?.quarter ?? "earnings release"} · {filing.form} filed {shortDate(filing.filingDate)}</span>
            <p>{figures
              ? "From the company's press release, before its 10-Q or 10-K: unaudited, each figure proven against the same quarter a year earlier as filed. The statements below are still the previous quarter's."
              : "The release is out; its figures could not be proven against the filed ones, so none is shown. The statements below are still the previous quarter's."}</p>
          </div>
          <a className="label" href={reading?.documents[0]?.url ?? filing.sourceUrl} target="_blank" rel="noreferrer">Open the release →</a>
        </div>
        {reading ? <ReleaseTable reading={reading} currency={currency} /> : null}
        {reading ? <AgainstConsensus reading={reading} history={history} currency={currency} /> : null}
      </aside>
      {drawn}
    </>
  );
}

/**
 * Earnings per share against the consensus, quarter by quarter: the
 * expectation as an outline, what was reported as the bar inside it, green
 * where it beat and red where it missed, the surprise above. A quarter just
 * released and not yet scored is drawn from its release, in amber, its
 * figure GAAP where the consensus is on adjusted earnings.
 */
export function EpsChart({ history, pending, currency }: {
  history: ReturnType<typeof useEpsHistory>;
  pending: { fiscalEnd: string; eps: number } | null;
  currency: string;
}) {
  if (!history) return <p className="t-empty">Reading the consensus…</p>;
  const scored = [...history.surprises].reverse().filter((entry) => entry.eps != null || entry.consensus != null).slice(-8);
  const bars: Array<{ name: string; eps: number | null; consensus: number | null; surprise: number | null; pending: boolean }> = scored.map((entry) => ({
    name: entry.fiscalEnd, eps: entry.eps, consensus: entry.consensus, surprise: entry.surprise, pending: false,
  }));
  if (pending && !bars.some((bar) => bar.name === pending.fiscalEnd)) {
    const consensus = history.estimates?.quarterly.find((entry) => entry.fiscalEnd === pending.fiscalEnd)?.consensus ?? null;
    bars.push({ name: pending.fiscalEnd, eps: pending.eps, consensus, surprise: consensus ? (pending.eps / consensus - 1) * 100 : null, pending: true });
  }
  // The next quarter's consensus, as an outline with nothing in it yet.
  const next = history.estimates?.quarterly.find((entry) => !bars.some((bar) => bar.name === entry.fiscalEnd));
  if (next?.consensus != null) bars.push({ name: next.fiscalEnd, eps: null, consensus: next.consensus, surprise: null, pending: false });
  if (!bars.length) return <p className="t-empty">No analyst consensus is published for this company.</p>;

  const values = bars.flatMap((bar) => [bar.eps, bar.consensus]).filter((value): value is number => value != null);
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const width = 320; const height = 150; const padTop = 18; const padBottom = 18;
  const span = top - bottom || 1;
  const y = (value: number) => padTop + (top - value) / span * (height - padTop - padBottom);
  const slot = width / bars.length;
  const beats = bars.filter((bar) => !bar.pending && bar.surprise != null);
  const beat = beats.filter((bar) => bar.surprise! > 0).length;

  return (
    <figure className="eps-chart">
      <figcaption>
        <span>EPS against the consensus</span>
        {beats.length ? <span>beat {beat} of {beats.length}</span> : null}
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Earnings per share against the analysts' consensus, by quarter">
        <line x1={0} x2={width} y1={y(0)} y2={y(0)} className="eps-axis" />
        {bars.map((bar, index) => {
          const x = index * slot;
          const outer = Math.min(34, slot * 0.7);
          const inner = outer * 0.56;
          const state = bar.pending ? "pending" : bar.surprise == null ? "none" : bar.surprise >= 0 ? "beat" : "miss";
          return (
            <g key={bar.name}>
              <title>{`${bar.name}: ${bar.eps == null ? "not reported yet" : `${price(bar.eps, currency)}${bar.pending ? " (GAAP, from the release)" : ""}`} · consensus ${price(bar.consensus, currency)}${bar.surprise == null ? "" : ` · ${bar.surprise >= 0 ? "+" : "−"}${Math.abs(bar.surprise).toFixed(1)}%`}`}</title>
              {bar.consensus != null ? (
                <rect x={x + (slot - outer) / 2} width={outer} y={Math.min(y(bar.consensus), y(0))} height={Math.max(1, Math.abs(y(bar.consensus) - y(0)))} className="eps-consensus" />
              ) : null}
              {bar.eps != null ? (
                <rect x={x + (slot - inner) / 2} width={inner} y={Math.min(y(bar.eps), y(0))} height={Math.max(1, Math.abs(y(bar.eps) - y(0)))} className="eps-actual" data-state={state} />
              ) : null}
              {bar.surprise != null ? (
                <text x={x + slot / 2} y={Math.max(10, Math.min(y(bar.eps ?? 0), y(bar.consensus ?? 0)) - 5)} className="eps-label" data-state={state}>
                  {`${bar.surprise >= 0 ? "+" : "−"}${Math.abs(bar.surprise).toFixed(1)}%`}
                </text>
              ) : null}
              <text x={x + slot / 2} y={height - 4} className="eps-tick">{bar.name.replace(/ 20(\d\d)$/, " ’$1")}</text>
            </g>
          );
        })}
      </svg>
      <p className="eps-note">Outline: the consensus before the release. Bar: earnings per share as Zacks scores them (adjusted){pending ? "; amber, the quarter just released, GAAP from the release" : ""}. The last outline is the coming quarter.</p>
    </figure>
  );
}
