"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartValue, unitFamily } from "@/lib/auto-chart";
import { chartPalette, niceTicks, type ThemeName } from "@/lib/charting";
import { derivedValue } from "@/lib/finance";
import { CHARTABLE_METRICS } from "@/lib/metrics";
import type { CompanyDataset, FinancialPeriod } from "@/lib/types";

/**
 * One card per measure, in the order an analyst reads a company: what it sold,
 * what it kept, what it turned into cash, and what any of that came to per
 * share. `pair` puts two series on one card where they only mean something
 * together — cash against debt is a position, not two facts.
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

export function CompanyKpiGrid({ dataset, theme, onOpenMetric }: { dataset: CompanyDataset; theme: ThemeName; onOpenMetric: (metric: string) => void }) {
  const palette = chartPalette(theme);
  // Trailing windows, so a card shows a full year of trading at every point
  // rather than a saw-tooth of seasons. Annual is the fallback for a company
  // that has not filed four comparable quarters.
  const periods = useMemo(() => {
    const ttm = dataset.periods.filter((period) => period.periodicity === "ttm").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const source = ttm.length >= 4 ? ttm : dataset.periods.filter((period) => period.periodicity === "annual").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    return source.slice(-QUARTERS);
  }, [dataset]);

  if (!periods.length) return <p className="simple-state">No reported periods to chart yet.</p>;

  return <div className="kpi-grid">{CARDS.map((card, index) => {
    const family = unitFamily(card.metric);
    const rows = periods.map((period) => ({
      label: quarterLabel(period),
      value: derivedValue(period, card.metric),
      pair: card.pair ? derivedValue(period, card.pair) : null,
    }));
    const values = rows.flatMap((row) => [row.value, row.pair].filter((value): value is number => value != null && Number.isFinite(value)));
    if (!values.length) return null;

    const colour = palette[index % palette.length].value;
    const pairColour = palette[(index + 4) % palette.length].value;
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
    const latest = [...rows].reverse().find((row) => row.value != null);
    const format = (value: number) => formatChartValue(value, family, dataset.company.currency);

    return <article className="kpi-card" key={card.metric}>
      <header>
        <div><h3>{card.title}</h3><small>{periods[0]?.periodicity === "ttm" ? "TTM" : "Annual"} · {dataset.company.currency}</small></div>
        <div className="kpi-card-actions">
          <strong>{latest?.value == null ? "—" : format(latest.value)}</strong>
          {CHARTABLE_METRICS.has(card.metric) && <button aria-label={`Open ${card.title} in Charts`} title={`Open ${card.title} in Charts`} onClick={() => onOpenMetric(card.metric)}>↗</button>}
        </div>
      </header>
      <div className="kpi-canvas"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)"/>
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} angle={-45} textAnchor="end" height={46}/>
          <YAxis width={58} tickLine={false} axisLine={false} domain={ticks.length >= 2 ? [ticks[0], ticks.at(-1)!] : ["auto", "auto"]} ticks={ticks.length >= 2 ? ticks : undefined} tickFormatter={(value) => format(Number(value))}/>
          <Tooltip cursor={{ fill: "var(--grid)" }} content={({ active, payload, label }) => {
            const row = active && payload?.length ? payload[0].payload as typeof rows[number] : null;
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
    </article>;
  })}</div>;
}
