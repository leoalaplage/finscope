"use client";

import { useMemo, useState } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { impliedGrowth } from "@/lib/io/implied-growth";
import { withinYears } from "./ranges";
import { datedCagrOf, delta, money, percent } from "./format";
import type { IoQuote } from "./quote";

/**
 * What the price is asking for, beside what the company has delivered.
 *
 * The one valuation this site is willing to state. A discounted cash flow run
 * forwards needs a forecast, and a forecast is the half nobody can check; run
 * backwards it needs none — the price is filed by the market, the cash flow is
 * filed with the SEC, and the rate that reconciles them is arithmetic.
 *
 * So the panel is two numbers and a comparison the reader makes themselves:
 * what the price asks for over ten years, and what the last five and ten years
 * actually did. Neither is a recommendation. A company asking 14% and
 * delivering 20% is not thereby cheap — the past is not the future, and this
 * page will not pretend the arithmetic says otherwise.
 *
 * The discount rate is the reader's, offered as three and stated beside the
 * answer, because it is the only number on this page nobody filed.
 */

const RATES = [.08, .10, .12];
const HORIZON = 10;
/*
 * The terminal rate, held rather than chosen.
 *
 * Two and a half percent is roughly the long-run growth of the economy a
 * company grows inside, and it is deliberately not a control: a terminal rate
 * tuned per company is the door through which a reverse discounted cash flow
 * quietly becomes a forecast again. Everything the reader can move, they can
 * see; this one they can read here.
 */
const TERMINAL = .025;

/**
 * What free cash flow actually compounded at, and over how long.
 *
 * The span is measured rather than assumed, because a window is a request and
 * not a fact: NVIDIA's filings carry no free cash flow before 2022, so its
 * "ten years" is four, and a cell labelled ten years over four years of data
 * would be the plausible wrong number this application exists not to print.
 * What comes back is the rate and the years it was earned over, and the label
 * on screen is the second of those.
 */
function delivered(periods: IoPeriod[], years: number) {
  const points = withinYears(periods, years).flatMap((period) => {
    const value = period.values.freeCashFlow;
    return value == null || !Number.isFinite(value) ? [] : [{ date: period.end, value }];
  });
  if (points.length < 2) return null;
  const rate = datedCagrOf(points);
  const from = points[0].date;
  const to = points[points.length - 1].date;
  const span = (Date.parse(to) - Date.parse(from)) / (365.25 * 86_400_000);
  return rate == null || !(span > 0) ? null : { rate, years: span, from, to };
}

/** The most recent period that reports this measure, and which one it was. */
function latest(view: IoCompanyView, key: string): { value: number | null; period: IoPeriod | null } {
  const series = [...view.annual, ...view.trailing].sort((left, right) => left.end.localeCompare(right.end));
  for (let index = series.length - 1; index >= 0; index--) {
    const value = series[index].values[key];
    if (value != null && Number.isFinite(value)) return { value, period: series[index] };
  }
  return { value: null, period: null };
}

/** "4 years", "10 years" — the span a record was actually earned over. */
const span = (record: { years: number } | null) => (record == null ? "5 years" : `${Math.round(record.years)} years`);

