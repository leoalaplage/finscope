"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartPalette, niceTicks, type ThemeName } from "@/lib/charting";
import { cagrForPeriods } from "@/lib/finance";
import { calculateFcfYieldModel, fcfYieldBase, multipleToYield, suggestedGrowth, yieldToMultiple, type FcfYieldInputs } from "@/lib/fcf-yield-model";
import { money as formatMoney, percent, perShare } from "@/lib/format";
import type { CompanyDataset, PricePoint } from "@/lib/types";

const money = (value: number | null | undefined, code = "USD") => Math.abs(value ?? 0) >= 1_000 ? formatMoney(value, code) : perShare(value, code);

/** One labelled numeric input with its unit and its explanation. */
function Field({ label, value, onChange, suffix, step = 0.1, hint }: {
  label: string; value: number; onChange: (next: number) => void; suffix: string; step?: number; hint: string;
}) {
  return <label className="fcf-field">
    <span className="fcf-field-label">{label}</span>
    <span className="fcf-input">
      <input type="number" step={step} value={Number.isFinite(value) ? value : ""} onChange={(event) => onChange(Number(event.target.value))}/>
      <b>{suffix}</b>
    </span>
    <small>{hint}</small>
  </label>;
}

/**
 * The reverse DCF: four assumptions in, an entry price out.
 *
 * Laid out as the reader reads it — what the business earns today across the
 * top, the assumptions down the left, and what those assumptions imply on the
 * right, so changing a number and watching the answer move takes no scrolling.
 */
