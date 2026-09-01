"use client";

import { useEffect, useRef, useState } from "react";
import { CompanyStatistics } from "./CompanyStatistics";
import { PriceDrivers } from "./PriceDrivers";
import { SkeletonTable } from "./Skeleton";
import { getJson } from "@/lib/fetch-json";
import type { StatisticsPeriodicity } from "@/lib/company-statistics";
import { currentDatasetPeriod } from "@/lib/current-period";
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
 * There is one place now. The open company starts as the first column, but is
 * a selection like every other one: after adding another company it can be
 * removed to inspect that company alone without leaving this page.
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
  const [selected, setSelected] = useState<string[]>([anchor]);
  const [periodicity, setPeriodicity] = useState<StatisticsPeriodicity>(() =>
    dataset.periods.some((period) => period.periodicity === "ttm") ? "ttm" : "annual");
  const [prices, setPrices] = useState<Record<string, PricePoint | null>>({});
  const requested = useRef(new Set<string>());

  // Choosing a company is a request for its filings and its price. Both are
  // fetched here rather than by the panel, so the panel stays a pure render of
  // whatever has arrived. What is still in flight needs no state of its own: a
  // company is loading exactly when it is selected and has no dataset yet.
  useEffect(() => {
    for (const ticker of selected) {
      if (ticker === anchor) continue;
      // A ticker may already exist as the annual-only startup fixture. Ask the
      // shell once anyway: its age-aware loader returns a live cached dataset
      // cheaply, which restores TTM without issuing duplicate requests.
      if (requested.current.has(ticker)) continue;
      requested.current.add(ticker);
      void onLoad(ticker).catch(() => {
        requested.current.delete(ticker);
        // The shell's error banner already reports the failure.
      });
    }
  }, [anchor, datasets, onLoad, selected]);

  useEffect(() => {
    let active = true;
    for (const ticker of selected) {
      if (ticker === anchor) continue;
      if (ticker in prices) continue;
      getJson<PricePoint>(`/api/price/${encodeURIComponent(ticker)}?date=${today()}`, { what: `the price for ${ticker}` })
        .then((payload) => { if (active) setPrices((current) => ({ ...current, [ticker]: payload })); })
        .catch(() => active && setPrices((current) => ({ ...current, [ticker]: null })));
    }
    return () => { active = false; };
  }, [anchor, prices, selected]);

  /*
   * Nothing resets the comparison when you change company, because nothing has
   * to: the company page above this one is keyed on its ticker, so opening
   * another company unmounts this and mounts a fresh one. An effect that
   * emptied the list on `anchor` changing would only be a second, slower way of
   * doing what the key already did — and one that renders twice to do it.
   */

  function toggle(ticker: string) {
    setSelected((current) => current.includes(ticker)
      ? current.filter((item) => item !== ticker)
      : current.length >= MAX_COMPARED ? current : [...current, ticker]);
  }

  const shown = selected.map((ticker) => ticker === anchor ? dataset : datasets[ticker]).filter((item): item is CompanyDataset => Boolean(item));
  const pending = selected.filter((ticker) => ticker !== anchor && !datasets[ticker]);
  const ttmReady = shown.length > 0 && pending.length === 0 && shown.every((item) => currentDatasetPeriod(item)?.periodicity === "ttm");
  const effectivePeriodicity: StatisticsPeriodicity = periodicity === "ttm" && !ttmReady ? "annual" : periodicity;
  const driverDataset = shown.length === 1 ? shown[0] : dataset;

  return <section className="plain-section">
    <div className="section-heading">
      <h2>Statistics</h2>
      <div className="period-buttons" role="group" aria-label="Statistics period">
        <button className={effectivePeriodicity === "annual" ? "active" : ""} aria-pressed={effectivePeriodicity === "annual"} onClick={() => setPeriodicity("annual")}>Annual</button>
        <button className={effectivePeriodicity === "ttm" ? "active" : ""} aria-pressed={effectivePeriodicity === "ttm"} disabled={!ttmReady} onClick={() => setPeriodicity("ttm")}>TTM</button>
      </div>
    </div>
    <p className="section-note">
      {selected.length === 0
        ? "Select at least one company below."
        : shown.length === 1 && pending.length === 0
          ? `${shown[0].company.name} on its own · ${effectivePeriodicity === "ttm" ? "latest trailing twelve months" : "latest filed year"}.`
          : `${shown.length + pending.length} companies selected · the better value in each row is marked.`}
      {periodicity === "ttm" && !ttmReady && selected.length > 0 && <> TTM is unavailable until every selected company has a trailing period.</>}
    </p>

    <div className="stat-picker" role="group" aria-label="Companies to compare">
      <button className={selected.includes(anchor) ? "active" : ""} aria-pressed={selected.includes(anchor)} onClick={() => toggle(anchor)}>{anchor}</button>
      {watchlist
        .filter((company) => company.ticker !== anchor && company.resolutionStatus !== "unresolved")
        .map((company) => {
          const on = selected.includes(company.ticker);
          return <button key={company.ticker} className={on ? "active" : ""} aria-pressed={on}
            disabled={!on && selected.length >= MAX_COMPARED}
            onClick={() => toggle(company.ticker)}>{company.ticker}</button>;
        })}
      <span className="stat-picker-count">{selected.length} of {MAX_COMPARED}</span>
    </div>

    {pending.length > 0 && <SkeletonTable label={`${pending.join(", ")} for comparison`} rows={4}/>}
    <CompanyStatistics datasets={shown} prices={{ [anchor]: price, ...prices }} periodicity={effectivePeriodicity}/>
    {/* The price-driver chart belongs to one company. With one selection it
        follows that selection; in a comparison it stays on the page's company. */}
    {driverDataset && <PriceDrivers dataset={driverDataset}/>}
  </section>;
}
