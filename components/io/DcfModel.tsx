"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import type { IoQuote } from "./quote";
import type { BusinessType } from "@/lib/types";
import { balanceSheetIsTheBusiness } from "@/lib/business-type";
import { terminalConsistency } from "@/lib/io/full-dcf";
import type { ChartData, Preset } from "@/lib/term/fundamental-charts";
import {
  STAGE_ONE, assumptionsFrom, dcfFoundation, dcfMissingInputs, defaultDrivers, forecastYears, impliedGrowth, justifiedBook, scenarioDrivers, sensitivityGrid, valueWith,
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
const storeKey = (ticker: string) => `finscope.dcf.v3.${ticker.toUpperCase()}`;
function readSaved(ticker: string): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(storeKey(ticker)) ?? "null") as Saved | null;
    if (parsed && ["bear", "base", "bull"].includes(parsed.scenario) && parsed.overrides != null && typeof parsed.overrides === "object" && Object.values(parsed.overrides).every(value => typeof value === "string" || typeof value === "number" && Number.isFinite(value) || value != null && typeof value === "object" && "growth" in value && "margin" in value && Array.isArray(value.growth) && Array.isArray(value.margin) && value.growth.length === 5 && value.margin.length === 5 && [...value.growth, ...value.margin].every(n => typeof n === "number" && Number.isFinite(n)))) return parsed;
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
  const matchingQuote = quote?.currency === view.company.currency ? quote : null;
  const price = matchingQuote?.price ?? null;
  const currency = view.company.currency;

  if (lender) return <LenderModel view={view} price={price} currency={currency} costOfEquity={coe.value?.rate ?? null} settled={coe.settled} />;
  if (!foundation) return <section className="section dcf"><p className="stat-note">A DCF is unavailable until the latest period supplies: {dcfMissingInputs(view).join(", ")}. Missing values are never treated as zero.</p></section>;
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
  const riskFree = coe.riskFree;
  const defaults = useMemo(() => defaultDrivers(foundation, coe.value?.rate ?? null, marketCap, riskFree), [foundation, coe.value, marketCap, riskFree]);
  const baseDrivers = useMemo<Drivers>(() => ({ ...defaults, ...saved.overrides }), [defaults, saved.overrides]);
  const drivers = useMemo(() => scenarioDrivers(baseDrivers, saved.scenario), [baseDrivers, saved.scenario]);
  const result = useMemo(() => valueWith(foundation, drivers), [foundation, drivers]);
  const cases = useMemo(() => ({
    bear: valueWith(foundation, scenarioDrivers(baseDrivers, "bear")).intrinsicValuePerShare,
    base: valueWith(foundation, baseDrivers).intrinsicValuePerShare,
    bull: valueWith(foundation, scenarioDrivers(baseDrivers, "bull")).intrinsicValuePerShare,
  }), [foundation, baseDrivers]);
  const implied = useMemo(() => (price ? impliedGrowth(foundation, drivers, price) : null), [foundation, drivers, price]);
  const value = result.intrinsicValuePerShare;
  const upside = value != null && price ? value / price - 1 : null;
  const consistency = terminalConsistency(result, assumptionsFrom(drivers, foundation));
  const set = (key: keyof Drivers, next: number | string) => update({ scenario: "base", overrides: {
    ...saved.overrides,
    ...(saved.scenario !== "base" ? { growthStart: drivers.growthStart, growthEnd: drivers.growthEnd, marginTarget: drivers.marginTarget, salesToCapital: drivers.salesToCapital, ...(drivers.research ? { research: drivers.research } : {}) } : {}),
    [key]: next,
  } });
  const record = foundation.record;
  const edited = Object.keys(saved.overrides).length > 0;
  const assumptions = assumptionsFrom(drivers, foundation);
  const years = forecastYears(drivers);
  const research = baseDrivers.research;
  const capitalIssues = [
    !coe.value && !("wacc" in saved.overrides) ? `Discount rate uses an assumed 9% cost of equity: ${coe.unavailableReason ?? "market inputs loading"}.` : null,
    foundation.base.debt > 0 && record.costOfDebt == null ? "Cost of debt uses an assumed 5% before tax; a filed interest/debt ratio is unavailable." : null,
    price == null ? "No matching market price is available; market weights and price comparisons are unavailable." : null,
  ].filter((v): v is string => v != null);
  const warnings = [...foundation.issues, ...capitalIssues, ...result.warnings];
  const exportModel = () => {
    const blob = new Blob([JSON.stringify({ ticker, modelVersion: 3, exportedAt: new Date().toISOString(), case: saved.scenario, basePeriod: foundation.basePeriod, base: foundation.base, shareBasis: foundation.shareNote, quote: { price, currency }, drivers, assumptions, result, reconciliation: foundation.reconciliation, warnings, costOfCapital: { ...coe, methodology: "CAPM with aligned adjusted weekly returns; any index-implied premium is an estimate" } }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `${ticker}-dcf.json`; link.click(); URL.revokeObjectURL(url);
  };
  const useResearch = () => {
    const a = assumptionsFrom(baseDrivers, foundation);
    update({ scenario: "base", overrides: { ...saved.overrides, research: { growth: a.revenueGrowth.slice(0, 5), margin: a.operatingMargin.slice(0, 5) } } });
  };
  const changeResearch = (key: "growth" | "margin", year: number, value: number) => {
    if (!research) return;
    const values = [...research[key]]; values[year] = value;
    update({ scenario: "base", overrides: { ...saved.overrides, research: { ...research, [key]: values } } });
  };

  return (
    <section className="section dcf" aria-label="Discounted cash flow">
      <p className="stat-note" role="status">{research ? "Research assumptions" : "Automatic screening assumptions"} · {result.intrinsicValuePerShare == null ? "Model unavailable: resolve the checks below" : warnings.length ? "Review required: assumptions and data limitations below" : "Model calculated; forecasts still require investment judgment"}. Stock compensation remains an operating expense. <button type="button" className="t-chip" onClick={exportModel}>Export model</button></p>
      <div className="grid-ruled stats dcf-strip">
        <Figure label={`Indicative value · ${saved.scenario}`} value={value == null ? ABSENT : writePrice(value, currency)} note={price != null ? `Price ${writePrice(price, currency)}` : "No price"} big />
        <Figure label="The price asks for" value={implied == null ? ABSENT : `${pct(implied)} growth a year`} tone={implied == null || record.growth5 == null ? undefined : implied <= record.growth5 ? "up" : "down"} note={`Revenue, years 1–5, everything else as set · delivered ${pct(record.growth5)} a year over 5 years`} />
        <Figure label="Against the price" value={signed(upside)} tone={dir(upside)} note={upside == null ? undefined : upside >= 0 ? "Value above the price, on these assumptions" : "Price above the value, on these assumptions"} />
        <Figure label="Bear · base · bull" value={[cases.bear, cases.base, cases.bull].map((entry) => (entry == null ? ABSENT : writePrice(entry, currency))).join(" · ")} note="Business stresses: growth, margin and capital efficiency; common WACC and terminal assumptions" />
        <Figure label="Discount rate (WACC)" value={pct(drivers.wacc)} note={"wacc" in saved.overrides ? "User assumption" : coe.value ? `Equity ${pct(coe.value.rate)} = Treasury ${pct(coe.value.riskFree, 2)} + β ${coe.value.appliedBeta.toFixed(2)} × ${pct(coe.value.premium, 1)} · ${coe.premiumSource ?? "premium estimate"} · ${coe.observations} matched weeks` : coe.settled ? `Assumed 9% equity cost · ${coe.unavailableReason}` : "Provisional 9% equity cost; measuring market inputs…"} />
        <Figure label="Terminal value" value={pct(result.terminalValueWeight, 0)} note={`Share of enterprise value after year ${years}`} tone={result.terminalValueWeight != null && result.terminalValueWeight > 0.75 ? "down" : undefined} />
      </div>

      <div className="dcf-grid">
        <div className="dcf-levers">
          <div className="dcf-levers-head">
            <div className="seg" role="group" aria-label="Case">
              {(["bear", "base", "bull"] as const).map((scenario) => (
                <button key={scenario} type="button" aria-pressed={saved.scenario === scenario} onClick={() => update({ ...saved, scenario })}>{scenario[0].toUpperCase() + scenario.slice(1)}</button>
              ))}
            </div>
            {edited ? <button type="button" className="t-chip" onClick={() => update({ ...saved, overrides: {} })}>Reset to the record</button> : <span className="t-dim">Historical inputs · explicit assumptions</span>}
          </div>
          <table className="dcf-lever-table">
            <tbody>
              {!research ? <><Lever label="Revenue growth, year 1" value={drivers.growthStart} onChange={(next) => set("growthStart", next)} hint={`Last 12 months ${pct(foundation.now.growth)} · 3Y ${pct(record.growth3)} · 5Y ${pct(record.growth5)}`} edited={"growthStart" in saved.overrides} />
              <Lever label="Revenue growth, year 5" value={drivers.growthEnd} onChange={(next) => set("growthEnd", next)} hint={`10Y ${pct(record.growth10)} · then fades to terminal`} edited={"growthEnd" in saved.overrides} />
              <Lever label="Operating margin, year 5" value={drivers.marginTarget} onChange={(next) => set("marginTarget", next)} hint={`Before separately tagged intangible amortization, with SBC expensed. Now ${pct(foundation.startMargin)} · 5Y avg ${pct(record.margin5)} · best ${pct(record.marginHigh)}${foundation.marginNote ? ` · ${foundation.marginNote}` : ""}`} edited={"marginTarget" in saved.overrides} />
              </> : null}
              <Lever label="Tax rate" value={drivers.taxRate} onChange={(next) => set("taxRate", next)} hint={`5Y effective ${pct(record.tax5)}`} edited={"taxRate" in saved.overrides} />
              <Lever label="Terminal tax rate" value={drivers.terminalTaxRate} onChange={(next) => set("terminalTaxRate", next)} hint="Normalized tax on operating profit at maturity; historical rate until changed" edited={"terminalTaxRate" in saved.overrides} />
              <tr><th scope="row">Reinvestment</th><td colSpan={2}><div className="seg" role="group" aria-label="Reinvestment method"><button type="button" aria-pressed={drivers.reinvestmentMethod === "capital-efficiency"} onClick={() => set("reinvestmentMethod", "capital-efficiency")}>Capital efficiency</button><button type="button" aria-pressed={drivers.reinvestmentMethod === "reported-ratios"} onClick={() => set("reinvestmentMethod", "reported-ratios")}>Spending ratios</button></div></td></tr>
              {drivers.reinvestmentMethod === "capital-efficiency" ? <Lever label="Sales / operating capital" value={drivers.salesToCapital} multiple onChange={(next) => set("salesToCapital", next)} hint={`Historical median ${record.salesToCapital == null ? "unavailable; assumed 1×" : `${record.salesToCapital.toFixed(2)}×`}. Net investment = additional revenue / this ratio; no automatic asset liquidation on contraction.`} edited={"salesToCapital" in saved.overrides} /> : <>
              <Lever label="Capex / revenue, year 5" value={drivers.capex} onChange={(next) => set("capex", next)} hint={`Now ${pct(foundation.now.capex)} · 5Y ${pct(record.capex5)} · 10Y median ${pct(record.capex10)} · then what growth needs`} edited={"capex" in saved.overrides} />
              <Lever label="D&A / revenue, year 5" value={drivers.depreciation} onChange={(next) => set("depreciation", next)} hint={`Now ${pct(foundation.now.depreciation)} · 5Y ${pct(record.depreciation5)}`} edited={"depreciation" in saved.overrides} />
              <Lever label="Δ working capital / revenue" value={drivers.workingCapital} onChange={(next) => set("workingCapital", next)} hint={`Operating balances, 5Y median ${pct(record.workingCapital5)}; review coverage below`} edited={"workingCapital" in saved.overrides} />
              </>}

              <Lever label="Discount rate (WACC)" value={drivers.wacc} onChange={(next) => set("wacc", next)} hint={`Debt ${pct(record.costOfDebt)} before tax`} edited={"wacc" in saved.overrides} />
              <Lever label="Competitive fade, years" value={drivers.fadeYears} integer onChange={(next) => set("fadeYears", next)} hint="After five explicit years; 1–15 years until the mature state" edited={"fadeYears" in saved.overrides} />
              <Lever label="Terminal return above WACC" value={drivers.terminalExcessReturn} onChange={(next) => set("terminalExcessReturn", next)} hint={`0 points assumes competitive equilibrium. Terminal return ${pct(drivers.wacc + drivers.terminalExcessReturn)}; a permanent advantage needs explicit support.`} edited={"terminalExcessReturn" in saved.overrides} />
              <Lever label="Other equity claims" value={drivers.otherClaims} amount onChange={(next) => set("otherClaims", next)} hint="Currency units: reported minority interests / temporary equity, plus additional preferred, pension or option claims you identify" edited={"otherClaims" in saved.overrides} />
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

      <div className="sheet dcf-table">
        <div className="dcf-levers-head"><span className="label">First five years · operating assumptions</span><button type="button" className="t-chip" onClick={research ? () => { const { research: ignored, ...rest } = saved.overrides; void ignored; update({ scenario: "base", overrides: rest }); } : useResearch}>{research ? "Return to automatic path" : "Edit year by year"}</button></div>
        {research ? <table><thead><tr><th scope="col">Assumption</th>{Array.from({ length: STAGE_ONE }, (_, i) => <th scope="col" key={i}>Year {i + 1}</th>)}</tr></thead><tbody>{(["growth", "margin"] as const).map(key => <tr key={key}><th scope="row">{key === "growth" ? "Revenue growth" : "Operating margin before intangible amortization"}</th>{research[key].map((value, i) => <td key={i}><input type="number" step="0.5" aria-label={`${key === "growth" ? "Revenue growth" : "Operating margin"}, year ${i + 1}`} value={Number((value * 100).toFixed(2))} onChange={event => { if (event.target.value !== "" && Number.isFinite(Number(event.target.value))) changeResearch(key, i, Number(event.target.value) / 100); }} />%</td>)}</tr>)}</tbody></table> : <p className="stat-note">Automatic growth blends recent and historical results. Acquisition effects, guidance and analyst estimates are not operating forecasts until explicitly entered. Bear and bull are illustrative stresses, not probability estimates.</p>}
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
            <Row label="Operating margin · before intangible amortization" values={result.projections.map((row) => pct(row.operatingMargin))} />
            <Row label="NOPAT" values={result.projections.map((row) => money(row.nopat, currency))} />
            <Row label="Reinvestment" values={result.projections.map((row) => money(row.netReinvestment ?? row.capex - row.depreciation + row.changeInWorkingCapital, currency))} />
            <Row label="Free cash flow" values={result.projections.map((row) => money(row.freeCashFlow, currency))} strong />
            <Row label="Discounted" values={result.projections.map((row) => money(row.presentValue, currency))} />
          </tbody>
        </table>
      </div>

      <p className="stat-note">Normalized terminal year {years + 1}: FCFF {money(result.terminalCashFlow ?? null, currency)} · net reinvestment {money(result.terminalReinvestment ?? null, currency)} · return on new capital {pct(drivers.wacc + drivers.terminalExcessReturn)}. Treasury {riskFree == null ? "unavailable" : `${pct(riskFree, 2)} · ${coe.riskFreeDate} · ${coe.riskFreeSource}`}.</p>
      <ul className="dcf-checks">
        <li data-tone={consistency.state === "coherent" ? "good" : consistency.state === "not-applicable" ? undefined : "bad"}>{consistency.message}</li>
        {result.warnings.filter((warning) => !warning.startsWith("Exit multiple is a relative")).map((warning) => <li key={warning} data-tone="bad">{warning}</li>)}
      </ul>
      <details className="dcf-methodology"><summary>Sources, assumptions and cash-flow checks ({warnings.length})</summary><ul className="dcf-checks">{warnings.map((warning, i) => <li key={`${i}-${warning}`}>{warning}</li>)}</ul>
        <p className="stat-note">{foundation.shareNote} Historical share-count change {signed(record.dilution5)} is a diagnostic only; acquisition issuance and employee compensation are not extrapolated as a recurring dilution rate.</p>
        <p className="stat-note">{foundation.marginNote} Where intangible amortization is separately reported, the operating margin is normalized before that charge and D&A excludes the same amount. No future amortization tax shield is assumed; this is an operating normalization, not a forecast of GAAP earnings.</p>
        <p className="stat-note">Base operating FCFF {money(foundation.reconciliation.modeled, currency)} · cash-flow-statement proxy {money(foundation.reconciliation.cashFlowProxy, currency)} · unexplained / timing residual {money(foundation.reconciliation.residual, currency)}. {foundation.reconciliation.note}</p>
        <p className="stat-note">Growth, margins, taxes, capital efficiency and the duration of competitive advantage are valuation assumptions. This model does not automatically forecast future acquisitions or issuance proceeds, capitalize R&D, or value all outstanding options. Review the claims input and source filings.</p>
      </details>
      <p className="stat-note">
        Filed base: {foundation.basePeriod.label} as filed — revenue {money(foundation.base.revenue, currency)}, cash and short-term investments {money(foundation.base.cash, currency)}, debt {money(foundation.base.debt, currency)}, {(foundation.base.dilutedShares / 1e6).toFixed(0)}M diluted shares.
        Forecast FCFF is normalized operating profit after tax less net reinvestment, discounted at the WACC over {years} years. Losses receive no automatic cash-tax refund. Operating cash flow reported by the company and modeled FCFF have different financing, tax and compensation boundaries.
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
function Lever({ label, value, onChange, hint, edited, multiple = false, integer = false, amount = false }: { label: string; value: number; onChange: (next: number) => void; hint: string; edited: boolean; multiple?: boolean; integer?: boolean; amount?: boolean }) {
  const raw = multiple || integer || amount;
  const shown = Number((raw ? value : value * 100).toFixed(amount ? 0 : 2));
  const step = integer ? 1 : amount ? 1000000 : multiple ? .1 : .005;
  return (
    <tr data-edited={edited || undefined}>
      <th scope="row">{label}</th>
      <td>
        <span className="dcf-input">
          <button type="button" aria-label={`Lower ${label}`} onClick={() => onChange(value - step)}>−</button>
          <input type="number" step={raw ? step : .5} value={shown} aria-label={label}
            onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next) && event.target.value !== "") onChange(raw ? next : next / 100); }} />
          <span>{amount ? "" : integer ? "yr" : multiple ? "×" : "%"}</span>
          <button type="button" aria-label={`Raise ${label}`} onClick={() => onChange(value + step)}>+</button>
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
      { spec: { id: "fcf-filed", label: "Reported CFO less capex (right)", kind: "line", axis: "right", color: "var(--c5)", value: () => null }, values: [...history.map((year) => year.freeCashFlow), ...blank(result.projections.length)] },
      { spec: { id: "fcff-projected", label: "Modeled FCFF (right)", kind: "line", axis: "right", color: "var(--gain)", value: () => null }, values: [...blank(history.length), ...result.projections.map(row => row.freeCashFlow)] },
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
    { label: `${result.projections.length} years of free cash flow, discounted`, value: result.presentValueForecast },
    { label: "The years after, discounted", value: result.presentValueTerminal },
    { label: "Plus cash and short-term investments", value: foundation.base.cash },
    { label: "Less debt", value: -foundation.base.debt },
    { label: "Less other equity claims", value: -(result.enterpriseValue == null ? 0 : result.enterpriseValue + foundation.base.cash - foundation.base.debt - (result.equityValue ?? 0)) },
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
