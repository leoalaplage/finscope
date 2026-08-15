"use client";

import { useMemo, useRef } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartValue, unitFamily } from "@/lib/auto-chart";
import { chartPalette, niceTicks } from "@/lib/charting";
import { chartSurface, exportSvgToPng } from "@/lib/chart-export";
import { summariseSeries } from "@/lib/chart-summary";
import { derivedValue } from "@/lib/finance";
import { CHARTABLE_METRICS } from "@/lib/metrics";
import type { CompanyDataset, FinancialPeriod, SeriesFrequency } from "@/lib/types";

/**
 * One card per measure, in the order an analyst reads a company: what it sold,
 * what it kept, what it turned into cash, what that earned on capital, and what
 * any of it came to per share. `pair` puts two series on one card where they
 * only mean something together — cash against debt is a position, not two facts.
 */
const CARDS: Array<{ metric: string; title: string; pair?: string; pairTitle?: string }> = [
  { metric: "revenue", title: "Revenue" },
  { metric: "grossProfit", title: "Gross profit" },
  { metric: "operatingIncome", title: "Operating income" },
  { metric: "netIncome", title: "Net income" },
  { metric: "freeCashFlow", title: "Free cash flow" },
  { metric: "freeCashFlowAfterSbc", title: "Free cash flow after SBC" },
  { metric: "netIncomePerShare", title: "EPS" },
  { metric: "freeCashFlowPerShare", title: "FCF per share" },
  { metric: "cashReturnOnCapital", title: "Cash RoC" },
  { metric: "operatingMargin", title: "Operating margin" },
  { metric: "freeCashFlowMargin", title: "FCF margin" },
  { metric: "dilutedShares", title: "Diluted shares" },
  { metric: "cashAndEquivalents", title: "Cash & debt", pair: "totalDebt", pairTitle: "Total debt" },
];

const QUARTERS = 16;

/** "Q3 2022", from the fiscal quarter the period actually closes. */
function quarterLabel(period: FinancialPeriod) {
  return period.fiscalQuarter ? `${period.fiscalQuarter} ${period.fiscalYear}` : String(period.fiscalYear);
}

interface CardRow { label: string; date: string; value: number | null; pair: number | null }

function KpiCard({ card, rows, index, dataset, onOpen }: {
  card: typeof CARDS[number];
  rows: CardRow[];
  index: number;
  dataset: CompanyDataset;
  onOpen?: () => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const palette = chartPalette();
  const family = unitFamily(card.metric);
  const values = rows.flatMap((row) => [row.value, row.pair].filter((value): value is number => value != null && Number.isFinite(value)));
  const colour = palette[index % palette.length].value;
  const pairColour = palette[(index + 4) % palette.length].value;
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
  const latest = [...rows].reverse().find((row) => row.value != null);
  const format = (value: number) => formatChartValue(value, family, dataset.company.currency);
  // The badge summarises the drawn points, so it can never quote a window the
  // reader is not looking at.
  const summary = summariseSeries(rows.map((row) => ({ date: row.date, value: row.value })), card.metric);
  const chartable = CHARTABLE_METRICS.has(card.metric);

  function savePng(event: React.MouseEvent) {
    event.stopPropagation();
    const svg = chartSurface(canvas.current);
    if (!svg) return;
    exportSvgToPng(svg, `${dataset.company.ticker}-${card.metric}.png`, {
      title: `${dataset.company.ticker} · ${card.title}`,
      subtitle: summary.value == null ? dataset.company.name : `${dataset.company.name} · ${summary.label} ${summary.display}`,
      footer: `AapWire · SEC filings to ${rows.at(-1)?.label ?? ""}`,
    });
  }

  return <article className="kpi-card">
    <header>
      <div><h3>{card.title}</h3><small>{summary.label || (rows[0] ? "Trailing" : "")}</small></div>
      <div className="kpi-card-actions">
        <strong>{latest?.value == null ? "—" : format(latest.value)}</strong>
        {summary.value != null && <span className={`kpi-badge${summary.value >= 0 ? "" : " down"}`} title={summary.label}>{summary.display}</span>}
      </div>
    </header>
    <div className="kpi-canvas" ref={canvas}><ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)"/>
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} angle={-45} textAnchor="end" height={46}/>
        <YAxis width={58} tickLine={false} axisLine={false} domain={ticks.length >= 2 ? [ticks[0], ticks.at(-1)!] : ["auto", "auto"]} ticks={ticks.length >= 2 ? ticks : undefined} tickFormatter={(value) => format(Number(value))}/>
        <Tooltip cursor={{ fill: "var(--grid)" }} content={({ active, payload, label }) => {
          const row = active && payload?.length ? payload[0].payload as CardRow : null;
          return row ? <div className="chart-tooltip"><b>{label}</b>
            <span><i style={{ background: colour }}/><span>{card.title}</span><strong>{row.value == null ? "—" : format(row.value)}</strong></span>
            {card.pair && <span><i style={{ background: pairColour }}/><span>{card.pairTitle}</span><strong>{row.pair == null ? "—" : format(row.pair)}</strong></span>}
          </div> : null;
        }}/>
        <Bar dataKey="value" fill={colour} radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {/* A negative bar is not the same event as a positive one, so it is not the same colour. */}
          {rows.map((row) => <Cell key={row.label} fill={row.value != null && row.value < 0 ? "var(--danger)" : colour}/>)}
        </Bar>
        {card.pair && <Bar dataKey="pair" fill={pairColour} radius={[3, 3, 0, 0]} isAnimationActive={false}/>}
      </BarChart>
    </ResponsiveContainer></div>
    <footer className="kpi-card-footer">
      <button type="button" onClick={savePng} title="Save this chart as a PNG">PNG</button>
      {chartable && onOpen && <button type="button" onClick={onOpen} title="Open in Charts">Open ↗</button>}
    </footer>
  </article>;
}

export function CompanyKpiGrid({ dataset, onOpenMetric }: { dataset: CompanyDataset; onOpenMetric: (metric: string, presentation: { style: "bar"; frequency: SeriesFrequency }) => void }) {
  // Trailing windows, so a card shows a full year of trading at every point
  // rather than a saw-tooth of seasons. Annual is the fallback for a company
  // that has not filed four comparable quarters.
  const periods = useMemo(() => {
    const ttm = dataset.periods.filter((period) => period.periodicity === "ttm").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const source = ttm.length >= 4 ? ttm : dataset.periods.filter((period) => period.periodicity === "annual").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    return source.slice(-QUARTERS);
  }, [dataset]);

  if (!periods.length) return <p className="simple-state">No reported periods to chart yet.</p>;
  const frequency: SeriesFrequency = periods[0]?.periodicity === "ttm" ? "ttm" : "annual";

  return <div className="kpi-grid">{CARDS.map((card, index) => {
    const rows: CardRow[] = periods.map((period) => ({
      label: quarterLabel(period),
      date: period.periodEnd,
      value: derivedValue(period, card.metric),
      pair: card.pair ? derivedValue(period, card.pair) : null,
    }));
    if (!rows.some((row) => row.value != null || row.pair != null)) return null;
    return <KpiCard key={card.metric} card={card} rows={rows} index={index} dataset={dataset}
      onOpen={() => onOpenMetric(card.metric, { style: "bar", frequency })}/>;
  })}</div>;
}
