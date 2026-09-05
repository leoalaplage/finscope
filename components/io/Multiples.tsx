"use client";

import { useMemo, useState } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import { Bars, Line } from "./Plot";
import { fundamentalWindow, shapeFor, withinYears, type Frequency, type Range } from "./ranges";
import { ABSENT, datedCagrOf, delta, formatUnit, yearOf, type Unit } from "./format";

/** Business importance first; every remaining available metric follows. */
const PRIORITY = [
  "revenue", "operatingIncome", "netIncome", "freeCashFlow",
  "operatingCashFlow", "freeCashFlowPerShare", "operatingMargin", "dilutedShares",
  "grossProfit", "ebitda", "grossMargin", "netMargin", "freeCashFlowMargin",
  "revenuePerShare", "netIncomePerShare", "capitalExpenditures", "stockBasedCompensation",
  "shareRepurchases", "cashAndEquivalents", "totalDebt", "netDebt", "totalEquity",
] as const;

const COLLAPSED_COUNT = 8;

export function Multiples({
  view,
  selected,
  onSelect,
  range,
  frequency,
}: {
  view: IoCompanyView;
  selected: string[];
  onSelect: (metric: string | null) => void;
  range: Range;
  frequency: Frequency;
}) {
  const [expanded, setExpanded] = useState(false);
  const metrics = useMemo(() => new Map(view.metrics.map((metric) => [metric.key, metric])), [view.metrics]);
  // The same window the chart above is on, from the same table. A page showing
  // twenty years of price over five years of figures was answering one question
  // twice, differently.
  const periods = useMemo(
    () => withinYears(frequency === "annual" ? view.annual : view.trailing, fundamentalWindow(range).years),
    [view.annual, view.trailing, frequency, range],
  );
  const order = useMemo(() => {
    const priority = new Map<string, number>(PRIORITY.map((key, index) => [key, index]));
    return [...view.metrics].sort((left, right) =>
      (priority.get(left.key) ?? PRIORITY.length + view.metrics.indexOf(left))
      - (priority.get(right.key) ?? PRIORITY.length + view.metrics.indexOf(right)));
  }, [view.metrics]);

  const panels = order.map((metric) => {
    const values = periods.map((period) => period.values[metric.key] ?? null);
    if (!values.some((value) => value != null)) return null;
    return { key: metric.key, metric: metrics.get(metric.key) ?? metric, values };
  }).filter((panel): panel is NonNullable<typeof panel> => panel != null);

  if (!panels.length || !periods.length) return null;

  const visible = expanded ? panels : panels.slice(0, COLLAPSED_COUNT);
  const currency = periods.at(-1)?.currency ?? view.company.currency;
  const first = periods[0];
  const last = periods.at(-1)!;

  return (
    <section className="section" id="history">
      <div className="section-head metrics-head">
        <div>
          <h2 className="label">{frequency === "annual" ? "Annual figures" : "TTM figures"}</h2>
          <span className="label">{yearOf(first.end)}–{yearOf(last.end)}</span>
        </div>
        {panels.length > COLLAPSED_COUNT ? (
          <button className="metric-toggle" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
            {expanded ? "Show first 8" : `Show all ${panels.length}`}
          </button>
        ) : null}
      </div>

      <div className="grid-ruled multiples">
        {visible.map(({ key, metric, values }) => {
          const latest = [...values].reverse().find((value) => value != null) ?? null;
          const known = values.map((value, index) => ({ date: periods[index].end, value })).filter((point) => point.value != null);
          const growth = metric.unit === "percent"
            ? known.length > 1 ? (known.at(-1)!.value as number) - (known[0].value as number) : null
            : datedCagrOf(known);
          const isSelected = selected.includes(key);
          const shape = shapeFor(metric.unit);
          return (
            <button
              className="multiple"
              key={key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : key)}
            >
              <span className="multiple-top">
                <span className="label">{metric.short}</span>
                <span className="multiple-cagr">
                  {growth == null ? ABSENT : metric.unit === "percent" ? `${delta(growth, 1)} change` : `${delta(growth, 1)} CAGR`}
                </span>
              </span>
              <span className="multiple-value" data-empty={latest == null}>
                {latest == null ? ABSENT : formatUnit(latest, metric.unit as Unit, currency)}
              </span>
              <span className="plot">{shape === "area" ? <Line values={values} area /> : <Bars values={values} />}</span>
              <span className="multiple-span">
                <span className="label">{yearOf(first.end)}</span>
                <span className="label">{yearOf(last.end)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
