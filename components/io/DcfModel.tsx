"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import type { IoQuote } from "./quote";
import type { BusinessType } from "@/lib/types";
import { balanceSheetIsTheBusiness } from "@/lib/business-type";
import { terminalConsistency } from "@/lib/io/full-dcf";
import type { ChartData, Preset } from "@/lib/term/fundamental-charts";
import {
  YEARS, assumptionsFrom, dcfFoundation, defaultDrivers, impliedGrowth, justifiedBook, scenarioDrivers, sensitivityGrid, valueWith,
  type DcfFoundation, type Drivers, type Scenario,
} from "@/lib/io/dcf-model";
import { ComboChart } from "@/components/term/FundamentalCharts";
import { useCostOfEquity } from "./use-cost-of-equity";
import { ABSENT, money, price as writePrice } from "./format";

/**
 * The discounted cash flow, as a workbench: the answer first (value per share
 * in three cases, against the price, and the growth the price already asks
 * for), the levers that move it beside it with the company's own record next
 * to each, then what the answer is made of — the years, the bridge from cash
 * to a share, and how far it moves on the two assumptions that move it most.
 *
 * Every lever starts on the company's record (lib/io/dcf-model.ts); a lever
 * the reader moves is kept for that company on this device. A lender gets the
 * model that fits it: justified price-to-book.
 */

const pct = (value: number | null | undefined, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${(value * 100).toFixed(places)}%`);
const signed = (value: number | null | undefined, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(places)}%`);
const dir = (value: number | null | undefined) => (value == null || value === 0 ? undefined : value > 0 ? "up" : "down");

type Overrides = Partial<Drivers>;
interface Saved { scenario: Scenario; overrides: Overrides }
const storeKey = (ticker: string) => `finscope.dcf.v2.${ticker.toUpperCase()}`;
function readSaved(ticker: string): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(storeKey(ticker)) ?? "null") as Saved | null;
    if (parsed && ["bear", "base", "bull"].includes(parsed.scenario) && typeof parsed.overrides === "object") return parsed;
  } catch { /* a fresh model */ }
  return { scenario: "base", overrides: {} };
}
function writeSaved(ticker: string, saved: Saved) {
  try { localStorage.setItem(storeKey(ticker), JSON.stringify(saved)); } catch { /* this visit only */ }
}

export function DcfModel({ view, quote, fullPage = false }: { view: IoCompanyView; quote: IoQuote | null; fullPage?: boolean }) {
  const ticker = view.company.ticker;
  const coe = useCostOfEquity(ticker);
  const lender = balanceSheetIsTheBusiness((view.company.businessType ?? undefined) as BusinessType | undefined);
  const foundation = useMemo(() => (lender ? null : dcfFoundation(view)), [view, lender]);
  const price = quote?.price ?? null;
  const currency = quote?.currency ?? view.company.currency;

  if (lender) return <LenderModel view={view} price={price} currency={currency} costOfEquity={coe.value?.rate ?? null} settled={coe.settled} />;
  if (!foundation) return <section className="section dcf"><p className="stat-note">This filer has no revenue or share count to build a discounted cash flow on.</p></section>;
  return <Workbench key={ticker} view={view} foundation={foundation} price={price} currency={currency} coe={coe} fullPage={fullPage} />;
}

