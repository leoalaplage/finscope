"use client";

import { useMemo, useState } from "react";
import { balanceSheetHealth, type BalanceSheetHealth } from "@/lib/statement-flows";
import { valueOf } from "@/lib/finance";
import type { CompanyDataset, FinancialPeriod, MetricKey } from "@/lib/types";

const LINES: Array<{ metric: MetricKey; label: string; indent?: boolean }> = [
  { metric: "cashAndEquivalents", label: "Cash and equivalents", indent: true },
  { metric: "shortTermInvestments", label: "Short-term investments", indent: true },
  { metric: "accountsReceivable", label: "Accounts receivable", indent: true },
  { metric: "inventory", label: "Inventory", indent: true },
  { metric: "currentAssets", label: "Total current assets" },
  { metric: "propertyPlantAndEquipment", label: "Property, plant and equipment", indent: true },
  { metric: "longTermInvestments", label: "Long-term investments", indent: true },
  { metric: "goodwill", label: "Goodwill", indent: true },
  { metric: "intangibleAssets", label: "Acquired intangibles", indent: true },
  { metric: "totalAssets", label: "Total assets" },
  { metric: "accountsPayable", label: "Accounts payable", indent: true },
  { metric: "currentLiabilities", label: "Total current liabilities" },
  { metric: "totalDebt", label: "Total debt", indent: true },
  { metric: "totalLiabilities", label: "Total liabilities" },
  { metric: "retainedEarnings", label: "Retained earnings", indent: true },
  { metric: "totalEquity", label: "Total equity" },
];

const money = (value: number | null, currency: string) => value == null || !Number.isFinite(value)
  ? "—"
  : `${value < 0 ? "-" : ""}${currency === "USD" ? "$" : `${currency} `}${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Math.abs(value))}`;

function healthDisplay(item: BalanceSheetHealth) {
  if (item.value == null || !Number.isFinite(item.value)) return "—";
  if (item.format === "percent") return `${(item.value * 100).toFixed(1)}%`;
  if (item.format === "years") return `${item.value.toFixed(1)}×`;
  return item.value.toFixed(2);
}

/**
 * The balance sheet, as filed, plus the handful of ratios that decide whether a
 * good business is also a safe one.
 *
 * Ordered the way the statement itself is ordered rather than by importance,
 * because a reader checking a figure against the filing should find it in the
 * same place. Years run across so a line can be read as a trend, which is the
 * only way to see a balance sheet deteriorating.
 */
export function BalanceSheetPanel({ dataset }: { dataset: CompanyDataset }) {
  const annual = useMemo(
    () => dataset.periods.filter((period) => period.periodicity === "annual").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)),
    [dataset],
  );
  const [years, setYears] = useState(5);
  const shown = annual.slice(-years);
  const latest = shown.at(-1);

  if (!latest) return <p className="simple-state">No reported annual balance sheet for this company.</p>;
  const health = balanceSheetHealth(latest);
  const reported = (period: FinancialPeriod, metric: MetricKey) => valueOf(period, metric);
  const anyValue = (metric: MetricKey) => shown.some((period) => reported(period, metric) != null);

  return <div className="balance-sheet">
    <div className="balance-health">
      {health.map((item) => <div key={item.key} title={item.hint}>
        <span>{item.label}</span>
        <strong>{healthDisplay(item)}</strong>
        <small>{item.value == null ? item.reason ?? "Not reported" : item.hint}</small>
      </div>)}
    </div>

    <div className="section-heading">
      <h3>As filed</h3>
      <div className="period-buttons">
        {[3, 5, 10].map((value) => <button key={value} className={years === value ? "active" : ""} onClick={() => setYears(value)}>{value}Y</button>)}
      </div>
    </div>

    <div className="table-scroll"><table className="financial-table">
      <thead><tr><th>Line</th>{shown.map((period) => <th key={period.periodEnd}>{period.fiscalYear}</th>)}</tr></thead>
      <tbody>
        {LINES.filter((line) => anyValue(line.metric)).map((line) => <tr key={line.metric} className={line.indent ? "" : "balance-total"}>
          <th className={line.indent ? "indented" : undefined}>{line.label}</th>
          {shown.map((period) => <td key={period.periodEnd}>{money(reported(period, line.metric), dataset.company.currency)}</td>)}
        </tr>)}
      </tbody>
    </table></div>
    <p className="section-note">
      Balance-sheet facts are point-in-time values at each fiscal year end, never summed. A line the filer does not tag is absent rather than shown as zero.
    </p>
  </div>;
}
