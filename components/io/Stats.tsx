"use client";

import { cashFlowIsTheBalanceSheet } from "@/lib/business-type";
import { absenceOf } from "@/lib/io/absence";
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

  /*
   * A bank's statistics, and an insurer's, are not an industrial company's.
   *
   * An enterprise value and a net debt are withheld for both, so the strip used
   * to open on four dashes for every bank and insurer in the index — a page
   * that looked broken for a company whose own measures were all there. What a
   * reader of a bank or an insurer reads is its price against its book, its
   * return on that book and what it pays out.
   */
  const type = view.company.businessType;
  const equity = latest(view, "totalEquity");
  const dividends = latest(view, "dividendsPaid");
  const roe = latest(view, "returnOnEquity");
  const pb = multipleOf(marketCap, equity.value);
  const bookPerShare = basis && equity.value != null && equity.value > 0 ? equity.value / basis.shares : null;
  const dividendYield = multipleOf(dividends.value == null ? null : Math.abs(dividends.value), marketCap);

  /*
   * Why a cell is a dash, on the cell (lib/io/absence.ts). A multiple is empty
   * because its price side is missing, or its filed side is missing or not
   * positive; the first reason that applies is the one given.
   */
  const noPrice = marketCap == null ? (mismatch ?? view.basisReason ?? "No price is available for this company right now.") : null;
  const filed = (from: Denominator, key: string, name: string) =>
    from.value == null ? absenceOf(view, key, name).text : from.value <= 0 ? `Not meaningful while ${name.toLowerCase()} is not positive.` : null;
  type Row = { label: string; value: number | null; write: (value: number) => string; why?: string | null };
  const common: Record<string, Row> = {
    cap: { label: "Market cap", value: marketCap, write: (value) => money(value, currency), why: noPrice },
    ev: { label: "EV", value: enterpriseValue, write: (value) => money(value, currency), why: noPrice ?? absenceOf(view, "netDebt", "Net debt").text },
    pe: { label: "P / E", value: pe, write: (value) => ratio(value, 1), why: noPrice ?? filed(netIncome, "netIncome", "Net income") },
    ps: { label: "P / S", value: ps, write: (value) => ratio(value, 1), why: noPrice ?? filed(revenue, "revenue", "Revenue") },
    pfcf: { label: "P / FCF", value: pfcf, write: (value) => ratio(value, 1), why: noPrice ?? filed(freeCashFlow, "freeCashFlow", "Free cash flow") },
    evEbitda: { label: "EV / EBITDA", value: evEbitda, write: (value) => ratio(value, 1), why: noPrice ?? filed(ebitda, "ebitda", "EBITDA") ?? absenceOf(view, "netDebt", "Net debt").text },
    fcfYield: { label: "FCF yield", value: fcfYield, write: (value) => percent(value, 2), why: noPrice ?? filed(freeCashFlow, "freeCashFlow", "Free cash flow") },
    netDebt: { label: "Net debt", value: basis?.netDebt ?? null, write: (value) => money(value, currency), why: absenceOf(view, "netDebt", "Net debt").text },
    pb: { label: "P / B", value: pb, write: (value) => ratio(value, 2), why: noPrice ?? filed(equity, "totalEquity", "Total equity") },
    book: { label: "Book value / share", value: bookPerShare, write: (value) => money(value, currency), why: filed(equity, "totalEquity", "Total equity") },
    roe: { label: "ROE", value: roe.value, write: (value) => percent(value, 1), why: absenceOf(view, "returnOnEquity", "Return on equity").text },
    dividend: { label: "Dividend yield", value: dividendYield, write: (value) => percent(value, 2), why: noPrice ?? (dividends.value == null ? "No dividend paid in the filings read." : null) },
  };
  const layout = cashFlowIsTheBalanceSheet(type)
    ? ["cap", "pe", "pb", "ps", "book", "roe", "dividend"]
    : type === "insurer"
      ? ["cap", "pe", "pb", "pfcf", "fcfYield", "roe", "dividend", "book"]
      : ["cap", "ev", "pe", "ps", "pfcf", "evEbitda", "fcfYield", "netDebt"];
  const rows: Row[] = layout.map((key) => common[key]);

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
    // A borrowing balance read back to the filing that states one. Said out
    // loud, because a figure carried from another date is not this date's.
    !mismatch && basis?.debtFrom
      ? `Net debt is this period's cash against the borrowings filed at ${basis.debtFrom.label}: the balance sheet behind ${period?.label ?? basis.periodLabel} tags none.`
      : null,
    !mismatch && !basis ? view.basisReason : null,
    view.withheldReason,
    view.fcfNote,
    // A price that is not the quote as it trades says what was done to it.
    quote?.conversion
      ? `Valued per ordinary share: ${[
        quote.conversion.sharesPerReceipt != null ? `one ${quote.conversion.from} receipt holds ${quote.conversion.sharesPerReceipt} ordinary shares` : null,
        quote.conversion.rate != null ? `its price converted at ${quote.conversion.rate.toFixed(4)} ${currency} per ${quote.conversion.from}${quote.conversion.asOf ? ` (${quote.conversion.asOf.slice(0, 10)})` : ""}` : null,
      ].filter(Boolean).join("; ")}. Statements stay as filed.`
      : null,
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
      <div className={rows.length === 7 ? "grid-ruled stats stats-seven" : "grid-ruled stats"}>
        {rows.map((row) => (
          <div className="stat" key={row.label} title={row.value == null ? row.why ?? undefined : undefined}>
            <div className="label">{row.label}</div>
            <div className="stat-value" data-empty={row.value == null}>{row.value == null ? ABSENT : row.write(row.value)}</div>
          </div>
        ))}
      </div>
      {notes.map((note) => <p className="stat-note" key={note} style={{ marginTop: 10 }}>{note}</p>)}
    </section>
  );
}