export function ImpliedExpectations({ view, quote }: { view: IoCompanyView; quote: IoQuote | null }) {
  const [discountRate, setDiscountRate] = useState(RATES[1]);

  const basis = view.basis;
  const freeCashFlow = latest(view, "freeCashFlow");
  const mismatch = basis && quote?.currency && quote.currency !== basis.currency;
  const marketCap = basis && !mismatch && quote?.price != null && quote.price > 0 ? quote.price * basis.shares : null;

  const implied = useMemo(() => {
    if (marketCap == null || freeCashFlow.value == null) return null;
    return impliedGrowth({
      marketCap,
      freeCashFlow: freeCashFlow.value,
      discountRate,
      years: HORIZON,
      terminalGrowth: TERMINAL,
    });
  }, [marketCap, freeCashFlow.value, discountRate]);

  /*
   * What it has actually done, on the same measure and in the same terms.
   *
   * Free cash flow itself rather than free cash flow per share: the price being
   * inverted is the price of the whole company, so the record beside it has to
   * be the whole company's. Buybacks make the per-share record faster, and that
   * record has a panel of its own further down the page.
   */
  const record = useMemo(() => ({
    near: delivered(view.annual, 5),
    far: delivered(view.annual, 10),
  }), [view.annual]);

  // A company with no price, no share count or no positive cash flow has no
  // question of this kind to answer, and an empty panel would say nothing.
  if (implied == null || implied.kind === "unavailable") return null;

  const currency = basis?.currency ?? view.company.currency;
  const longer = record.far != null && record.near != null && record.far.years > record.near.years + .5;
  const asked = implied.kind === "solved"
    ? delta(implied.rate)
    : `${implied.direction === "above" ? "over " : "under "}${delta(implied.bound, 0)}`;

  /*
   * Three rates on one scale, because the comparison is the point.
   *
   * Four figures in a row of cells is a table of numbers a reader has to hold
   * in their head to compare; the same three drawn against one axis answers the
   * question in a glance — is the price asking for more than this company has
   * ever done, or less. The ask is filled and the record is not, so which line
   * is the claim and which is the history needs no legend.
   *
   * The scale takes in nought, so a shrinking cash flow reads as the shrinkage
   * it is rather than as a short bar of growth.
   */
  const rows = [
    { label: `Price asks · ${HORIZON} years`, rate: implied.kind === "solved" ? implied.rate : implied.bound, written: asked, ask: true },
    ...(record.near ? [{ label: `Delivered · ${span(record.near)}`, rate: record.near.rate, written: delta(record.near.rate), ask: false }] : []),
    ...(longer && record.far ? [{ label: `Delivered · ${span(record.far)}`, rate: record.far.rate, written: delta(record.far.rate), ask: false }] : []),
  ];
  const rates = [0, ...rows.map((row) => row.rate)];
  const floor = Math.min(...rates);
  const ceiling = Math.max(...rates);
  const width = ceiling - floor || 1;
  const at = (value: number) => ((value - floor) / width) * 100;

  return (
    <section className="section implied" id="implied">
      <div className="section-head">
        <h2 className="label">What the price implies</h2>
        <div className="seg">
          {RATES.map((rate) => (
            <button key={rate} type="button" aria-pressed={discountRate === rate} onClick={() => setDiscountRate(rate)}>
              {percent(rate, 0)}
            </button>
          ))}
        </div>
      </div>

      <div className="allocation implied-rates">
        {rows.map((row) => (
          <div className="allocation-row" key={row.label}>
            <span className="allocation-name">{row.label}</span>
            <span className="allocation-bar">
              {floor < 0 ? <span className="implied-zero" style={{ left: `${at(0)}%` }} /> : null}
              <span
                data-ask={row.ask}
                style={{ marginInlineStart: `${at(Math.min(0, row.rate))}%`, width: `${Math.max(Math.abs(row.rate) / width * 100, .6)}%` }}
              />
            </span>
            <span className="allocation-weight num">{row.written}</span>
          </div>
        ))}
      </div>

      {/*
        * The terms, on one line, in the order they are used: what is paid, for
        * what cash, over how long. A reader who wants to check the arithmetic
        * has everything it was struck from; a reader who does not is not made
        * to read a paragraph to reach the figures above.
        */}
      <p className="stat-note implied-terms">
        {money(marketCap, currency)} for {money(freeCashFlow.value, currency)} of free cash flow
        {freeCashFlow.period ? ` · ${freeCashFlow.period.label}` : ""}
        {" · "}{percent(discountRate, 0)} discount, {percent(TERMINAL, 1)} after year {HORIZON}
        {" · "}the discount rate is the only figure here nobody filed
      </p>
    </section>
  );
}