function Workbench({ view, foundation, price, currency, coe, fullPage }: {
  view: IoCompanyView; foundation: DcfFoundation; price: number | null; currency: string;
  coe: ReturnType<typeof useCostOfEquity>; fullPage: boolean;
}) {
  const ticker = view.company.ticker;
  const [saved, setSaved] = useState<Saved>(() => readSaved(ticker));
  const update = (next: Saved) => { setSaved(next); writeSaved(ticker, next); };
  const marketCap = price != null ? price * foundation.base.dilutedShares : null;
  const riskFree = coe.value?.riskFree ?? coe.market?.riskFree ?? null;
  const defaults = useMemo(() => defaultDrivers(foundation, coe.value?.rate ?? null, marketCap, riskFree), [foundation, coe.value, marketCap, riskFree]);
  const drivers = useMemo<Drivers>(() => ({ ...scenarioDrivers(defaults, saved.scenario), ...saved.overrides }), [defaults, saved]);
  const result = useMemo(() => valueWith(foundation, drivers), [foundation, drivers]);
  const cases = useMemo(() => ({
    bear: valueWith(foundation, { ...scenarioDrivers(defaults, "bear"), ...saved.overrides }).intrinsicValuePerShare,
    base: valueWith(foundation, { ...defaults, ...saved.overrides }).intrinsicValuePerShare,
    bull: valueWith(foundation, { ...scenarioDrivers(defaults, "bull"), ...saved.overrides }).intrinsicValuePerShare,
  }), [foundation, defaults, saved.overrides]);
  const implied = useMemo(() => (price ? impliedGrowth(foundation, drivers, price) : null), [foundation, drivers, price]);
  const value = result.intrinsicValuePerShare;
  const upside = value != null && price ? value / price - 1 : null;
  const consistency = terminalConsistency(result, assumptionsFrom(drivers, foundation));
  const set = (key: keyof Drivers, next: number | string) => update({ ...saved, overrides: { ...saved.overrides, [key]: next } });
  const record = foundation.record;
  const edited = Object.keys(saved.overrides).length > 0;

  return (
    <section className="section dcf" aria-label="Discounted cash flow">
      <div className="grid-ruled stats dcf-strip">
        <Figure label={`Fair value · ${saved.scenario}`} value={value == null ? ABSENT : writePrice(value, currency)} note={price != null ? `Price ${writePrice(price, currency)}` : "No price"} big />
        <Figure label="The price asks for" value={implied == null ? ABSENT : `${pct(implied)} growth a year`} tone={implied == null || record.growth5 == null ? undefined : implied <= record.growth5 ? "up" : "down"} note={`Revenue, years 1–5, everything else as set · delivered ${pct(record.growth5)} a year over 5 years`} />
        <Figure label="Against the price" value={signed(upside)} tone={dir(upside)} note={upside == null ? undefined : upside >= 0 ? "Value above the price, on these assumptions" : "Price above the value, on these assumptions"} />
        <Figure label="Bear · base · bull" value={[cases.bear, cases.base, cases.bull].map((entry) => (entry == null ? ABSENT : writePrice(entry, currency))).join(" · ")} note="Growth and margin ±3 points, the rate ∓1" />
        <Figure label="Discount rate (WACC)" value={pct(drivers.wacc)} note={coe.value ? `Equity ${pct(coe.value.rate)} = 10Y ${pct(coe.value.riskFree, 2)} + β ${coe.value.beta.toFixed(2)}${coe.value.beta < 0.6 ? " (floored at 0.6)" : ""} × ${pct(coe.value.premium, 1)}${coe.market && !coe.market.fallback ? " (S&P 500's premium today)" : ""}` : coe.settled ? "Beta unavailable: 9% cost of equity" : "Measuring the beta…"} />
        <Figure label="Terminal value" value={pct(result.terminalValueWeight, 0)} note="Share of the enterprise value beyond year 10" tone={result.terminalValueWeight != null && result.terminalValueWeight > 0.75 ? "down" : undefined} />
      </div>

      <div className="dcf-grid">
        <div className="dcf-levers">
          <div className="dcf-levers-head">
            <div className="seg" role="group" aria-label="Case">
              {(["bear", "base", "bull"] as const).map((scenario) => (
                <button key={scenario} type="button" aria-pressed={saved.scenario === scenario} onClick={() => update({ ...saved, scenario })}>{scenario[0].toUpperCase() + scenario.slice(1)}</button>
              ))}
            </div>
            {edited ? <button type="button" className="t-chip" onClick={() => update({ ...saved, overrides: {} })}>Reset to the record</button> : <span className="t-dim">On the company&apos;s record</span>}
          </div>
          <table className="dcf-lever-table">
            <tbody>
              <Lever label="Revenue growth, year 1" value={drivers.growthStart} onChange={(next) => set("growthStart", next)} hint={`Last 12 months ${pct(foundation.now.growth)} · 3Y ${pct(record.growth3)} · 5Y ${pct(record.growth5)}`} edited={"growthStart" in saved.overrides} />
              <Lever label="Revenue growth, year 5" value={drivers.growthEnd} onChange={(next) => set("growthEnd", next)} hint={`10Y ${pct(record.growth10)} · then fades to terminal`} edited={"growthEnd" in saved.overrides} />
              <Lever label="Operating margin, year 5" value={drivers.marginTarget} onChange={(next) => set("marginTarget", next)} hint={`Now ${pct(foundation.startMargin)} · 5Y avg ${pct(record.margin5)} · best ${pct(record.marginHigh)}${foundation.marginNote ? ` · ${foundation.marginNote}` : ""}`} edited={"marginTarget" in saved.overrides} />
              <Lever label="Tax rate" value={drivers.taxRate} onChange={(next) => set("taxRate", next)} hint={`5Y effective ${pct(record.tax5)}`} edited={"taxRate" in saved.overrides} />
              <Lever label="Capex / revenue, year 5" value={drivers.capex} onChange={(next) => set("capex", next)} hint={`Now ${pct(foundation.now.capex)} · 5Y ${pct(record.capex5)} · 10Y median ${pct(record.capex10)} · then what growth needs`} edited={"capex" in saved.overrides} />
              <Lever label="D&A / revenue, year 5" value={drivers.depreciation} onChange={(next) => set("depreciation", next)} hint={`Now ${pct(foundation.now.depreciation)} · 5Y ${pct(record.depreciation5)}`} edited={"depreciation" in saved.overrides} />
              <Lever label="Δ working capital / revenue" value={drivers.workingCapital} onChange={(next) => set("workingCapital", next)} hint={`5Y median ${pct(record.workingCapital5)}`} edited={"workingCapital" in saved.overrides} />
              <Lever label="Dilution a year" value={drivers.dilution} onChange={(next) => set("dilution", next)} hint={`5Y ${signed(record.dilution5)} · buybacks are in the cash already`} edited={"dilution" in saved.overrides} />
              <Lever label="Discount rate (WACC)" value={drivers.wacc} onChange={(next) => set("wacc", next)} hint={`Debt ${pct(record.costOfDebt)} before tax`} edited={"wacc" in saved.overrides} />
              <tr>
                <th scope="row">Terminal value</th>
                <td colSpan={2}>
                  <div className="seg" role="group" aria-label="Terminal method">
                    <button type="button" aria-pressed={drivers.terminalMethod === "perpetual-growth"} onClick={() => set("terminalMethod", "perpetual-growth")}>Growth</button>
                    <button type="button" aria-pressed={drivers.terminalMethod === "exit-multiple"} onClick={() => set("terminalMethod", "exit-multiple")}>Exit multiple</button>
                  </div>
                </td>
              </tr>
              {drivers.terminalMethod === "perpetual-growth"
                ? <Lever label="Growth for ever" value={drivers.terminalGrowth} onChange={(next) => set("terminalGrowth", next)} hint={`The 10Y less 2 points, between 2.5% and 3.5%${riskFree != null ? ` (10Y ${pct(riskFree, 2)})` : ""}`} edited={"terminalGrowth" in saved.overrides} />
                : <Lever label="Exit EV / FCF" value={drivers.exitMultiple} multiple onChange={(next) => set("exitMultiple", next)} hint="VAL shows the company's own range" edited={"exitMultiple" in saved.overrides} />}
            </tbody>
          </table>
        </div>
        <div className="dcf-right">
          <ProjectionChart foundation={foundation} result={result} currency={currency} />
          <Bridge result={result} foundation={foundation} currency={currency} />
        </div>
      </div>

      <div className="dcf-grid dcf-sensitivity">
        <Sensitivity title="Value per share · rate against terminal growth" foundation={foundation} drivers={drivers} price={price} currency={currency}
          rows={{ key: "wacc", label: "WACC", values: [-0.02, -0.01, 0, 0.01, 0.02].map((step) => drivers.wacc + step) }}
          columns={drivers.terminalMethod === "perpetual-growth"
            ? { key: "terminalGrowth", label: "Terminal g", values: [-0.01, -0.005, 0, 0.005, 0.01].map((step) => drivers.terminalGrowth + step) }
            : { key: "exitMultiple", label: "Exit ×", values: [-0.3, -0.15, 0, 0.15, 0.3].map((step) => drivers.exitMultiple * (1 + step)), multiple: true }} />
        <Sensitivity title="Value per share · growth against margin" foundation={foundation} drivers={drivers} price={price} currency={currency}
          rows={{ key: "growthStart", label: "Growth Y1", values: [-0.06, -0.03, 0, 0.03, 0.06].map((step) => drivers.growthStart + step) }}
          columns={{ key: "marginTarget", label: "Margin Y5", values: [-0.06, -0.03, 0, 0.03, 0.06].map((step) => drivers.marginTarget + step) }} />
      </div>

      <div className="sheet dcf-table">
        <table>
          <thead>
            <tr>
              <th className="key" scope="col">{foundation.basePeriod.label} → year</th>
              {result.projections.map((row) => <th key={row.year} scope="col">{row.year}</th>)}
            </tr>
          </thead>
          <tbody>
            <Row label="Revenue" values={result.projections.map((row) => money(row.revenue, currency))} />
            <Row label="Growth" values={result.projections.map((row) => pct(row.revenueGrowth))} />
            <Row label="Operating margin" values={result.projections.map((row) => pct(row.operatingMargin))} />
            <Row label="NOPAT" values={result.projections.map((row) => money(row.nopat, currency))} />
            <Row label="Reinvestment" values={result.projections.map((row) => money(row.capex - row.depreciation + row.changeInWorkingCapital, currency))} />
            <Row label="Free cash flow" values={result.projections.map((row) => money(row.freeCashFlow, currency))} strong />
            <Row label="Discounted" values={result.projections.map((row) => money(row.presentValue, currency))} />
          </tbody>
        </table>
      </div>

      <ul className="dcf-checks">
        <li data-tone={consistency.state === "coherent" ? "good" : consistency.state === "not-applicable" ? undefined : "bad"}>{consistency.message}</li>
        {result.warnings.filter((warning) => !warning.startsWith("Exit multiple is a relative")).map((warning) => <li key={warning} data-tone="bad">{warning}</li>)}
      </ul>
      <p className="stat-note">
        Base: {foundation.basePeriod.label} as filed — revenue {money(foundation.base.revenue, currency)}, cash and short-term investments {money(foundation.base.cash, currency)}, debt {money(foundation.base.debt, currency)}, {(foundation.base.dilutedShares / 1e6).toFixed(0)}M diluted shares.
        Free cash flow to the firm is NOPAT less capital spending net of depreciation and the change in working capital, discounted at the WACC over {YEARS} years.
        {fullPage ? null : <> <a href={`/t/dcf?s=${encodeURIComponent(view.company.ticker)}`}>Open the model full screen →</a></>}
      </p>
    </section>
  );
}

