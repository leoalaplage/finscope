"use client";

import { useMemo } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import { Bars } from "./Plot";
import { ABSENT, cagrOf, delta, formatUnit, yearOf, type Unit } from "./format";

/**
 * Eight charts, ten years each, and no axis on any of them.
 *
 * The question a small multiple answers is "which way, and how steadily" — and
 * a tick ladder answers neither. What is drawn is the shape; what is written is
 * the latest figure, the span it covers, and the rate it compounded at. A
 * reader who wants the number for 2021 reads it off the table below.
 */

const PANELS = [
  "revenue",
  "operatingIncome",
  "netIncome",
  "freeCashFlow",
  "netIncomePerShare",
  "freeCashFlowPerShare",
  "operatingMargin",
  "dilutedShares",
] as const;

const YEARS = 10;
const CAGR_YEARS = 5;

export function Multiples({ view }: { view: IoCompanyView }) {
  const metrics = useMemo(() => new Map(view.metrics.map((metric) => [metric.key, metric])), [view.metrics]);
  const periods = useMemo(() => view.annual.slice(-YEARS), [view.annual]);

  const panels = PANELS.map((key) => {
    const metric = metrics.get(key);
    if (!metric) return null;
    const values = periods.map((period) => period.values[key] ?? null);
    if (!values.some((value) => value != null)) return null;
    return { key, metric, values };
  }).filter((panel): panel is NonNullable<typeof panel> => panel != null);

  if (!panels.length || !periods.length) return null;

  const currency = periods[periods.length - 1]?.currency ?? view.company.currency;
  const first = periods[0];
  const last = periods[periods.length - 1];

  return (
    <section className="section" id="history">
      <div className="section-head">
        <h2 className="label">Annual history</h2>
        <span className="label">{yearOf(first.end)}–{yearOf(last.end)}</span>
      </div>

      <div className="grid-ruled multiples">
        {panels.map(({ key, metric, values }) => {
          const latest = [...values].reverse().find((value) => value != null) ?? null;
          /*
           * A rate for a level, a spread for a rate.
           *
           * Compounding a margin is meaningless — a margin that went from 20%
           * to 30% did not grow at 8.4% a year, it widened by ten points — so a
           * percentage metric states the spread and everything else states the
           * compound annual rate.
           */
          const growth = metric.unit === "percent"
            ? spreadOf(values, CAGR_YEARS)
            : cagrOf(values, CAGR_YEARS);
          return (
            <figure className="multiple" key={key}>
              <div className="multiple-top">
                <figcaption className="label">{metric.short}</figcaption>
                <span className="multiple-cagr">
                  {growth == null
                    ? ABSENT
                    : metric.unit === "percent"
                      ? `${delta(growth, 1)} ${CAGR_YEARS}Y`
                      : `${delta(growth, 1)} CAGR`}
                </span>
              </div>
              <div className="multiple-value" data-empty={latest == null}>
                {latest == null ? ABSENT : formatUnit(latest, metric.unit as Unit, currency)}
              </div>
              <div className="plot"><Bars values={values} /></div>
              <div className="multiple-span">
                <span className="label">{yearOf(first.end)}</span>
                <span className="label">{yearOf(last.end)}</span>
              </div>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

/** How many points a rate moved over the window, as a decimal fraction. */
function spreadOf(values: Array<number | null>, years: number): number | null {
  const known = values.map((value, index) => [index, value] as const).filter(([, value]) => value != null);
  if (known.length < 2) return null;
  const [endIndex, endValue] = known[known.length - 1] as [number, number];
  const start = known.find(([index]) => index >= endIndex - years);
  if (!start) return null;
  const [startIndex, startValue] = start as [number, number];
  if (endIndex === startIndex) return null;
  return endValue - startValue;
}

