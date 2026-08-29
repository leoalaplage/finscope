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

/**
 * The statistics of the company you are reading, and of any you compare it to.
 *
 * This used to be a destination of its own in the main navigation, sitting
 * beside a Statistics *tab* on the company page that rendered the very same
 * panel. The only difference was that the destination could hold six companies
 * and the tab could hold one, so "Compare with others" was a button that threw
 * you out of the company you were reading to show you a page that looked
 * almost identical.
 *
 * There is one place now. The open company is always the first column and
 * cannot be removed — you are on its page — and up to five others join it
 * without leaving. The panel underneath, and every formula in it, is unchanged.
 */
export function CompanyStatisticsTab({ dataset, price, watchlist, datasets, onLoad }: {
  dataset: CompanyDataset;
  /** Already fetched by the page around this one; no reason to ask again. */
  price: PricePoint | null;
  watchlist: CompanyProfile[];
  datasets: Record<string, CompanyDataset>;
  onLoad: (ticker: string) => Promise<CompanyDataset | undefined>;
}) {
  const anchor = dataset.company.ticker;
  const [compared, setCompared] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, PricePoint | null>>({});

  // Choosing a company is a request for its filings and its price. Both are
  // fetched here rather than by the panel, so the panel stays a pure render of
  // whatever has arrived. What is still in flight needs no state of its own: a
  // company is loading exactly when it is selected and has no dataset yet.
  useEffect(() => {
    for (const ticker of compared) {
      if (!datasets[ticker]) void onLoad(ticker).catch(() => { /* The error banner already reports it. */ });
    }
  }, [compared, datasets, onLoad]);

  useEffect(() => {
    let active = true;
    for (const ticker of compared) {
      if (ticker in prices) continue;
      fetch(`/api/price/${encodeURIComponent(ticker)}?date=${today()}`).then(async (response) => {
        const payload = await response.json() as PricePoint & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Price unavailable");
        if (active) setPrices((current) => ({ ...current, [ticker]: payload }));
      }).catch(() => active && setPrices((current) => ({ ...current, [ticker]: null })));
    }
    return () => { active = false; };
  }, [compared, prices]);

  /*
   * Nothing resets the comparison when you change company, because nothing has
   * to: the company page above this one is keyed on its ticker, so opening
   * another company unmounts this and mounts a fresh one. An effect that
   * emptied the list on `anchor` changing would only be a second, slower way of
   * doing what the key already did — and one that renders twice to do it.
   */

  function toggle(ticker: string) {
    setCompared((current) => current.includes(ticker)
      ? current.filter((item) => item !== ticker)
      : current.length + 1 >= MAX_COMPARED ? current : [...current, ticker]);
  }

  const others = compared.map((ticker) => datasets[ticker]).filter((item): item is CompanyDataset => Boolean(item));
  const pending = compared.filter((ticker) => !datasets[ticker]);
  const shown = [dataset, ...others];

  return <section className="plain-section">
    <div className="section-heading">
      <h2>Statistics</h2>
      {compared.length > 0 && <button onClick={() => setCompared([])}>Just {anchor}</button>}
    </div>
    <p className="section-note">
      {compared.length === 0
        ? `${dataset.company.name} on its own. Add a company below to compare them row by row.`
        : `${shown.length} companies compared · the better value in each row is marked.`}
    </p>

    <div className="stat-picker" role="group" aria-label="Companies to compare with this one">
      <span className="stat-picker-anchor">{anchor}</span>
      {watchlist
        .filter((company) => company.ticker !== anchor && company.resolutionStatus !== "unresolved")
        .map((company) => {
          const on = compared.includes(company.ticker);
          return <button key={company.ticker} className={on ? "active" : ""} aria-pressed={on}
            disabled={!on && compared.length + 1 >= MAX_COMPARED}
            onClick={() => toggle(company.ticker)}>{company.ticker}</button>;
        })}
      <span className="stat-picker-count">{shown.length} of {MAX_COMPARED}</span>
    </div>

    {pending.length > 0 && <p className="simple-state">Loading {pending.join(", ")}…</p>}
    <CompanyStatistics datasets={shown} prices={{ [anchor]: price, ...prices }}/>
  </section>;
}