function Figure({ label, value, note, tone, big }: { label: string; value: string; note?: string; tone?: string; big?: boolean }) {
  return (
    <div className="stat" data-big={big || undefined}>
      <div className="label">{label}</div>
      <div className="stat-value" data-dir={tone} data-empty={value === ABSENT}>{value}</div>
      {note ? <p className="stat-note">{note}</p> : null}
    </div>
  );
}

/** One lever: a number in percent (or times), stepped by half a point, with the record beside it. */
function Lever({ label, value, onChange, hint, edited, multiple = false }: { label: string; value: number; onChange: (next: number) => void; hint: string; edited: boolean; multiple?: boolean }) {
  const shown = Number((multiple ? value : value * 100).toFixed(1));
  return (
    <tr data-edited={edited || undefined}>
      <th scope="row">{label}</th>
      <td>
        <span className="dcf-input">
          <button type="button" aria-label={`Lower ${label}`} onClick={() => onChange(multiple ? value - 1 : value - 0.005)}>−</button>
          <input type="number" step={multiple ? 1 : 0.5} value={shown} aria-label={label}
            onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next) && event.target.value !== "") onChange(multiple ? next : next / 100); }} />
          <span>{multiple ? "×" : "%"}</span>
          <button type="button" aria-label={`Raise ${label}`} onClick={() => onChange(multiple ? value + 1 : value + 0.005)}>+</button>
        </span>
      </td>
      <td className="dcf-hint">{hint}</td>
    </tr>
  );
}