export function FcfYieldCalculator({ dataset, price, theme }: { dataset: CompanyDataset; price: PricePoint | null; theme: ThemeName }) {
  const code = dataset.company.currency;
  /*
   * A yield needs both halves in one currency.
   *
   * Free cash flow per share comes from statements filed in the company's
   * reporting currency; the quote comes from the exchange its shares list on.
   * Dividing one by the other across a currency boundary produces a yield that
   * is wrong by the exchange rate and looks entirely ordinary, so the price
   * side is dropped and the model runs on the filings alone.
   */
  const foreignQuote = price != null && price.currency !== code;
  const currentPrice = foreignQuote ? null : price ? price.priceClose ?? price.close : null;
  const base = useMemo(() => fcfYieldBase(dataset.periods, currentPrice), [dataset, currentPrice]);
  const annual = useMemo(() => dataset.periods.filter((period) => period.periodicity === "annual"), [dataset]);

  // Seeded once, from the filings alone. Today's market price deliberately does
  // not seed the exit yield: what the shares should trade at in five years is
  // the reader's judgement, not an echo of what they trade at this morning. The
  // trailing yield sits in the card above the field for anyone who wants it.
  const [inputs, setInputs] = useState<FcfYieldInputs>(() => ({
    fcfPerShare: base?.fcfPerShare ?? 0,
    growthRate: suggestedGrowth(cagrForPeriods(annual, "freeCashFlowPerShare", 5).value, cagrForPeriods(annual, "freeCashFlowPerShare", 10).value),
    exitYield: .04, exitMultiple: 25, useMultiple: false, desiredReturn: .1, years: 5,
  }));

  const result = useMemo(() => calculateFcfYieldModel(inputs, currentPrice), [inputs, currentPrice]);
  const palette = chartPalette(theme);
  const patch = (next: Partial<FcfYieldInputs>) => setInputs((current) => ({ ...current, ...next }));

  if (!base) return <p className="simple-state">No reported period carries free cash flow per share for this company.</p>;

  const prices = result?.projection.map((point) => point.price) ?? [];
  const ticks = prices.length ? niceTicks(0, Math.max(...prices), 5) : [];

  return <div className="fcf-model">
    <section className="panel fcf-assumptions">
      <div className="panel-head"><div><span className="panel-kicker">ASSUMPTIONS</span><h2>What you expect</h2></div></div>

      <div className="fcf-summary">
        <h3>Current cash flow</h3>
        <div>
          <div><span>FCF / share ({base.periodLabel})</span><strong>{money(base.fcfPerShare, code)}</strong></div>
          <div><span>FCF yield</span><strong>{percent(base.fcfYield)}</strong></div>
          <div><span>SBC impact</span><strong className={base.sbcImpact != null && base.sbcImpact < 0 ? "negative" : undefined}>{percent(base.sbcImpact)}</strong></div>
        </div>
        <small>Reported to {base.periodEnd}. SBC impact is how much of free cash flow per share stock compensation consumes.</small>
        {foreignQuote && <small>The share price is quoted in {price!.currency} and this company files in {code}; the market comparison is withheld rather than converted.</small>}
      </div>

      <Field label="FCF / share" value={Number(inputs.fcfPerShare.toFixed(2))} step={0.01} suffix={code === "USD" ? "$" : code}
        onChange={(next) => patch({ fcfPerShare: next })}
        hint="Trailing free cash flow per share — operating cash flow less capital expenditure, divided by diluted shares."/>

      <Field label="FCF / share growth" value={Number((inputs.growthRate * 100).toFixed(2))} suffix="%"
        onChange={(next) => patch({ growthRate: next / 100 })}
        hint={`Seeded from this company's own history, capped at ±20%. 5Y actual: ${percent(cagrForPeriods(annual, "freeCashFlowPerShare", 5).value)}, 10Y: ${percent(cagrForPeriods(annual, "freeCashFlowPerShare", 10).value)}.`}/>

      {inputs.useMultiple
        ? <Field label="Exit P/FCF" value={Number(inputs.exitMultiple.toFixed(2))} step={0.5} suffix="×"
            onChange={(next) => patch({ exitMultiple: next, exitYield: multipleToYield(next) })}
            hint="The price-to-free-cash-flow multiple you expect the shares to trade at in the exit year."/>
        : <Field label="Exit FCF yield" value={Number((inputs.exitYield * 100).toFixed(2))} suffix="%"
            onChange={(next) => patch({ exitYield: next / 100, exitMultiple: yieldToMultiple(next / 100) })}
            hint="The free cash flow yield you consider appropriate for the shares to trade at."/>}

      <label className="fcf-toggle">
        <input type="checkbox" checked={inputs.useMultiple} onChange={(event) => patch({ useMultiple: event.target.checked })}/>
        <span>Use FCF multiple</span>
        <small>{inputs.useMultiple ? `${percent(multipleToYield(inputs.exitMultiple))} yield` : `${yieldToMultiple(inputs.exitYield).toFixed(1)}× multiple`} — the same assumption said the other way.</small>
      </label>

      <Field label="Desired return" value={Number((inputs.desiredReturn * 100).toFixed(2))} suffix="%"
        onChange={(next) => patch({ desiredReturn: next / 100 })}
        hint="The annualized return you want. The entry price is whatever price delivers it under these assumptions."/>

      <label className="fcf-field">
        <span className="fcf-field-label">Holding period</span>
        <span className="fcf-input">
          <select value={inputs.years} onChange={(event) => patch({ years: Number(event.target.value) })}>
            {[3, 5, 7, 10].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <b>yrs</b>
        </span>
        <small>How long you intend to hold before the exit assumption applies.</small>
      </label>
    </section>

    <section className="panel fcf-output">
      <div className="panel-head"><div><span className="panel-kicker">RESULT</span><h2>{inputs.years}-year projection</h2></div></div>

      <div className="fcf-summary results">
        <h3>What that implies</h3>
        <div>
          <div><span>Return from today&apos;s price</span><strong className={result?.returnFromCurrentPrice != null ? (result.returnFromCurrentPrice >= inputs.desiredReturn ? "positive" : "negative") : undefined}>{percent(result?.returnFromCurrentPrice)}</strong></div>
          <div><span>Entry price for {(inputs.desiredReturn * 100).toFixed(0)}% return</span><strong>{money(result?.entryPrice, code)}</strong></div>
          <div><span>Exit price in {result?.projection.at(-1)?.year}</span><strong>{money(result?.exitPrice, code)}</strong></div>
        </div>
        <small>
          {currentPrice == null
            ? "No matched market price, so the return from today is unavailable. The entry price does not depend on it."
            : `Today ${money(currentPrice, code)} · ${result?.marginOfSafety != null && result.marginOfSafety >= 0 ? `${percent(result.marginOfSafety)} below` : `${percent(Math.abs(result?.marginOfSafety ?? 0))} above`} the entry price for your target.`}
        </small>
      </div>

      <div className="fcf-canvas">{result && <ResponsiveContainer width="100%" height="100%">
        <LineChart data={result.projection} margin={{ top: 12, right: 20, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)"/>
          <XAxis dataKey="label" tickLine={false} axisLine={false}/>
          <YAxis width={70} tickLine={false} axisLine={false}
            domain={ticks.length >= 2 ? [ticks[0], ticks.at(-1)!] : ["auto", "auto"]}
            ticks={ticks.length >= 2 ? ticks : undefined}
            tickFormatter={(value) => money(Number(value), code)}/>
          <Tooltip content={({ active, payload, label }) => {
            const point = active && payload?.length ? payload[0].payload as typeof result.projection[number] : null;
            return point ? <div className="chart-tooltip"><b>{label}</b>
              <span><i style={{ background: palette[2].value }}/><span>Share price</span><strong>{money(point.price, code)}</strong></span>
              <span><i style={{ background: palette[0].value }}/><span>FCF / share</span><strong>{money(point.fcfPerShare, code)}</strong></span>
            </div> : null;
          }}/>
          <Line type="monotone" dataKey="price" stroke={palette[2].value} strokeWidth={2} dot={{ r: 3, fill: palette[2].value }} isAnimationActive={false}/>
        </LineChart>
      </ResponsiveContainer>}</div>

      <p className="source-note">
        The line is today&apos;s price compounding at the implied return, ending at the exit price — what the money does, not what the business is worth each year.
        Free cash flow per share reaches {money(result?.exitFcfPerShare, code)} by then, valued at {inputs.useMultiple ? `${inputs.exitMultiple.toFixed(1)}×` : `a ${percent(inputs.exitYield)} yield`}.
        Nothing here is discounted at a cost of capital: the desired return is the discount rate.
      </p>
    </section>
  </div>;
}
