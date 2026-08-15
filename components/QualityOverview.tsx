"use client";

import { useMemo } from "react";
import { cagrForPeriods, derivedValue, valueOf } from "@/lib/finance";
import type { CompanyDataset, FinancialPeriod } from "@/lib/types";

export interface QualityRow {
  label: string;
  value: number | null;
  format: "percent" | "currency" | "perShare" | "points" | "ratio";
  /** Higher is better (1), lower is better (-1), neither (0). */
  polarity: 1 | -1 | 0;
  note: string;
  reason?: string;
}

const money = (value: number, currency: string) =>
  `${value < 0 ? "-" : ""}${currency === "USD" ? "$" : `${currency} `}${new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 10_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(Math.abs(value))}`;

export function formatQuality(row: QualityRow, currency: string): string {
  if (row.value == null || !Number.isFinite(row.value)) return "—";
  switch (row.format) {
    case "percent": return `${(row.value * 100).toFixed(1)}%`;
    case "points": return `${row.value >= 0 ? "+" : ""}${(row.value * 100).toFixed(1)} pp`;
    case "ratio": return `${row.value.toFixed(2)}×`;
    case "perShare": return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(row.value);
    case "currency": return money(row.value, currency);
  }
}

const ordered = (dataset: CompanyDataset, periodicity: string) =>
  dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

/**
 * The ten figures that decide whether a business is worth more of your time.
 *
 * Deliberately not a dashboard: one table, ten rows, each one a question a
 * quality investor asks first. Anything that needs a picture is a click away in
 * Charts rather than a plot competing for space here.
 */
export function qualityOverview(dataset: CompanyDataset, valuationVsAverage: number | null): QualityRow[] {
  const annual = ordered(dataset, "annual");
  const current: FinancialPeriod | undefined = ordered(dataset, "ttm").at(-1) ?? annual.at(-1);
  const flow = (metric: string) => current ? derivedValue(current, metric) : null;
  const cagr = (metric: string, years: 5 | 10) => cagrForPeriods(annual, metric, years);

  const shares = annual.at(-1) ? valueOf(annual.at(-1)!, "dilutedShares") : null;
  const sharesFiveYearsAgo = annual.at(-6) ? valueOf(annual.at(-6)!, "dilutedShares") : null;
  const dilution = shares != null && sharesFiveYearsAgo != null && sharesFiveYearsAgo > 0
    ? (shares / sharesFiveYearsAgo) ** (1 / 5) - 1
    : null;

  const revenueShare = cagr("revenuePerShare", 5);
  const fcfShare = cagr("freeCashFlowPerShare", 5);

  return [
    { label: "Revenue / share CAGR 5Y", value: revenueShare.value, format: "percent", polarity: 1,
      note: "Compound growth in sales per share, so growth bought with new shares does not count.", reason: revenueShare.reason },
    { label: "FCF / share", value: flow("freeCashFlowPerShare"), format: "perShare", polarity: 1,
      note: "Trailing free cash flow divided by the diluted share count." },
    { label: "FCF / share CAGR 5Y", value: fcfShare.value, format: "percent", polarity: 1,
      note: "What an owner's share of the cash actually did.", reason: fcfShare.reason },
    { label: "FCF margin", value: flow("freeCashFlowMargin"), format: "percent", polarity: 1,
      note: "How much of each pound of sales survives as cash." },
    { label: "Operating margin", value: flow("operatingMargin"), format: "percent", polarity: 1,
      note: "Operating income over revenue." },
    { label: "ROIC", value: flow("roic"), format: "percent", polarity: 1,
      note: "Operating profit after tax over debt plus equity less cash." },
    { label: "Cash conversion", value: flow("cashConversion"), format: "percent", polarity: 1,
      note: "Free cash flow over net income. Below 100% means the profit is not arriving as cash." },
    { label: "Dilution 5Y", value: dilution, format: "percent", polarity: -1,
      note: "Annualised change in the diluted share count. Negative is buybacks.",
      reason: dilution == null ? "Needs six reported years of share counts" : undefined },
    { label: "SBC / revenue", value: flow("stockBasedCompensationToRevenue"), format: "percent", polarity: -1,
      note: "What share-based pay costs, as a share of sales." },
    { label: "Valuation vs 5Y average", value: valuationVsAverage, format: "percent", polarity: -1,
      note: "Current price to free cash flow against its own five-year average. Positive is dearer than usual.",
      reason: valuationVsAverage == null ? "Needs matched prices across five years" : undefined },
  ];
}

export function QualityOverview({ dataset, valuationVsAverage }: { dataset: CompanyDataset; valuationVsAverage: number | null }) {
  const rows = useMemo(() => qualityOverview(dataset, valuationVsAverage), [dataset, valuationVsAverage]);
  const currency = dataset.company.currency;

  return <div className="table-scroll"><table className="financial-table quality-overview">
    <thead><tr><th scope="col">Measure</th><th scope="col">Value</th><th scope="col">What it says</th></tr></thead>
    <tbody>
      {rows.map((row) => <tr key={row.label}>
        <th scope="row">{row.label}</th>
        <td className={row.value == null || row.polarity === 0 ? undefined : row.value * row.polarity >= 0 ? "positive-text" : "negative-text"}>
          {formatQuality(row, currency)}
        </td>
        <td className="quality-note">{row.value == null ? row.reason ?? "Not reported." : row.note}</td>
      </tr>)}
    </tbody>
  </table></div>;
}