function Row({ label, values, strong }: { label: string; values: string[]; strong?: boolean }) {
  return (
    <tr data-strong={strong || undefined}>
      <th className="key" scope="row">{label}</th>
      {values.map((value, index) => <td key={index}>{value}</td>)}
    </tr>
  );
}

/** Revenue and free cash flow, filed then projected, on one chart. */
function ProjectionChart({ foundation, result, currency }: { foundation: DcfFoundation; result: ReturnType<typeof valueWith>; currency: string }) {
  const history = foundation.record.years;
  const baseYear = Number(foundation.basePeriod.end.slice(0, 4));
  const labels = [...history.map((year) => `FY${year.end.slice(2, 4)}`), ...result.projections.map((row) => `${String(baseYear + row.year).slice(2)}E`)];
  const blank = (count: number) => Array.from({ length: count }, () => null);
  const data: ChartData = {
    labels,
    names: [...history.map((year) => `${year.label} · filed`), ...result.projections.map((row) => `Year ${row.year} · projected`)],
    series: [
      { spec: { id: "rev-filed", label: "Revenue, filed", kind: "bar", axis: "left", color: "var(--c6)", value: () => null }, values: [...history.map((year) => year.revenue), ...blank(result.projections.length)] },
      { spec: { id: "rev-proj", label: "Revenue, projected", kind: "bar", axis: "left", color: "var(--c3)", value: () => null }, values: [...blank(history.length), ...result.projections.map((row) => row.revenue)] },
      { spec: { id: "fcf", label: "Free cash flow (right)", kind: "line", axis: "right", color: "var(--gain)", value: () => null }, values: [...history.map((year) => year.freeCashFlow), ...result.projections.map((row) => row.freeCashFlow)] },
    ],
  };
  const preset: Preset = { id: "dcf-projection", title: "Revenue and free cash flow", left: "currency", right: "currency", series: data.series.map((entry) => entry.spec) };
  return (
    <figure className="t-gf-card dcf-chart">
      <figcaption><h3>Revenue and free cash flow · filed, then projected</h3></figcaption>
      <ComboChart preset={preset} data={data} currency={currency} height={230} />
      <ul className="t-gf-legend">
        {data.series.map((entry) => <li key={entry.spec.id} data-kind={entry.spec.kind} style={{ "--key": entry.spec.color } as CSSProperties}><i aria-hidden="true" />{entry.spec.label}</li>)}
      </ul>
    </figure>
  );
}

