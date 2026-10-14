"use client";

import { useEffect, useMemo, useState } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import type { IoQuote } from "./quote";
import { PEER_METRICS, type PeerMetricKey, type PeerTable } from "@/lib/peers";
import { monthEnds, multipleSeries, multipleStats, type MultipleKey } from "@/lib/io/valuation-multiples";
import { ABSENT, money } from "./format";

/** The measures that have a history of their own here (lib/io/valuation-multiples.ts). */
const HISTORY: Partial<Record<PeerMetricKey, MultipleKey>> = { "EV/EBIT": "evEbit", "EV/FCF": "evFcf", "FCF Yield": "fcfYield" };
const write = (value: number | null | undefined, percent: boolean) =>
  value == null || !Number.isFinite(value) ? ABSENT : percent ? `${value.toFixed(1)}%` : `${value.toFixed(1)}×`;

/**
 * PEER: each multiple against the company's sector in the S&P 500 — the
 * sector's median and where the company ranks, cheapest first — beside where
 * today's figure sits in the company's own ten years, so cheap against peers
 * and cheap against itself can be told apart.
 */
export function PeerValuation({ view, quote }: { view: IoCompanyView; quote: IoQuote | null }) {
  const ticker = view.company.ticker;
  const [table, setTable] = useState<{ ticker: string; table: PeerTable | null } | null>(null);
  const [prices, setPrices] = useState<{ ticker: string; prices: Array<{ date: string; price: number; currency: string | null }> } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const dates = useMemo(() => monthEnds(today), [today]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/sector-peers/${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ table: PeerTable | null }> : null))
      .then((body) => { if (!controller.signal.aborted) setTable({ ticker, table: body?.table ?? null }); })
      .catch(() => { if (!controller.signal.aborted) setTable({ ticker, table: null }); });
    // The same month-ends the VAL panel prices, so the browser answers the second ask.
    fetch(`/api/prices/${encodeURIComponent(ticker)}?dates=${encodeURIComponent(dates.join(","))}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ points?: Array<{ point?: { priceClose?: number; close?: number; date: string; currency?: string } | null }> }> : null))
      .then((body) => {
        if (controller.signal.aborted) return;
        setPrices({ ticker, prices: (body?.points ?? []).flatMap((item) => {
          const price = item.point?.priceClose ?? item.point?.close;
          return price != null && item.point ? [{ date: item.point.date, price, currency: item.point.currency ?? null }] : [];
        }) });
      })
      .catch(() => { /* Without prices the own-history column says so. */ });
    return () => controller.abort();
  }, [ticker, dates]);

  const history = useMemo(() => {
    const points = prices?.ticker === ticker ? prices.prices : [];
    if (!points.length) return null;
    const live = quote?.price != null ? [{ date: today, price: quote.price, currency: quote.currency ?? null }] : [];
    return multipleSeries(view.trailing, [...points, ...live]);
  }, [prices, ticker, quote, view.trailing, today]);

  const current = table?.ticker === ticker ? table : null;
  if (!current) return <p className="t-empty">Setting the company against its sector…</p>;
  if (!current.table) return <p className="t-empty">This company is not in the S&amp;P 500, whose members are the peers here.</p>;
  const peers = current.table;

  return (
    <div className="peer">
      <p className="peer-lede">
        <b>{peers.sector ?? "Unclassified"}</b> · {peers.members} members of the S&amp;P 500
        {peers.members < 6 ? <span className="t-dim"> · few peers: read the ranks loosely</span> : null}
      </p>
      <div className="sheet peer-sheet">
        <table>
          <thead><tr><th className="key">Measure</th><th>{peers.ticker}</th><th>Sector median</th><th>Against the sector</th><th>Against its own 10 years</th></tr></thead>
          <tbody>
            {peers.metrics.map((metric) => {
              const own = HISTORY[metric.key] && history ? multipleStats(history, HISTORY[metric.key]!) : null;
              const spec = PEER_METRICS.find((entry) => entry.key === metric.key)!;
              // Where today sits in its own range, read the same way: cheaper than what share of its own history.
              const ownCheaper = own?.percentile == null ? null : spec.higherIsCheaper ? own.percentile : 1 - own.percentile;
              return (
                <tr key={metric.key}>
                  <td className="key">{metric.label}</td>
                  <td><b>{write(metric.company, metric.percent)}</b></td>
                  <td>{write(metric.median, metric.percent)}</td>
                  <td>{metric.cheaperThan == null ? <span className="t-dim">{ABSENT}</span> : <Rank share={metric.cheaperThan} label={`Cheaper than ${Math.round(metric.cheaperThan * 100)}% of ${metric.count - 1}`} />}</td>
                  <td>{ownCheaper == null ? <span className="t-dim">{HISTORY[metric.key] ? (history ? ABSENT : "Pricing…") : "No history here"}</span> : (
                    <Rank share={ownCheaper} label={`Cheaper than ${Math.round(ownCheaper * 100)}% of its months · median ${write(metric.percent ? own!.median! * 100 : own!.median, metric.percent)}`} />
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sheet peer-sheet">
        <table>
          <thead><tr><th className="key">Largest in the sector</th><th>Market value</th>{PEER_METRICS.map((spec) => <th key={spec.key}>{spec.label.replace("Free cash flow yield", "FCF yield").replace("EV / free cash flow", "EV / FCF")}</th>)}</tr></thead>
          <tbody>
            {peers.peers.map((peer) => (
              <tr key={peer.ticker} data-self={peer.ticker === peers.ticker || undefined}>
                <td className="key"><a href={`/t/s/${encodeURIComponent(peer.ticker)}`}>{peer.ticker}</a> <span className="t-dim">{peer.name}</span></td>
                <td>{peer.marketCap == null ? ABSENT : money(peer.marketCap * 1e9, "USD")}</td>
                {PEER_METRICS.map((spec) => <td key={spec.key}>{write(peer.values[spec.key], spec.percent)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="t-study-note">The screener&apos;s figures for every member, struck the same way: trailing operating income and free cash flow, enterprise value on today&apos;s price; forward P/E on the next four quarters&apos; consensus. A loss leaves a multiple out rather than making it look cheap.</p>
    </div>
  );
}

/** A bar from expensive (left) to cheap (right), the share it is cheaper than. */
function Rank({ share, label }: { share: number; label: string }) {
  return (
    <span className="peer-rank" title={label}>
      <span className="peer-rank-track"><i style={{ width: `${Math.round(share * 100)}%` }} data-cheap={share >= 0.66 || undefined} data-dear={share <= 0.33 || undefined} /></span>
      <span>{label.split(" · ")[0]}</span>
    </span>
  );
}
