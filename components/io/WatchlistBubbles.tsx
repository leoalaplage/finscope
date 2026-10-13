"use client";

import { useState } from "react";
import type { PerformanceRow } from "@/app/api/performance/route";
import { WINDOWS, type WindowId } from "@/lib/performance";
import { bubbleLayout, sectorColor } from "@/lib/watchlist-bubbles";
import { delta, shortDate } from "./format";

const cap = (value: number | null | undefined) => value != null && value > 0
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value)
  : "Unavailable";

export function WatchlistBubbles({ rows, loading }: { rows: PerformanceRow[]; loading: boolean }) {
  const [window, setWindow] = useState<WindowId>("d1");
  const [sector, setSector] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  // An edited watchlist must not stay hidden behind an obsolete sector filter.
  const selected = rows.some((row) => (row.sector || "Unclassified") === sector) ? sector : null;
  const layout = bubbleLayout(rows, window, selected);
  const point = layout.points.find((item) => item.ticker === active);
  const period = WINDOWS.find((item) => item.id === window)!;
  const y = (value: number) => 32 + (layout.max - value) / (layout.max - layout.min) * 350;

  return <div className="watch-bubbles">
    <div className="watch-bubbles-toolbar">
      <span className="label">Sector view · {period.label}</span>
      <div className="watch-bubbles-periods" aria-label="Bubble chart period">
        {WINDOWS.map((item) => <button key={item.id} type="button" aria-pressed={window === item.id} onClick={() => setWindow(item.id)}>{item.label}</button>)}
      </div>
    </div>
    <div className="watch-bubbles-readout" aria-live="polite">
      {point ? <><strong>{point.ticker}</strong><span>{point.name}</span><span>{point.sector}</span><strong>{delta(point.value / 100, 2)}</strong><span>Market cap {cap(point.marketCap)}</span><span>{point.asOf ? shortDate(point.asOf) : ""}</span></>
        : <span>Hover or focus a bubble for details · Click to open the stock · Select a sector below to expand it</span>}
    </div>
    {layout.points.length ? <div className="watch-bubbles-scroll">
      <svg className="watch-bubbles-plot" viewBox="0 0 1200 430" role="group" aria-label={`Watchlist sector bubbles, ${period.label} change, area represents market capitalization`}>
        <text x="12" y="16" className="watch-bubbles-axis">Change % {period.annualised ? "p.a." : ""}</text>
        {Array.from({ length: 6 }, (_, index) => {
          const value = layout.min + (layout.max - layout.min) * index / 5;
          return <g key={index}><line x1="65" x2="1155" y1={y(value)} y2={y(value)} className="watch-bubbles-grid" /><text x="54" y={y(value) + 4} textAnchor="end" className="watch-bubbles-axis">{value.toFixed(1)}%</text></g>;
        })}
        <line x1="65" x2="1155" y1={y(0)} y2={y(0)} className="watch-bubbles-zero" />
        {layout.groups.map((name, index) => <g key={name}>
          <line x1={65 + index / layout.groups.length * 1090} x2={65 + index / layout.groups.length * 1090} y1="32" y2="382" className="watch-bubbles-grid" />
          <rect x={65 + index / layout.groups.length * 1090} y="402" width={1090 / layout.groups.length - 2} height="4" fill={sectorColor(name)} />
        </g>)}
        {[...layout.points].sort((a, b) => b.r - a.r).map((item) => <a key={item.ticker} href={`/t/s/${encodeURIComponent(item.ticker)}`} aria-label={`${item.ticker}, ${item.sector}, ${delta(item.value / 100, 2)}, market cap ${cap(item.marketCap)}`} onMouseEnter={() => setActive(item.ticker)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(item.ticker)} onBlur={() => setActive(null)}>
          <title>{`${item.ticker} · ${item.name ?? item.ticker}\n${item.sector} · ${delta(item.value / 100, 2)}\nMarket cap ${cap(item.marketCap)}`}</title>
          <circle cx={item.x} cy={item.y} r={Math.max(item.r, 10)} fill="transparent" />
          <circle className="watch-bubble" cx={item.x} cy={item.y} r={item.r} fill={item.marketCap != null && item.marketCap > 0 ? sectorColor(item.sector) : "none"} stroke={sectorColor(item.sector)} fillOpacity={active === item.ticker ? .95 : .68} strokeWidth={active === item.ticker ? 3 : 1.5} />
          <text x={item.x} y={item.r >= 18 ? item.y + 4 : item.y + item.r + 14} textAnchor="middle" className="watch-bubble-label">{item.ticker}</text>
        </a>)}
      </svg>
    </div> : <p className="stat-note">{loading ? "Loading watchlist performance…" : "No performance available for this period."}</p>}
    <div className="watch-bubbles-legend" aria-label="Filter bubbles by sector">
      <button type="button" aria-pressed={!selected} onClick={() => setSector(null)}>All sectors</button>
      {layout.sectors.map((name) => <button key={name} type="button" aria-pressed={selected === name} onClick={() => setSector(selected === name ? null : name)}><span style={{ background: sectorColor(name) }} />{name}</button>)}
    </div>
    <p className="stat-note">Bubble area: market cap in USD, using price × latest available reported shares. Hollow markers: market cap unavailable. Horizontal position groups companies by sector. {layout.missing > 0 ? `${layout.missing} without a return for this period. ` : ""}{loading ? "More companies are loading…" : ""}</p>
  </div>;
}
