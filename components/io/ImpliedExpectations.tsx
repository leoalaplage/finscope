"use client";

import { useMemo, useState } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { impliedGrowth, presentValue, projectCashFlows, valuePath } from "@/lib/io/implied-growth";
import { Figure, MultiLine } from "./Plot";
import { withinYears } from "./ranges";
import { datedCagrOf, delta, money, percent, price as writePrice, yearOf } from "./format";
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

/*
 * The returns a reader might actually demand, and why six is on the list.
 *
 * A discount rate is a hurdle, and the hurdle decides the answer: at ten
 * percent a company growing at nothing is worth eleven times its cash, which is
 * a standard almost no large American company clears on its record — so a list
 * that started at eight said "expensive" about everything and taught the reader
 * nothing. Six is what somebody who would accept a bond-like return from a
 * durable business is asking, and at six the same company is worth twenty-four
 * times. The spread between the four is the point: it shows how much of a
 * valuation is the reader's own requirement rather than the company's cash.
 */
const RATES = [.06, .08, .10, .12];
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

export type GrowthChoice = "price" | "near" | "far" | "flat";

export function ImpliedExpectations({
  view, quote, rate, onRate, growth, onGrowth,
}: {
  view: IoCompanyView;
  quote: IoQuote | null;
  /**
   * The return required, where a page owns it.
   *
   * The company page carries this panel alone and holds its own rate; the DCF
   * page has a grid whose columns are that same rate, and two controls for one
   * number is a page arguing with itself. Given a rate, the panel uses it and
   * draws no picker of its own.
   */
  rate?: number;
  onRate?: (rate: number) => void;
  /** Likewise the growth: the grid's cells set it, and the rows still do too. */
  growth?: GrowthChoice;
  onGrowth?: (growth: GrowthChoice) => void;
}) {
  const [ownRate, setOwnRate] = useState(.10);
  const discountRate = rate ?? ownRate;
  const setDiscountRate = onRate ?? setOwnRate;
  /*
   * Which rate the projection is drawn at.
   *
   * "price" is the inversion — the rate that makes today's price exactly right
   * — and the other two are this company's own record. Every rate the reader
   * can choose is therefore either arithmetic on the price or a figure out of
   * the filings; there is nowhere to type a number nobody has earned, which is
   * the difference between this and a spreadsheet.
   */
  const [ownChoice, setOwnChoice] = useState<GrowthChoice>("price");
  const chosen = growth ?? ownChoice;
  const setChosen = onGrowth ?? setOwnChoice;
  const [hover, setHover] = useState<number | null>(null);
  /*
   * Which half of the model is on screen.
   *
   * The cash is what the assumption *is*; the value is what it is worth, and
   * the second is the one that answers whether today's price is a discount.
   * Both are the same arithmetic — the value path is the same flows discounted
   * from each later date — so switching between them cannot show two different
   * claims.
   */
  const [view3, setView3] = useState<"cash" | "value">("cash");
  const [guide, setGuide] = useState(false);

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
  // Past this line the three the arithmetic needs are all present.
  if (implied == null || implied.kind === "unavailable" || marketCap == null || freeCashFlow.value == null) return null;
  const cash = freeCashFlow.value;

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
    { id: "price" as const, label: `Price asks · ${HORIZON} years`, rate: implied.kind === "solved" ? implied.rate : implied.bound, written: asked, ask: true },
    ...(record.near ? [{ id: "near" as const, label: `Delivered · ${span(record.near)}`, rate: record.near.rate, written: delta(record.near.rate), ask: false }] : []),
    ...(longer && record.far ? [{ id: "far" as const, label: `Delivered · ${span(record.far)}`, rate: record.far.rate, written: delta(record.far.rate), ask: false }] : []),
    // A company that never grows again is the floor every valuation stands on,
    // and it is the one assumption nobody has to defend.
    { id: "flat" as const, label: "No growth", rate: 0, written: delta(0), ask: false },
  ];
  const drawn = rows.find((row) => row.id === chosen) ?? rows[0];
  /*
   * The picture: what was filed, then what the chosen rate implies.
   *
   * The filed years are the company's own annual free cash flow, and the last
   * bar is the base the projection compounds from — the trailing year where the
   * filings have one, which is the same figure the multiple above is struck on.
   * Ten years of implication follow it, drawn as outlines.
   */
  const filed = view.annual
    .flatMap((period) => {
      const value = period.values.freeCashFlow;
      return value == null || !Number.isFinite(value) ? [] : [{ date: period.end, label: period.label, value }];
    })
    .slice(-HORIZON);
  const base = freeCashFlow.period;
  const history = base && filed.at(-1)?.date !== base.end
    ? [...filed, { date: base.end, label: base.label, value: cash }]
    : filed;
  const startYear = Number(base?.end.slice(0, 4) ?? new Date().getFullYear());
  const projection = projectCashFlows(cash, drawn.rate, HORIZON)
    .map((value, index) => ({
      date: `${startYear + index + 1}`,
      label: `Year +${index + 1}`,
      value,
    }));
  const bars = [...history, ...projection];

  /*
   * What the arithmetic is worth at the chosen rate, against what it costs.
   *
   * On the price's own rate this is nought by construction, and that is worth
   * seeing: it is the inversion stating itself. On the company's record it is
   * the question the panel exists for — what would this be worth if it simply
   * carried on doing what it has done.
   */
  const worth = presentValue(
    { marketCap, freeCashFlow: cash, discountRate, years: HORIZON, terminalGrowth: TERMINAL },
    drawn.rate,
  );
  const gap = worth / marketCap - 1;
  const perShare = basis ? worth / basis.shares : null;
  const active = hover == null ? null : bars[hover] ?? null;

  /*
   * What the business is worth at each year end, against what it costs today.
   *
   * A price cannot be projected — it is what somebody else will pay — so what
   * is drawn is the value, and the year it passes the flat line of today's
   * price is the discount stated as a date: this is the year the business is
   * worth what you are being asked to pay for it now.
   */
  const shares = basis?.shares ?? null;
  const path = shares == null ? [] : valuePath(
    { marketCap, freeCashFlow: cash, discountRate, years: HORIZON, terminalGrowth: TERMINAL },
    drawn.rate,
  ).map((value, index) => ({ date: `${startYear + index}`, value: value / shares }));
  const paid = quote?.price ?? (shares == null ? null : marketCap / shares);
  const priceLine = paid == null ? [] : path.map((point) => ({ date: point.date, value: paid }));
  /*
   * The first year the value reaches what the price asks today.
   *
   * Nought means the discount is available now; nothing at all means the value
   * never reaches it inside the window. Half a percent of tolerance, because at
   * the rate the price itself implies the two are the same number to the last
   * decimal — and "worth today's price next year" would be a rounding error
   * dressed up as a finding.
   */
  const catchesUp = paid == null ? null : path.findIndex((point) => point.value >= paid * .995);
  const valueHover = hover != null && view3 === "value" ? path[hover] ?? null : null;
  const source = chosen === "near" ? record.near : chosen === "far" ? record.far : null;
  const shortRecord = source != null && source.years < HORIZON - .5 ? source : null;

  const rates = [0, ...rows.map((row) => row.rate)];
  const floor = Math.min(...rates);
  const ceiling = Math.max(...rates);
  const width = ceiling - floor || 1;
  const at = (value: number) => ((value - floor) / width) * 100;

  return (
    <section className="section implied" id="implied">
      <div className="section-head implied-head">
        <h2 className="label">What the price implies</h2>
        {/*
          * The switch says what it switches.
          *
          * Four bare percentages beside a heading are four percentages of
          * nothing: a reader cannot know they are being asked what return they
          * want. Everywhere else on this site a control needs no label because
          * its options name themselves — 1Y, TTM, Compare — and this is the one
          * that does not.
          */}
        {rate == null ? (
          <div className="implied-rate-picker">
            <span className="label">Return you require</span>
            <div className="seg">
              {RATES.map((option) => (
                <button key={option} type="button" aria-pressed={discountRate === option} onClick={() => setDiscountRate(option)}>
                  {percent(option, 0)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <button className="metric-toggle" type="button" aria-expanded={guide} onClick={() => setGuide(!guide)}>
          {guide ? "Hide" : "How to read this"}
        </button>
      </div>

      {/*
        * The one panel on this site that explains itself, and it has to.
        *
        * Everywhere else a figure is a filed fact under a label, and a label
        * that needs a paragraph is a label that failed. This is not that: it is
        * a model, its inputs are the reader's, and a model nobody can follow is
        * worse than no model. So the explanation exists — five lines, one for
        * each thing on screen — and it is folded away, because a reader who has
        * understood it once should not be made to scroll past it for ever.
        */}
      {guide ? (
        <dl className="implied-guide">
          <dt className="label">Return you require</dt>
          <dd>What you want to earn a year for owning this. The only figure here nobody filed — move it and every number below moves with it.</dd>
          <dt className="label">Price asks</dt>
          <dd>The growth in free cash flow that would make today&rsquo;s price exactly right, if you earn what you require. Read backwards from the price, never forecast.</dd>
          <dt className="label">Delivered</dt>
          <dd>What this company&rsquo;s free cash flow has actually compounded at, from its own filings, over the years they cover.</dd>
          <dt className="label">Cash flow</dt>
          <dd>Filed years are filled, the ten projected years are outlined. Choosing a row above draws that rate.</dd>
          <dt className="label">Value</dt>
          <dd>What the business is worth at each year end on that rate, against the flat line of what it costs today. Where they meet is the year it is worth what you would pay now.</dd>
        </dl>
      ) : null}

      {/* The comparison is also the control: choosing a row projects it. One
          vocabulary for both jobs, and every rate on offer is either the
          price's own arithmetic or a figure out of the filings. */}
      <div className="allocation implied-rates" role="group" aria-label="Growth the projection is drawn at">
        {rows.map((row) => (
          <button
            className="allocation-row implied-row"
            type="button"
            key={row.label}
            aria-pressed={row.id === chosen}
            onClick={() => { setChosen(row.id); setHover(null); }}
          >
            <span className="allocation-name">{row.label}</span>
            <span className="allocation-bar">
              {floor < 0 ? <span className="implied-zero" style={{ left: `${at(0)}%` }} /> : null}
              <span
                data-ask={row.ask}
                style={{ marginInlineStart: `${at(Math.min(0, row.rate))}%`, width: `${Math.max(Math.abs(row.rate) / width * 100, .6)}%` }}
              />
            </span>
            <span className="allocation-weight num">{row.written}</span>
          </button>
        ))}
      </div>

      <div className="section-head implied-readout">
        <div className="readout">
          {view3 === "cash" ? (
            <>
              <span className="v">{active ? money(active.value, currency) : money(bars.at(-1)!.value, currency)}</span>
              <span className="d">{active ? active.label : `${drawn.label.toLowerCase()} · year +${HORIZON}`}</span>
            </>
          ) : (
            <>
              <span className="v">{writePrice((valueHover ?? path[0])?.value ?? 0, currency)}</span>
              <span className="d">
                {valueHover ? `worth at the end of ${valueHover.date}` : "worth today"}
                {paid != null ? ` · ${writePrice(paid, currency)} to buy it` : ""}
              </span>
            </>
          )}
          <span className="readout-cagr">
            {perShare == null
              ? `${money(worth, currency)} of equity`
              : `${writePrice(perShare, currency)} a share`}
            {/* Two decimals on a gap of six thousand percent is noise pretending
                to be precision. */}
            {paid != null ? ` · ${delta(gap, Math.abs(gap) > 1 ? 0 : 2)} against ${writePrice(paid, currency)}` : ""}
          </span>
          {/* The discount as a date, which is the form a reader can act on. */}
          {catchesUp != null && paid != null ? (
            <span className="readout-change">
              {catchesUp === 0
                ? "worth it today"
                : catchesUp > 0
                  ? `worth today's price in ${path[catchesUp].date}`
                  : `not by ${path.at(-1)?.date}`}
            </span>
          ) : null}
        </div>
        <div className="seg">
          <button type="button" aria-pressed={view3 === "cash"} onClick={() => { setView3("cash"); setHover(null); }}>Cash flow</button>
          <button type="button" aria-pressed={view3 === "value"} onClick={() => { setView3("value"); setHover(null); }}>Value</button>
        </div>
      </div>

      {/*
        * Both frames carry what they are measured in.
        *
        * A chart on this site states the band it covers at the two ends of its
        * own axis, because a shape with no figures on it is a decoration. The
        * cash frame is money a year; the value frame is money a share, and the
        * price line sitting inside that band is what the whole picture is for.
        */}
      {view3 === "cash" ? (
        <div className="price-frame">
          <Figure points={bars} shape="bars" onHover={setHover} projectedFrom={history.length} />
          <div className="plot-axis">
            <span className="plot-tag" style={{ right: 0, top: 0 }}>{money(Math.max(...bars.map((bar) => bar.value)), currency)}</span>
            <span className="plot-tag" style={{ right: 0, bottom: 0 }}>{money(Math.min(0, ...bars.map((bar) => bar.value)), currency)}</span>
            <span className="plot-tag plot-tag-under" style={{ left: 0 }}>{yearOf(history[0]?.date ?? "")}</span>
            <span className="plot-tag plot-tag-under" style={{ left: `${(history.length / bars.length) * 100}%` }}>filed · implied</span>
            <span className="plot-tag plot-tag-under" style={{ right: 0 }}>{projection.at(-1)?.date}</span>
          </div>
        </div>
      ) : (
        <div className="price-frame">
          {/* The value is the subject and the price is what it is held against,
              so one is filled and the other is the line beside it — the same
              way the portfolio is drawn against its index. */}
          <MultiLine
            series={[
              { label: "Value", points: path, area: true },
              ...(priceLine.length ? [{ label: "Price", points: priceLine }] : []),
            ]}
            onHover={setHover}
          />
          <div className="plot-axis">
            <span className="plot-tag plot-tag-left" style={{ top: 0 }}>{writePrice(Math.max(...path.map((point) => point.value), paid ?? 0), currency)}</span>
            <span className="plot-tag plot-tag-left" style={{ bottom: 0 }}>{writePrice(Math.min(...path.map((point) => point.value), paid ?? Infinity), currency)}</span>
            <span className="plot-tag plot-tag-under" style={{ left: 0 }}>{path[0]?.date}</span>
            <span className="plot-tag plot-tag-under" style={{ right: 0 }}>{path.at(-1)?.date}</span>
          </div>
        </div>
      )}
      {/*
        * The weak link, where there is one, said as a fact rather than a
        * warning. NVIDIA's filings carry four years of free cash flow; drawing
        * ten years of them at that rate is arithmetic the reader asked for, and
        * how far it reaches beyond the record is the thing they need to know
        * about it.
        */}
      {shortRecord ? (
        <p className="stat-note implied-reach">
          {HORIZON} years projected from a record of {span(shortRecord)}.
        </p>
      ) : null}

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
