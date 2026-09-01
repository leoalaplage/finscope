"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartPalette, niceTicks, type ThemeName } from "@/lib/charting";
import { cagrForPeriods, derivedValue } from "@/lib/finance";
import { isFinancialBusiness } from "@/lib/business-type";
import { currentDatasetPeriod } from "@/lib/current-period";
import { marketBasis } from "@/lib/market-basis";
import { valuationSnapshot } from "@/lib/valuation-history";
import type { CompanyDataset, FinancialPeriod, PricePoint } from "@/lib/types";

type Frequency = "annual" | "ttm";

const money = (value: number | null | undefined, code: string) => value == null || !Number.isFinite(value)
  ? "—"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(value);
const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(2)}%`;

function ordered(dataset: CompanyDataset, periodicity: Frequency) {
  return dataset.periods.filter((period) => period.periodicity === periodicity).sort((left, right) => left.periodEnd.localeCompare(right.periodEnd));
}

function recent(periods: FinancialPeriod[], years = 5) {
  const end = periods.at(-1)?.periodEnd;
  if (!end) return periods;
  const cutoff = `${Number(end.slice(0, 4)) - years}${end.slice(4)}`;
  return periods.filter((period) => period.periodEnd >= cutoff);
}

/** Current cash-generation valuation, followed by its filed history per share. */
export function ValuationFundamentals({ dataset, price, theme, onCharts }: {
  dataset: CompanyDataset;
  price: PricePoint | null;
  theme: ThemeName;
  onCharts: () => void;
}) {
  const annual = useMemo(() => ordered(dataset, "annual"), [dataset]);
  const ttm = useMemo(() => ordered(dataset, "ttm"), [dataset]);
  const ttmAvailable = ttm.some((period) => derivedValue(period, "freeCashFlowPerShare") != null);
  const annualAvailable = annual.some((period) => derivedValue(period, "freeCashFlowPerShare") != null);
  const [frequency, setFrequency] = useState<Frequency>(() => ttmAvailable ? "ttm" : "annual");
  const selected = frequency === "ttm" && ttmAvailable ? ttm : annual;
  const rows = recent(selected).map((period) => ({
    date: period.periodEnd,
    label: period.label,
    value: derivedValue(period, "freeCashFlowPerShare"),
  }));
  const values = rows.flatMap((row) => row.value == null ? [] : [row.value]);
  const ticks = values.length ? niceTicks(Math.min(0, ...values), Math.max(...values), 5) : [];
  const palette = chartPalette(theme);

  const current = currentDatasetPeriod(dataset);
  const financial = isFinancialBusiness(dataset.company.businessType);
  const snapshot = !financial && current && price ? valuationSnapshot(current, price) : null;
  const fcfPerShare = financial || !current ? null : derivedValue(current, "freeCashFlowPerShare");
  const basisReason = current && price ? marketBasis(current, price).reason : price ? "No reported period to price" : "No matched market price";
  const fcfYield = snapshot?.metrics.freeCashFlowYield ?? null;
  const fiveYearGrowth = cagrForPeriods(annual, "freeCashFlowPerShare", 5);
  const unavailable = financial ? "Not meaningful for a financial institution" : undefined;

  return <>
    <div className="valuation-grid valuation-snapshot">
      <article className="valuation-card">
        <span>FCF yield</span>
        <strong>{percent(fcfYield)}</strong>
        <small>{fcfYield == null ? unavailable ?? basisReason ?? "Free cash flow is not positive" : `${current!.label} · at ${money(snapshot!.price, price!.currency)}`}</small>
      </article>
      <article className="valuation-card">
        <span>FCF / share</span>
        <strong>{money(fcfPerShare, dataset.company.currency)}</strong>
        <small>{fcfPerShare == null ? unavailable ?? "No compatible free-cash-flow and diluted-share facts" : `${current!.label} · 5Y CAGR ${percent(fiveYearGrowth.value)}`}</small>
      </article>
    </div>

    <figure className="valuation-fcf-chart">
      <figcaption>
        <div><span className="panel-kicker">FILED CASH GENERATION</span><h3>Free cash flow per share</h3></div>
        <div className="valuation-chart-actions">
          <div className="segmented" role="group" aria-label="FCF per share frequency">
            <button className={frequency === "annual" || !ttmAvailable ? "active" : ""} aria-pressed={frequency === "annual" || !ttmAvailable} disabled={!annualAvailable} onClick={() => setFrequency("annual")}>Annual</button>
            <button className={frequency === "ttm" && ttmAvailable ? "active" : ""} aria-pressed={frequency === "ttm" && ttmAvailable} disabled={!ttmAvailable} onClick={() => setFrequency("ttm")}>TTM</button>
          </div>
          <button onClick={onCharts}>Open in Charts</button>
        </div>
      </figcaption>
      {values.length ? <div className="valuation-fcf-canvas"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 16, right: 18, bottom: 2, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)"/>
          <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={(date) => String(date).slice(0, 4)}/>
          <YAxis width={72} tickLine={false} axisLine={false}
            domain={ticks.length >= 2 ? [ticks[0], ticks.at(-1)!] : ["auto", "auto"]}
            ticks={ticks.length >= 2 ? ticks : undefined}
            tickFormatter={(value) => money(Number(value), dataset.company.currency)}/>
          <Tooltip content={({ active, payload }) => {
            const point = active && payload?.length ? payload[0].payload as typeof rows[number] : null;
            return point ? <div className="chart-tooltip"><b>{point.label} · {point.date}</b><span><i style={{ background: palette[0].value }}/><span>FCF / share</span><strong>{money(point.value, dataset.company.currency)}</strong></span></div> : null;
          }}/>
          <Line type="monotone" dataKey="value" connectNulls={false} stroke={palette[0].value} strokeWidth={2.25} dot={{ r: frequency === "annual" ? 3 : 1.5, fill: palette[0].value }} activeDot={{ r: 4 }} isAnimationActive={false}/>
        </LineChart>
      </ResponsiveContainer></div> : <p className="simple-state">No free cash flow per share is available for this frequency.</p>}
    </figure>
  </>;
}
