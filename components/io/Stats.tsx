"use client";

import { multipleOf } from "@/lib/market-basis";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import type { IoQuote } from "./quote";
import { ABSENT, money, percent, ratio } from "./format";

/**
 * What a live price and a filed statement make together, or nothing.
 *
 * Two questions decide whether any figure here is a fact. Is the quote in the
 * currency the accounts are kept in — because no rate is applied to a filed
 * number anywhere in this application, ever — and is the share count the one
 * the company has outstanding. Both are asked of the basis the engine struck
 * server-side; a no to either withholds the whole strip and says which.
 *
 * A multiple over a negative denominator is withheld rather than printed as a
 * negative one: a company losing money is not a cheap company, it is a company
 * the measure does not apply to. That rule lives in `multipleOf` and is not
 * restated here.
 */

/** A denominator, and which period it actually came from. */
interface Denominator { value: number | null; label: string | null }

/**
 * The most recent period that reports this measure, not simply the most recent.
 *
 * The newest trailing period is assembled from a quarter that has only just
 * been filed, and a filer does not tag every line at once: Cboe's latest
 * quarter carried an operating cash flow and no capital expenditure, so it had
 * no free cash flow — and the price-to-free-cash-flow and the free-cash-flow
 * yield disappeared for a company whose free cash flow was sitting one quarter
 * back, unchanged and complete. Reading back to the period that reports the
 * figure is what a reader means by "the trailing twelve months"; which period
 * that was is stated under the strip rather than quietly assumed.
 */
function latest(view: IoCompanyView, key: string): Denominator {
  const series = [...view.annual, ...view.trailing].sort((left, right) => left.end.localeCompare(right.end));
  for (let index = series.length - 1; index >= 0; index--) {
    const value = series[index].values[key];
    if (value != null && Number.isFinite(value)) return { value, label: series[index].label };
  }
  return { value: null, label: null };
}

const headline = (view: IoCompanyView): IoPeriod | null => view.ttm ?? view.annual[view.annual.length - 1] ?? null;

export function Stats({ view, quote }: { view: IoCompanyView; quote: IoQuote | null }) {
  const basis = view.basis;
  const period = headline(view);
  const price = quote?.price ?? null;

  const mismatch = basis && quote?.currency && quote.currency !== basis.currency
    ? `The share price is quoted in ${quote.currency} and the statements are filed in ${basis.currency}.`
    : null;

  const usable = basis && price != null && Number.isFinite(price) && price > 0 && !mismatch;
  const marketCap = usable ? price * basis.shares : null;
  const enterpriseValue = usable && basis.netDebt != null ? marketCap! + basis.netDebt : null;

  const currency = basis?.currency ?? view.company.currency;
  const netIncome = latest(view, "netIncome");
  const revenue = latest(view, "revenue");
  const freeCashFlow = latest(view, "freeCashFlow");
  const ebitda = latest(view, "ebitda");

  const pe = multipleOf(marketCap, netIncome.value);
  const ps = multipleOf(marketCap, revenue.value);
  const pfcf = multipleOf(marketCap, freeCashFlow.value);
  const evEbitda = multipleOf(enterpriseValue, ebitda.value);
  const fcfYield = multipleOf(freeCashFlow.value, marketCap);

  const rows: Array<{ label: string; value: number | null; write: (value: number) => string }> = [
    { label: "Market cap", value: marketCap, write: (value) => money(value, currency) },
    { label: "EV", value: enterpriseValue, write: (value) => money(value, currency) },
    { label: "P / E", value: pe, write: (value) => ratio(value, 1) },
    { label: "P / S", value: ps, write: (value) => ratio(value, 1) },
    { label: "P / FCF", value: pfcf, write: (value) => ratio(value, 1) },
    { label: "EV / EBITDA", value: evEbitda, write: (value) => ratio(value, 1) },
    { label: "FCF yield", value: fcfYield, write: (value) => percent(value, 2) },
    { label: "Net debt", value: basis?.netDebt ?? null, write: (value) => money(value, currency) },
  ];

  /*
   * Why a figure is missing, on the strip that is missing it.
   *
   * An enterprise value with no explanation reads as a broken page. Copart has
   * repaid its borrowings and now tags no debt concept at all, and this
   * application will not read an absent balance as a zero one — so the honest
   * answer is not a dash, it is the dash plus the sentence.
   */
  const debtless = basis?.netDebt == null && period != null;
  const notes = [
    mismatch,
    !mismatch && basis
      ? `On ${period?.label ?? basis.periodLabel} · ${basis.shares.toLocaleString("en-US")} shares ${basis.sharesBasis === "outstanding" ? "outstanding" : basis.sharesBasis === "cover-date" ? "outstanding at the filing cover date" : "diluted weighted average"}`
      : null,
    !mismatch && !basis ? view.basisReason : null,
    view.withheldReason,
    debtless && !view.withheldReason && period?.values.totalDebt == null
      ? "No enterprise value: the filer tags no borrowing balance at this date, and an absent balance is not a zero one."
      : debtless && !view.withheldReason
        ? "No enterprise value: the filer tags no cash balance at this date, so net debt cannot be struck."
        : null,
    ...[
      { name: "Free cash flow", from: freeCashFlow },
      { name: "Net income", from: netIncome },
      { name: "Revenue", from: revenue },
      { name: "EBITDA", from: ebitda },
    ]
      .filter((entry) => entry.from.value != null && entry.from.label != null && entry.from.label !== period?.label)
      .map((entry) => `${entry.name} is from ${entry.from.label}: the later period reports none.`),
  ].filter(Boolean);

  return (
    <section className="section" id="valuation" style={{ borderTop: 0, paddingTop: 0 }}>
      <div className="grid-ruled stats">
        {rows.map((row) => (
          <div className="stat" key={row.label}>
            <div className="label">{row.label}</div>
            <div className="stat-value" data-empty={row.value == null}>{row.value == null ? ABSENT : row.write(row.value)}</div>
          </div>
        ))}
      </div>
      {notes.map((note) => <p className="stat-note" key={note} style={{ marginTop: 10 }}>{note}</p>)}
    </section>
  );
}
