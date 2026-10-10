"use client";

import { useEffect, useState } from "react";
import type { EarningsReleaseFiling, PreliminaryEarningsPeriod } from "@/lib/adapters/earnings";
import type { IoCompanyView } from "@/lib/io/view";
import { money, price, shortDate } from "./format";

interface EarningsAnswer {
  cik?: string;
  filing?: EarningsReleaseFiling | null;
}

function EarningsPeriod({ period, currency }: { period: PreliminaryEarningsPeriod; currency: string }) {
  const figures = [
    ["Revenue", money(period.revenue, currency)],
    ["Operating income", money(period.operatingIncome, currency)],
    ["Net income", money(period.netIncome, currency)],
    ["Diluted EPS", price(period.dilutedEps, currency)],
    ...(period.freeCashFlow == null ? [] : [["Free cash flow", money(period.freeCashFlow, currency)]]),
  ];
  return (
    <section className="earnings-period" aria-label={`${period.label} preliminary figures`}>
      <span className="label">{period.label}</span>
      <dl>{figures.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>
  );
}

/**
 * A release that is newer than the XBRL figures currently drawn.
 *
 * It is deliberately a second request. Putting it inside `IoCompanyView`
 * would leave the notice behind that view's one-day cache — the exact gap the
 * notice exists to expose.
 */
export function PendingEarnings({ view, empty = null }: {
  view: IoCompanyView;
  /** What to draw when no release is newer than the figures; the terminal's EE panel says so. */
  empty?: React.ReactNode;
}) {
  const [answer, setAnswer] = useState<{ ticker: string; filing: EarningsReleaseFiling | null }>({
    ticker: view.company.ticker,
    filing: null,
  });
  const latestFigures = view.ttm?.publishedAt
    ?? view.quarterly.at(-1)?.publishedAt
    ?? view.annual.at(-1)?.publishedAt
    ?? view.retrievedAt;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ cik: view.company.cik, after: latestFigures.slice(0, 10) });
    fetch(`/api/io/${encodeURIComponent(view.company.ticker)}/earnings?${query}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<EarningsAnswer> : null)
      .then((payload) => {
        if (controller.signal.aborted || !payload) return;
        const sameCik = payload.cik === view.company.cik.padStart(10, "0");
        const candidate = payload.filing ?? null;
        const filing = sameCik && candidate && candidate.filingDate > latestFigures.slice(0, 10) ? candidate : null;
        setAnswer({ ticker: view.company.ticker, filing });
      })
      .catch(() => { /* Fundamental statements remain usable when the index is unavailable. */ });
    return () => controller.abort();
  }, [view.company.cik, view.company.ticker, latestFigures]);

  const filing = answer.ticker === view.company.ticker ? answer.filing : null;
  if (!filing) return empty;
  const preliminary = filing.preliminary;

  return (
    <aside className="earnings-pending" role="status" aria-label="New earnings release">
      <div className="earnings-pending-head">
        <div>
          <span className="label">New earnings release · {filing.form} filed {shortDate(filing.filingDate)}</span>
          <p>{preliminary
            ? "Preliminary, unaudited figures from Exhibit 99.1. The normalized statements remain based on filed XBRL."
            : "The figures below still reflect the last XBRL statements available to FinScope."}</p>
        </div>
        <a className="label" href={preliminary?.sourceUrl ?? filing.sourceUrl} target="_blank" rel="noreferrer">Open SEC filing →</a>
      </div>
      {preliminary && <div className="earnings-preview">
        {preliminary.quarter && <EarningsPeriod period={preliminary.quarter} currency={preliminary.currency} />}
        {preliminary.annual && <EarningsPeriod period={preliminary.annual} currency={preliminary.currency} />}
      </div>}
    </aside>
  );
}
