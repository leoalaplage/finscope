"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { CandleInterval } from "@/lib/adapters/candles";
import { INTERVAL_TITLES } from "@/lib/io/candle-chart";
import { readStudies, STUDIES, STUDY_NAMES, type Study } from "@/lib/io/technicals";
import { CandleChart, IntervalPicker, lastMoveOf, percent, price, signed, tone, useCandles } from "./CandleChart";
import { useRememberedCompany } from "./remembered";
import { Search } from "./Search";

/**
 * The chart page: one symbol's candles by day, week or month (drawn by
 * CandleChart), with the analysis the chart does by itself — averages,
 * Fibonacci, fair value gaps, trend lines, support and resistance, breaks of
 * structure and order blocks (lib/io/technicals.ts) — each switched on or off
 * by the reader and remembered on this device.
 */

const PARAM_OF: Record<CandleInterval, string> = { "1d": "d", "1wk": "w", "1mo": "m" };
const INTERVAL_OF: Record<string, CandleInterval> = { d: "1d", w: "1wk", m: "1mo" };
const ADDRESS_EVENT = "finscope:chart-address";
const STUDIES_KEY = "finscope.chart.studies";
const STUDIES_EVENT = "finscope:chart-studies";

function subscribeStudies(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(STUDIES_EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(STUDIES_EVENT, notify); };
}
function readStoredStudies() {
  try { return localStorage.getItem(STUDIES_KEY); } catch { return null; }
}
function writeStudies(next: Set<Study>) {
  try { localStorage.setItem(STUDIES_KEY, JSON.stringify([...next])); } catch { /* this visit only */ }
  window.dispatchEvent(new Event(STUDIES_EVENT));
}

function subscribeAddress(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener(ADDRESS_EVENT, notify);
  return () => { window.removeEventListener("popstate", notify); window.removeEventListener(ADDRESS_EVENT, notify); };
}

function writeAddress(change: Record<string, string>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(change)) url.searchParams.set(key, value);
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new Event(ADDRESS_EVENT));
}

export function ChartPage({ initial }: { initial: string }) {
  const search = useSyncExternalStore(subscribeAddress, () => window.location.search, () => "");
  const address = new URLSearchParams(search);
  const asked = address.get("s")?.toUpperCase().replace(/[^A-Z0-9.-]/g, "") ?? "";
  const remembered = useRememberedCompany();
  const symbol = asked || remembered || initial;
  const interval = INTERVAL_OF[address.get("i") ?? ""] ?? "1d";
  const storedStudies = useSyncExternalStore(subscribeStudies, readStoredStudies, () => null);
  const studies = useMemo(() => readStudies(storedStudies), [storedStudies]);
  const on = (study: Study) => studies.has(study);
  const toggle = (study: Study) => {
    const next = new Set(studies);
    if (next.has(study)) next.delete(study); else next.add(study);
    writeStudies(next);
  };

  const { candles, error, loading } = useCandles(symbol, interval);
  const latest = lastMoveOf(candles);

  return (
    <main className="wrap chart-route" id="main-content" tabIndex={-1}>
      <header className="chart-head">
        <div className="chart-title">
          <h1>{symbol}</h1>
          <span className="dim">{candles && candles.name !== candles.symbol ? candles.name : ""}</span>
        </div>
        {latest ? (
          <div className="chart-last">
            <span className="chart-price">{price(latest.close)}</span>
            {latest.move != null && latest.base ? (
              <span className="chart-change" data-tone={tone(latest.move)}>
                {signed(latest.move)} ({percent(latest.move / latest.base)})
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="chart-search"><Search onPick={(next) => writeAddress({ s: next.toUpperCase() })} /></div>
      </header>

      <div className="chart-bar">
        <IntervalPicker interval={interval} onInterval={(item) => writeAddress({ i: PARAM_OF[item] })} />
      </div>

      <div className="chart-studies" role="group" aria-label="Analysis on the chart">
        {STUDIES.map((study) => (
          <button type="button" className="metric-toggle" key={study} aria-pressed={on(study)} onClick={() => toggle(study)}>
            {STUDY_NAMES[study]}
          </button>
        ))}
      </div>

      <CandleChart
        candles={candles} interval={interval} loading={loading} error={error} studies={studies}
        label={`${symbol}, ${INTERVAL_TITLES[interval].toLowerCase()} candles`}
      />
    </main>
  );
}