/** From the cash the business makes to the value of one share. */
function Bridge({ result, foundation, currency }: { result: ReturnType<typeof valueWith>; foundation: DcfFoundation; currency: string }) {
  const steps = [
    { label: `${YEARS} years of free cash flow, discounted`, value: result.presentValueForecast },
    { label: "The years after, discounted", value: result.presentValueTerminal },
    { label: "Plus cash and short-term investments", value: foundation.base.cash },
    { label: "Less debt", value: -foundation.base.debt },
    { label: "Equity value", value: result.equityValue, total: true },
  ];
  const reach = Math.max(...steps.map((step) => Math.abs(step.value ?? 0)), 1);
  return (
    <div className="dcf-bridge">
      <div className="label">From cash to a share</div>
      {steps.map((step) => (
        <div key={step.label} className="dcf-bridge-row" data-total={step.total || undefined}>
          <span>{step.label}</span>
          <span className="dcf-bridge-track"><i data-dir={step.value != null && step.value < 0 ? "down" : "up"} style={{ width: `${(Math.abs(step.value ?? 0) / reach) * 100}%` }} /></span>
          <b>{step.value == null ? ABSENT : money(step.value, currency)}</b>
        </div>
      ))}
      <div className="dcf-bridge-row" data-total>
        <span>÷ {(result.valuationShares / 1e6).toFixed(0)}M shares</span>
        <span />
        <b>{result.intrinsicValuePerShare == null ? ABSENT : writePrice(result.intrinsicValuePerShare, currency)}</b>
      </div>
    </div>
  );
}

