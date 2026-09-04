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

const denominatorOf = (view: IoCompanyView): IoPeriod | null => view.ttm ?? view.annual[view.annual.length - 1] ?? null;

export function Stats({ view, quote }: { view: IoCompanyView; quote: IoQuote | null }) {
  const basis = view.basis;
  const period = denominatorOf(view);
  const price = quote?.price ?? null;

  const mismatch = basis && quote?.currency && quote.currency !== basis.currency
    ? `The share price is quoted in ${quote.currency} and the statements are filed in ${basis.currency}.`
    : null;

  const usable = basis && price != null && Number.isFinite(price) && price > 0 && !mismatch;
  const marketCap = usable ? price * basis.shares : null;
  const enterpriseValue = usable && basis.netDebt != null ? marketCap! + basis.netDebt : null;

  const at = (key: string) => period?.values[key] ?? null;
  const currency = basis?.currency ?? view.company.currency;

  const pe = multipleOf(marketCap, at("netIncome"));
  const ps = multipleOf(marketCap, at("revenue"));
  const pfcf = multipleOf(marketCap, at("freeCashFlow"));
  const evEbitda = multipleOf(enterpriseValue, at("ebitda"));
  const fcfYield = multipleOf(at("freeCashFlow"), marketCap);

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
      <p className="stat-note" style={{ marginTop: 10 }}>
        {mismatch
          ? mismatch
          : basis
            ? `On ${period?.label ?? basis.periodLabel} · ${basis.shares.toLocaleString("en-US")} shares ${basis.sharesBasis === "outstanding" ? "outstanding" : basis.sharesBasis === "cover-date" ? "outstanding at the filing cover date" : "diluted weighted average"}`
            : view.basisReason ?? ""}
      </p>
    </section>
  );
}
