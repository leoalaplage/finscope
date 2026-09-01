"use client";

import { useEffect, useMemo, useState } from "react";
import { getJson } from "@/lib/fetch-json";
import { priceDriverReading, priceDrivers } from "@/lib/price-drivers";
import type { CompanyDataset, PricePoint } from "@/lib/types";

/**
 * The two things a share price can do, told apart.
 *
 * Every other panel here answers "what is this company worth". This one
 * answers a question a reader of a price chart cannot answer at all: of the
 * move you are looking at, how much did the company earn and how much did the
 * market simply decide to pay? A price is free cash flow per share over the
 * yield the market accepts on it, so the two are the only possibilities, and
 * the split is an identity rather than an attribution.
 *
 * It is worth its own panel because the same +140% means opposite things. Cash
 * per share compounding at 19% is a result the company can repeat. A multiple
 * that expanded from 3% to 1.5% is a result the next buyer has to agree to pay
 * again, and nothing in the filings says they will.
 */
const HORIZONS = [3, 5, 10] as const;

/*
 * Multiples, not percentages.
 *
 * The first version of this panel reported the three figures as returns: the
 * price +94%, the business +269%, the multiple −47%. Every reader tries to add
 * them, and they do not add — they multiply, because the price *is* the
 * product. Stated as multiples the same three figures can be checked in your
 * head: 3.7 × 0.5 = 1.9. And ×0.5 says "the market halved what it pays" far
 * faster than "−47%" does.
 */
const times = (growth: number | null | undefined) =>
  growth == null || !Number.isFinite(growth) ? "—" : `×${(1 + growth).toFixed(2)}`;
// The same minus sign as the figure above it: a hyphen beside a true minus
// reads as two different kinds of negative.
const rate = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : `${value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(1)}%/yr`;
/*
 * What the market pays for a pound of the company's cash, rather than the
 * yield it accepts on it.
 *
 * They are the same fact upside down, and the yield is the harder way up: it
 * *rises* when the shares get cheaper, so a reader trying to understand a
 * falling price meets a rising number. "68× cash flow, now 36×" needs no
 * explanation, and it is visibly the ×0.53 on the row above it.
 */
const paid = (yieldValue: number) => `${(1 / yieldValue).toFixed(0)}×`;

export function PriceDrivers({ dataset }: { dataset: CompanyDataset }) {
  const [points, setPoints] = useState<Record<string, PricePoint | null> | null>(null);
  const [error, setError] = useState("");

  /*
   * Every fiscal year end at once: the endpoint takes a list, and the three
   * horizons below are drawn from the same set rather than a fetch each.
   *
   * Year ends rather than filing dates. A year that a later report restated
   * carries that report's filing date — Apple's 2015 is dated November 2017 in
   * this data — so pricing on it would divide a 2015 cash flow by a 2017 share
   * price and call the difference growth.
   */
  const dates = useMemo(() => [...new Set(dataset.periods
    .filter((period) => period.periodicity === "annual")
    .map((period) => period.periodEnd))].sort(), [dataset.periods]);

  useEffect(() => {
    if (!dates.length) return;
    let active = true;
    getJson<{ points?: Array<{ requestedDate: string; point?: PricePoint }> }>(
      `/api/prices/${encodeURIComponent(dataset.company.ticker)}?dates=${dates.join(",")}`,
      { what: "the price history behind this company" })
      .then((payload) => { if (active) setPoints(Object.fromEntries((payload.points ?? []).map((item) => [item.requestedDate, item.point ?? null]))); })
      .catch((cause: unknown) => { if (active) { setPoints({}); setError(cause instanceof Error ? cause.message : "The price history is unavailable."); } });
    return () => { active = false; };
  }, [dataset.company.ticker, dates]);

  // A company with no annual filing date has nothing to fetch and nothing to
  // wait for, which is a derived fact rather than a state to be set.
  const resolved = useMemo(() => dates.length === 0 ? {} : points, [dates, points]);
  const results = useMemo(() => resolved == null ? [] : HORIZONS.map((years) => ({ years, ...priceDrivers(dataset.periods, resolved, years) })), [dataset.periods, resolved]);
  const longest = results.filter((item) => item.drivers).at(-1);

  if (resolved == null) return <section className="panel price-drivers"><h3>What moved the share price</h3><p className="stat-note">Reading the price on each filing date…</p></section>;

  return <section className="panel price-drivers">
    <div className="panel-head">
      <div>
        <span className="panel-kicker">WHAT MOVED THE SHARE PRICE</span>
        <h2>The business, or the multiple</h2>
      </div>
    </div>
    <p className="stat-note">
      A share price is only two things multiplied together: the cash the business produces for each share, and what the market
      is willing to pay for that cash. So when a price moves, one of the two moved — and which one matters, because a company
      can repeat what it earned and cannot repeat what the market decided to pay. Each year is priced at its own fiscal year end.
    </p>
    <div className="table-scroll">
      <table className="financial-table">
        <thead><tr><th>Over</th>{results.map((item) => <th key={item.years}>{item.years} years</th>)}</tr></thead>
        <tbody>
          <tr className="price-drivers-part">
            <th>Cash per share<small>what the business produced</small></th>
            {results.map((item) => <td key={item.years}>
              {item.drivers ? <><b>{times(item.drivers.businessReturn)}</b><small>{rate(item.drivers.annualised.business)}</small></> : "—"}
            </td>)}
          </tr>
          <tr className="price-drivers-part">
            <th>What the market paid for it<small>price per unit of cash flow</small></th>
            {results.map((item) => <td key={item.years}>
              {item.drivers
                ? <><b>{times(item.drivers.valuationReturn)}</b><small>{paid(item.drivers.start.yield)} → {paid(item.drivers.end.yield)}</small></>
                : "—"}
            </td>)}
          </tr>
          <tr className="price-drivers-total">
            <th>= Share price<small>the two multiplied</small></th>
            {results.map((item) => <td key={item.years} title={item.drivers ? `${item.drivers.start.date} → ${item.drivers.end.date}` : item.reason}>
              {item.drivers ? <><b>{times(item.drivers.totalReturn)}</b><small>{rate(item.drivers.annualised.total)}</small></> : "—"}
            </td>)}
          </tr>
        </tbody>
      </table>
    </div>
    {longest?.drivers
      ? <p className="price-drivers-reading">Over {Math.round(longest.drivers.years)} years: {priceDriverReading(longest.drivers).replace(/^([A-Z])/, (letter) => letter.toLowerCase())}</p>
      : <p className="stat-note">{error || results[0]?.reason || "No priced year carries a free cash flow per share for this company."}</p>}
  </section>;
}
