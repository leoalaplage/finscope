"use client";

import { useMemo } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import { withinYears } from "./ranges";
import { ABSENT, datedCagrOf, delta, type Unit } from "./format";

/**
 * What compounded, and over how long.
 *
 * A single growth rate is an argument about a window: five years of revenue can
 * be a decade's trend or the back half of one cycle, and the two read
 * identically until you see them side by side. So every horizon is shown at
 * once, and a measure that behaved differently over one year than over ten says
 * so in the same row.
 *
 * Compounding is refused where a sign change makes it meaningless — a company
 * that went from a loss to a profit has no growth rate, it has a turnaround —
 * and a rate is stated as the points it moved rather than compounded, because
 * a margin that went from 20% to 30% did not grow at 8.4% a year.
 */

const HORIZONS: Array<{ id: string; years: number | null }> = [
  { id: "1Y", years: 1 },
  { id: "3Y", years: 3 },
  { id: "5Y", years: 5 },
  { id: "10Y", years: 10 },
  { id: "MAX", years: null },
];

const MEASURES = [
  "revenue", "grossProfit", "operatingIncome", "ebitda", "netIncome",
  "operatingCashFlow", "freeCashFlow", "freeCashFlowAfterSbc",
  "netIncomePerShare", "freeCashFlowPerShare", "freeCashFlowAfterSbcPerShare",
  "dividendsPerShare", "dilutedShares", "totalEquity",
  "grossMargin", "operatingMargin", "netMargin", "freeCashFlowMargin", "roic",
];

/** A compound annual rate, or the points a rate moved. Never both at once. */
export function growthOver(
  periods: Array<{ end: string; values: Record<string, number | null> }>,
  key: string,
  unit: Unit,
  years: number | null,
): number | null {
  const points = withinYears(periods, years).flatMap((period) => {
    const value = period.values[key];
    return value == null || !Number.isFinite(value) ? [] : [{ date: period.end, value }];
  });
  if (points.length < 2) return null;
  return unit === "percent" || unit === "ratio"
    ? points[points.length - 1].value - points[0].value
    : datedCagrOf(points);
}

export function Growth({ view }: { view: IoCompanyView }) {
  const metrics = useMemo(() => new Map(view.metrics.map((metric) => [metric.key, metric])), [view.metrics]);
  const rows = MEASURES.map((key) => metrics.get(key)).filter((metric): metric is NonNullable<typeof metric> => metric != null);

  if (!rows.length || view.annual.length < 2) return null;

  return (
    <section className="section" id="growth">
      <div className="section-head">
        <h2 className="label">Growth</h2>
        <span className="label">Annual · compound, or points moved for a rate</span>
      </div>
      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th className="key" scope="col">Per year</th>
              {HORIZONS.map((horizon) => <th key={horizon.id} scope="col">{horizon.id}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((metric) => (
              <tr key={metric.key}>
                <th className="key" scope="row">{metric.label}</th>
                {HORIZONS.map((horizon) => {
                  const rate = growthOver(view.annual, metric.key, metric.unit as Unit, horizon.years);
                  return (
                    <td key={horizon.id} data-empty={rate == null}>
                      {rate == null ? ABSENT : delta(rate, 1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