function Sensitivity({ title, foundation, drivers, price, currency, rows, columns }: {
  title: string; foundation: DcfFoundation; drivers: Drivers; price: number | null; currency: string;
  rows: { key: keyof Drivers; label: string; values: number[]; multiple?: boolean };
  columns: { key: keyof Drivers; label: string; values: number[]; multiple?: boolean };
}) {
  const grid = useMemo(() => sensitivityGrid(foundation, drivers, rows, columns), [foundation, drivers, rows, columns]);
  const head = (value: number, multiple?: boolean) => (multiple ? `${value.toFixed(1)}×` : pct(value));
  return (
    <div className="sheet dcf-sens">
      <table>
        <caption className="label">{title}</caption>
        <thead>
          <tr><th className="key" scope="col">{rows.label} ↓ · {columns.label} →</th>{columns.values.map((value) => <th key={value} scope="col">{head(value, columns.multiple)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.values.map((row, r) => (
            <tr key={row}>
              <th className="key" scope="row">{head(row, rows.multiple)}</th>
              {grid[r].map((value, c) => {
                const gap = value != null && price ? value / price - 1 : null;
                const centre = r === Math.floor(rows.values.length / 2) && c === Math.floor(columns.values.length / 2);
                return (
                  <td key={c} data-centre={centre || undefined}
                    style={gap == null ? undefined : { background: `color-mix(in srgb, ${gap >= 0 ? "var(--gain)" : "var(--loss)"} ${Math.round(Math.min(1, Math.abs(gap) / 0.5) * 40)}%, transparent)` }}>
                    {value == null ? ABSENT : writePrice(value, currency)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A lender: justified price-to-book, with its two drivers as the grid. */
function LenderModel({ view, price, currency, costOfEquity, settled }: { view: IoCompanyView; price: number | null; currency: string; costOfEquity: number | null; settled: boolean }) {
  const [growth, setGrowth] = useState(0.03);
  const rate = costOfEquity ?? 0.1;
  const model = justifiedBook(view, rate, growth);
  if (!model) return <section className="section dcf"><p className="stat-note">A lender is valued on its book and its return on it; this one&apos;s equity or return on equity is not filed in a form that can be read.</p></section>;
  const upside = price ? model.value / price - 1 : null;
  return (
    <section className="section dcf" aria-label="Justified price to book">
      <div className="grid-ruled stats dcf-strip">
        <Figure label="Fair value · justified P/B" value={writePrice(model.value, currency)} note={price != null ? `Price ${writePrice(price, currency)}` : undefined} big />
        <Figure label="Against the price" value={signed(upside)} tone={dir(upside)} />
        <Figure label="Justified P/B" value={`${model.multiple.toFixed(2)}×`} note={`(ROE − g) / (r − g); trades at ${price ? (price / model.bookPerShare).toFixed(2) : ABSENT}×`} />
        <Figure label="Return on equity · 5Y" value={pct(model.roe)} />
        <Figure label="Cost of equity" value={pct(rate)} note={costOfEquity ? "Measured beta on the 10-year Treasury" : settled ? "Beta unavailable: 10%" : "Measuring the beta…"} />
        <Figure label="Book per share" value={writePrice(model.bookPerShare, currency)} />
      </div>
      <table className="dcf-lever-table">
        <tbody>
          <Lever label="Growth of book for ever" value={growth} onChange={setGrowth} hint="The rate the bank can grow its equity at while earning its ROE" edited={growth !== 0.03} />
        </tbody>
      </table>
      <p className="stat-note">A bank&apos;s operating cash flow is its loans and deposits moving, so a cash-flow model does not describe it. A bank earning its cost of equity is worth its book; one earning more is worth more, in proportion to the spread it keeps as it grows.</p>
    </section>
  );
}
