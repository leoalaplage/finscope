"use client";

import { useEffect, useState } from "react";
import { CompanyStatistics } from "./CompanyStatistics";
import type { CompanyDataset, CompanyProfile, PricePoint } from "@/lib/types";

/**
 * Comparing more than a handful of companies at once turns a readable row into
 * a horizontal scroll nobody follows, and each one costs a dataset fetch.
 */
const MAX_COMPARED = 6;

const today = () => new Date().toISOString().slice(0, 10);

export function StatisticsPage({ watchlist, datasets, activeTicker, onLoad }: {
  watchlist: CompanyProfile[];
  datasets: Record<string, CompanyDataset>;
  activeTicker: string;
  onLoad: (ticker: string) => Promise<CompanyDataset | undefined>;
}) {
  const [selected, setSelected] = useState<string[]>(() => [activeTicker]);
  const [prices, setPrices] = useState<Record<string, PricePoint | null>>({});

  // Selecting a company is a request for its filings and its price. Both are
  // fetched here rather than by the panel, so the panel stays a pure render of
  // whatever has arrived. What is still in flight needs no state of its own:
  // a company is loading exactly when it is selected and has no dataset yet.
  useEffect(() => {
    for (const ticker of selected) {
      if (!datasets[ticker]) void onLoad(ticker).catch(() => { /* The error banner already reports it. */ });
    }
  }, [selected, datasets, onLoad]);

  useEffect(() => {
    let active = true;
    for (const ticker of selected) {
      if (ticker in prices) continue;
      fetch(`/api/price/${encodeURIComponent(ticker)}?date=${today()}`).then(async (response) => {
        const payload = await response.json() as PricePoint & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Price unavailable");
        if (active) setPrices((current) => ({ ...current, [ticker]: payload }));
      }).catch(() => active && setPrices((current) => ({ ...current, [ticker]: null })));
    }
    return () => { active = false; };
  }, [selected, prices]);

  function toggle(ticker: string) {
    setSelected((current) => current.includes(ticker)
      ? (current.length === 1 ? current : current.filter((item) => item !== ticker))
      : current.length >= MAX_COMPARED ? current : [...current, ticker]);
  }

  const ready = selected.map((ticker) => datasets[ticker]).filter((item): item is CompanyDataset => Boolean(item));
  const pending = selected.filter((ticker) => !datasets[ticker]);

  return <div>
    <header className="page-heading">
      <div>
        <h1>Statistics</h1>
        <p>{selected.length === 1 ? "One company in detail. Add another to compare them row by row." : `${selected.length} companies compared · the better value in each row is highlighted.`}</p>
      </div>
      {selected.length > 1 && <button onClick={() => setSelected([selected[0]])}>Back to one</button>}
    </header>

    <div className="stat-picker" role="group" aria-label="Companies to compare">
      {watchlist.map((company) => {
        const on = selected.includes(company.ticker);
        return <button key={company.ticker} className={on ? "active" : ""} aria-pressed={on}
          disabled={!on && selected.length >= MAX_COMPARED}
          onClick={() => toggle(company.ticker)}>{company.ticker}</button>;
      })}
      <span className="stat-picker-count">{selected.length} of {MAX_COMPARED}</span>
    </div>

    {pending.length > 0 && <p className="simple-state">Loading {pending.join(", ")}…</p>}
    {ready.length > 0 && <CompanyStatistics datasets={ready} prices={prices}/>}
  </div>;
}
