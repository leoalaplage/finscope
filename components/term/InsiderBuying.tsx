"use client";

import { useEffect, useState } from "react";
import type { InsiderCluster, InsiderPurchase } from "@/lib/insider-buying";
import { ABSENT, money, price as writePrice, shortDate } from "@/components/io/format";
import { Panel } from "./Panel";

interface Answer { updatedAt: string | null; days: string[]; pending: number; purchases: InsiderPurchase[]; clusters: InsiderCluster[] }
const RANGES = [{ days: 30, label: "30 days" }, { days: 60, label: "60 days" }, { days: 120, label: "120 days" }];

/**
 * INSB: officers and directors of US-listed companies buying their own
 * shares in the open market, and the clusters of them — two or more buying
 * the same stock within a fortnight (lib/insider-buying.ts).
 */
export function InsiderBuying() {
  const [answer, setAnswer] = useState<Answer | null | undefined>(undefined);
  const [range, setRange] = useState(60);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/insider-buying", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<Answer> : null))
      .then((body) => { if (!controller.signal.aborted) setAnswer(body); })
      .catch(() => { if (!controller.signal.aborted) setAnswer(null); });
    return () => controller.abort();
  }, []);

  // Measured from the record's own date, so the window does not move while the page is open.
  const updatedAt = answer?.updatedAt ?? null;
  const reference = updatedAt ? Date.parse(updatedAt) : NaN;
  const since = Number.isFinite(reference) ? new Date(reference - range * 86_400_000).toISOString().slice(0, 10) : "";
  const purchases = (answer?.purchases ?? []).filter((purchase) => purchase.date >= since && (wide || purchase.index));
  const clusters = (answer?.clusters ?? []).filter((cluster) => cluster.to >= since && (wide || cluster.purchases.some((purchase) => purchase.index)));
  const total = purchases.reduce((sum, purchase) => sum + (purchase.value ?? 0), 0);
  const covered = answer?.days.length ? `${shortDate(answer.days[0])} to ${shortDate(answer.days.at(-1))}` : null;

  return (
    <div className="t-grid t-insb">
      <Panel code="INSB" title={`Insider buying · ${wide ? "All US" : "S&P 500"}`} actions={
        <>
          <div className="seg" role="group" aria-label="Companies">
            <button type="button" aria-pressed={!wide} onClick={() => setWide(false)}>S&amp;P 500</button>
            <button type="button" aria-pressed={wide} onClick={() => setWide(true)}>All US</button>
          </div>
          <div className="seg" role="group" aria-label="Window">
            {RANGES.map((entry) => <button key={entry.days} type="button" aria-pressed={range === entry.days} onClick={() => setRange(entry.days)}>{entry.label}</button>)}
          </div>
        </>
      }>
        {answer === undefined ? <p className="t-empty">Reading the Form 4s…</p> : answer === null ? <p className="t-empty">Insider filings are temporarily unavailable.</p> : (
          <div className="t-panel-pad t-insb-body">
            <div className="grid-ruled stats dvd-strip">
              <Stat label="Clusters" value={String(clusters.length)} note="Two or more insiders, one stock, a fortnight" />
              <Stat label="Strong clusters" value={String(clusters.filter((cluster) => cluster.buyers >= 3).length)} note="Three or more insiders" />
              <Stat label="Purchases" value={String(purchases.length)} note={`${new Set(purchases.map((purchase) => purchase.ticker)).size} companies`} />
              <Stat label="Bought" value={money(total, "USD")} note="Open-market purchases, code P" />
            </div>
            <h3 className="t-insb-head">Clusters</h3>
            {clusters.length ? (
              <div className="sheet">
                <table>
                  <thead><tr><th className="key">Stock</th><th>Insiders</th><th>From</th><th>To</th><th>Bought</th><th>Who</th></tr></thead>
                  <tbody>
                    {clusters.map((cluster) => (
                      <tr key={cluster.ticker} data-strong={cluster.buyers >= 3 || undefined}>
                        <td className="key"><a href={`/t/s/${encodeURIComponent(cluster.ticker)}#ins`}>{cluster.ticker}</a></td>
                        <td><b>{cluster.buyers}</b></td>
                        <td>{shortDate(cluster.from)}</td>
                        <td>{shortDate(cluster.to)}</td>
                        <td>{money(cluster.value, "USD")}</td>
                        <td className="t-insb-who">{[...new Set(cluster.purchases.map((purchase) => `${purchase.owner}${purchase.role !== "Not stated" ? ` (${purchase.role.replace(/^Officer · /, "")})` : ""}`))].join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="t-dim">No two insiders of one company bought within a fortnight in this window.</p>}
            <h3 className="t-insb-head">Every purchase</h3>
            <div className="sheet">
              <table>
                <thead><tr><th className="key">Traded</th><th>Stock</th><th>Insider</th><th>Role</th><th>Shares</th><th>Price</th><th>Value</th><th aria-label="Filing" /></tr></thead>
                <tbody>
                  {purchases.slice(0, 200).map((purchase, index) => (
                    <tr key={`${purchase.url}-${index}`}>
                      <td className="key">{shortDate(purchase.date)}</td>
                      <td><a href={`/t/s/${encodeURIComponent(purchase.ticker)}#ins`}>{purchase.ticker}</a></td>
                      <td>{purchase.owner}</td>
                      <td className="t-dim">{purchase.role}</td>
                      <td>{purchase.shares == null ? ABSENT : Math.round(purchase.shares).toLocaleString("en-US")}</td>
                      <td>{writePrice(purchase.price, "USD")}</td>
                      <td>{money(purchase.value, "USD")}</td>
                      <td><a href={purchase.url} target="_blank" rel="noreferrer">SEC ↗</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="t-study-note">Open-market purchases (Form 4, code P) by the officers, directors and 10% owners of {wide ? "every company listed on the NYSE or Nasdaq" : "the S&P 500's companies"}, read from EDGAR&apos;s daily index{covered ? `, ${covered}` : ""}{wide ? " (beyond the S&P 500, the last two weeks of the backfill)" : ""}{answer.pending ? `; ${answer.pending} filings still to read` : ""}. Grants, option exercises and sales are left out.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <p className="stat-note">{note}</p> : null}
    </div>
  );
}

/** On a company's INS panel: its insiders' cluster of purchases, where there is one in the last two months. */
export function InsiderClusterBadge({ ticker }: { ticker: string }) {
  const [cluster, setCluster] = useState<{ ticker: string; cluster: InsiderCluster | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/insider-buying?ticker=${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<Answer> : null))
      .then((body) => {
        if (controller.signal.aborted) return;
        // Only a cluster of the last two months is news on the company's page.
        const recent = body?.updatedAt ? new Date(Date.parse(body.updatedAt) - 60 * 86_400_000).toISOString().slice(0, 10) : "";
        const found = body?.clusters[0] ?? null;
        setCluster({ ticker, cluster: found && found.to >= recent ? found : null });
      })
      .catch(() => { /* No badge is the honest answer to no record. */ });
    return () => controller.abort();
  }, [ticker]);
  const found = cluster?.ticker === ticker ? cluster.cluster : null;
  if (!found) return null;
  return (
    <a className="t-chip t-insb-badge" href="/t/insiders" title={`${found.buyers} insiders bought ${money(found.value, "USD")} between ${shortDate(found.from)} and ${shortDate(found.to)}`}>
      Cluster · {found.buyers} insiders bought
    </a>
  );
}
