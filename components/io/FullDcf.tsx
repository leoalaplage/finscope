"use client";

import { useMemo, useState } from "react";
import { dcfToCsv, sensitivityMatrix, type DcfAssumptions, type ScenarioName } from "@/lib/dcf";
import {
  defaultFullDcfScenarios,
  fullDcfBase,
  fullDcfFoundation,
  scenarioResults,
  terminalConsistency,
  type DcfScenarioSet,
} from "@/lib/io/full-dcf";
import type { IoCompanyView } from "@/lib/io/view";
import { balanceSheetIsTheBusiness, businessTypeLabel } from "@/lib/business-type";
import type { BusinessType } from "@/lib/types";
import type { IoQuote } from "./quote";
import { ABSENT, count, delta, money, percent, price } from "./format";

const CASES: ScenarioName[] = ["bear", "base", "bull"];

interface SharedDcf {
  v: 1;
  ticker: string;
  active: ScenarioName;
  scenarios: DcfScenarioSet;
}

interface FullDcfProps {
  view: IoCompanyView;
  quote: IoQuote | null;
  search: string;
  quickFair: { low: number; high: number } | null;
  quickRate: number;
  quickGrowth: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isCase = (value: unknown): value is ScenarioName => value === "bear" || value === "base" || value === "bull";

function validAssumptions(value: unknown): value is DcfAssumptions {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DcfAssumptions>;
  const paths = [item.revenueGrowth, item.operatingMargin, item.taxRate, item.depreciationPercentRevenue,
    item.capexPercentRevenue, item.workingCapitalPercentRevenue, item.directFcfMargin, item.shareChange];
  return (item.method === "fcff" || item.method === "direct-fcf")
    && (item.terminalMethod === "perpetual-growth" || item.terminalMethod === "exit-multiple")
    && finite(item.forecastYears) && item.forecastYears >= 1 && item.forecastYears <= 30
    && finite(item.wacc) && finite(item.terminalGrowth) && finite(item.exitMultiple) && finite(item.otherClaims)
    && paths.every((path) => Array.isArray(path) && path.length > 0 && path.length <= 30 && path.every(finite));
}

function packedJson(value: SharedDcf) {
  const json = JSON.stringify(value, (_key, item) => typeof item === "number" ? Number(item.toFixed(6)) : item);
  return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function unpackedJson(token: string): unknown {
  const standard = token.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "=")));
}

export function encodeFullDcf(ticker: string, active: ScenarioName, scenarios: DcfScenarioSet) {
  return packedJson({ v: 1, ticker, active, scenarios });
}

export function decodeFullDcf(search: string, ticker: string): SharedDcf | null {
  const token = new URLSearchParams(search).get("d");
  if (!token) return null;
  try {
    const item = unpackedJson(token) as Partial<SharedDcf>;
    if (item.v !== 1 || item.ticker !== ticker || !isCase(item.active) || !item.scenarios) return null;
    if (!CASES.every((name) => validAssumptions(item.scenarios?.[name]))) return null;
    return item as SharedDcf;
  } catch {
    return null;
  }
}

const titleCase = (value: ScenarioName) => value[0].toUpperCase() + value.slice(1);
const first = (values: number[]) => values[0] ?? 0;
const repeat = (value: number, years: number) => Array.from({ length: years }, () => value);
const resize = (values: number[], years: number) => Array.from({ length: years }, (_, index) => values[index] ?? values.at(-1) ?? 0);

function updateEvery(assumptions: DcfAssumptions, key: keyof DcfAssumptions, value: number): DcfAssumptions {
  if (!Array.isArray(assumptions[key])) return { ...assumptions, [key]: value };
  return { ...assumptions, [key]: repeat(value, assumptions.forecastYears) };
}

function inputNumber(event: React.ChangeEvent<HTMLInputElement>, scale = 1) {
  const next = Number(event.target.value);
  return Number.isFinite(next) ? next / scale : null;
}

function assumptionLabel(name: keyof DcfAssumptions) {
  return ({
    revenueGrowth: "Revenue growth",
    operatingMargin: "Operating margin",
    taxRate: "Tax rate",
    depreciationPercentRevenue: "D&A / revenue",
    capexPercentRevenue: "Capex / revenue",
    workingCapitalPercentRevenue: "Δ NWC / revenue",
    directFcfMargin: "Direct FCF margin",
    shareChange: "Annual dilution",
    wacc: "WACC",
    terminalGrowth: "Terminal growth",
    forecastYears: "Forecast years",
    exitMultiple: "Exit multiple",
    otherClaims: "Other claims",
    method: "Cash-flow method",
    terminalMethod: "Terminal method",
  } satisfies Record<keyof DcfAssumptions, string>)[name];
}

export function FullDcf({ view, quote, search, quickFair, quickRate, quickGrowth }: FullDcfProps) {
  const defaults = useMemo(() => defaultFullDcfScenarios(view), [view]);
  const shared = useMemo(() => decodeFullDcf(search, view.company.ticker), [search, view.company.ticker]);
  const [scenarios, setScenarios] = useState<DcfScenarioSet | null>(() => shared?.scenarios ?? defaults);
  const [active, setActive] = useState<ScenarioName>(() => shared?.active ?? "base");
  const [copied, setCopied] = useState(false);
  const base = useMemo(() => fullDcfBase(view), [view]);
  const foundation = useMemo(() => fullDcfFoundation(view), [view]);
  const results = useMemo(() => scenarios ? scenarioResults(view, scenarios) : null, [view, scenarios]);
  const businessType = (view.company.businessType ?? undefined) as BusinessType | undefined;

  if (!base || !defaults || !scenarios || !results) {
    return <div className="state"><p>{balanceSheetIsTheBusiness(businessType)
      ? `FCFF and net debt are not comparable measures for this ${businessTypeLabel(businessType)}, so the operating DCF is withheld.`
      : "A full operating DCF cannot be built from the filed revenue, margin, cash, debt and share count."}</p></div>;
  }

  const assumptions = scenarios[active];
  const result = results[active];
  const consistency = terminalConsistency(result, assumptions);
  const currency = view.company.currency;
  const marketPrice = quote?.currency === currency ? quote.price : null;
  const gap = result.intrinsicValuePerShare != null && marketPrice != null && marketPrice > 0
    ? result.intrinsicValuePerShare / marketPrice - 1
    : null;
  const last = view.annual.at(-1);
  const waccAxis = [-.01, -.005, 0, .005, .01].map((move) => Math.max(.01, assumptions.wacc + move));
  const terminalAxis = assumptions.terminalMethod === "perpetual-growth"
    ? [-.005, -.0025, 0, .0025, .005].map((move) => assumptions.terminalGrowth + move)
    : [-2, -1, 0, 1, 2].map((move) => Math.max(1, assumptions.exitMultiple + move));
  const sensitivity = sensitivityMatrix(base, assumptions, waccAxis, terminalAxis);

  const writeAddress = (nextActive = active, nextScenarios = scenarios) => {
    const url = new URL(window.location.href);
    url.searchParams.set("s", view.company.ticker);
    url.searchParams.set("mode", "full");
    url.searchParams.set("case", nextActive);
    url.searchParams.set("d", encodeFullDcf(view.company.ticker, nextActive, nextScenarios));
    window.history.replaceState(null, "", url);
    return url.toString();
  };

  const select = (name: ScenarioName) => {
    setActive(name);
    writeAddress(name, scenarios);
  };

  const patch = (key: keyof DcfAssumptions, value: number) => {
    const next = { ...scenarios, [active]: updateEvery(assumptions, key, value) };
    setScenarios(next);
    writeAddress(active, next);
  };

  const patchOne = <K extends keyof DcfAssumptions>(key: K, value: DcfAssumptions[K]) => {
    const next = { ...scenarios, [active]: { ...assumptions, [key]: value } };
    setScenarios(next);
    writeAddress(active, next);
  };

  const patchYear = (key: keyof DcfAssumptions, index: number, value: number) => {
    const current = assumptions[key];
    if (!Array.isArray(current)) return;
    const path = [...current] as number[];
    path[index] = value;
    patchOne(key, path as DcfAssumptions[typeof key]);
  };

  const changeYears = (years: number) => {
    const safe = Math.max(1, Math.min(30, Math.round(years)));
    const keys: Array<keyof DcfAssumptions> = ["revenueGrowth", "operatingMargin", "taxRate", "depreciationPercentRevenue", "capexPercentRevenue", "workingCapitalPercentRevenue", "directFcfMargin", "shareChange"];
    const current: DcfAssumptions = { ...assumptions, forecastYears: safe };
    for (const key of keys) Object.assign(current, { [key]: resize(assumptions[key] as number[], safe) });
    const next = { ...scenarios, [active]: current };
    setScenarios(next);
    writeAddress(active, next);
  };

  const reset = () => {
    setScenarios(defaults);
    setActive("base");
    writeAddress("base", defaults);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(writeAddress());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const download = () => {
    const provenance = [
      `# FinScope full DCF · ${view.company.ticker} · ${titleCase(active)}`,
      `# Source: SEC filings normalized by FinScope; retrieved ${view.retrievedAt}`,
      `# Latest fiscal period: ${last?.label ?? ABSENT}; filed ${last?.filingDate ?? ABSENT}; accession ${last?.accession ?? ABSENT}`,
      dcfToCsv(result, assumptions),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([provenance], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${view.company.ticker.toLowerCase()}-${active}-dcf.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const percentInput = (key: keyof DcfAssumptions, value: number, min = -50, max = 100) => (
    <label className="full-dcf-field">
      <span className="label">{assumptionLabel(key)}</span>
      <span><input type="number" inputMode="decimal" step="0.1" min={min} max={max} value={Number((value * 100).toFixed(2))}
        onChange={(event) => { const next = inputNumber(event, 100); if (next != null) patch(key, next); }} />%</span>
    </label>
  );

  return (
    <section className="section full-dcf" style={{ borderTop: 0, paddingTop: 0 }}>
      <div className="section-head full-dcf-heading">
        <div>
          <h2 className="label">Operating value, after debt and cash</h2>
          <p className="full-dcf-kicker">FCFF discounted at WACC · every case travels with the URL</p>
        </div>
        <div className="full-dcf-actions">
          <button type="button" onClick={copy}>{copied ? "Copied" : "Copy scenario"}</button>
          <button type="button" onClick={download}>CSV + provenance</button>
          <button type="button" onClick={reset}>Reset</button>
        </div>
      </div>

      <div className="grid-ruled stats stats-three full-dcf-verdict">
        <div className="stat">
          <div className="label">{titleCase(active)} intrinsic value</div>
          <div className="stat-value stat-band" data-empty={result.intrinsicValuePerShare == null}>{price(result.intrinsicValuePerShare, currency)}</div>
          <div className="stat-note">equity value per reported share</div>
        </div>
        <div className="stat">
          <div className="label">Market price</div>
          <div className="stat-value stat-band" data-empty={marketPrice == null}>{price(marketPrice, currency)}</div>
          <div className="stat-note">{gap == null ? "no comparable quote" : `${delta(gap, 0)} to intrinsic value`}</div>
        </div>
        <div className="stat">
          <div className="label">Scenario range</div>
          <div className="stat-value stat-band">{price(results.bear.intrinsicValuePerShare, currency)} – {price(results.bull.intrinsicValuePerShare, currency)}</div>
          <div className="stat-note">Bear to Bull, not a confidence interval</div>
        </div>
      </div>

      <div className="full-dcf-cases" role="group" aria-label="DCF case">
        {CASES.map((name) => (
          <button type="button" key={name} aria-pressed={active === name} onClick={() => select(name)}>
            <span className="label">{titleCase(name)}</span>
            <strong>{price(results[name].intrinsicValuePerShare, currency)}</strong>
            <small>{percent(first(scenarios[name].revenueGrowth))} growth · {percent(scenarios[name].wacc)} WACC</small>
          </button>
        ))}
      </div>

      <div className="section-head full-dcf-assumption-head">
        <div><h3 className="label">Main assumptions · {titleCase(active)}</h3><p className="full-dcf-kicker">Edits apply across the selected case&rsquo;s forecast path.</p></div>
      </div>
      <div className="full-dcf-fields">
        <label className="full-dcf-field"><span className="label">Forecast years</span><input type="number" min={1} max={30} step={1} value={assumptions.forecastYears} onChange={(event) => { const next = inputNumber(event); if (next != null) changeYears(next); }} /></label>
        {percentInput("revenueGrowth", first(assumptions.revenueGrowth))}
        {percentInput("operatingMargin", first(assumptions.operatingMargin), 0, 100)}
        {percentInput("taxRate", first(assumptions.taxRate), 0, 100)}
        {percentInput("wacc", assumptions.wacc, 1, 30)}
        {assumptions.terminalMethod === "perpetual-growth" ? percentInput("terminalGrowth", assumptions.terminalGrowth, -2, 10) : null}
        {percentInput("shareChange", first(assumptions.shareChange), -20, 20)}
      </div>

      <div className="full-dcf-split">
        <div>
          <div className="section-head"><h3 className="label">Sensitivity</h3><span className="label">Rows WACC · columns {assumptions.terminalMethod === "perpetual-growth" ? "terminal growth" : "exit multiple"}</span></div>
          <div className="sheet full-dcf-sensitivity"><table><thead><tr><th className="key">WACC</th>{terminalAxis.map((item) => <th key={item}>{assumptions.terminalMethod === "perpetual-growth" ? percent(item) : `${item.toFixed(1)}×`}</th>)}</tr></thead><tbody>
            {waccAxis.map((wacc, row) => <tr key={wacc}><th className="key">{percent(wacc)}</th>{sensitivity[row].map((reading, column) => <td key={terminalAxis[column]} data-selected={row === 2 && column === 2}>{price(reading, currency)}</td>)}</tr>)}
          </tbody></table></div>
        </div>
        <div className="terminal-check" data-state={consistency.state}>
          <div className="label">Terminal consistency · {consistency.state.replace("-", " ")}</div>
          <dl>
            <div><dt>Reinvestment rate</dt><dd>{percent(consistency.reinvestmentRate)}</dd></div>
            <div><dt>Implied return on capital</dt><dd>{percent(consistency.impliedReturnOnCapital)}</dd></div>
            <div><dt>Excess return vs WACC</dt><dd>{delta(consistency.excessReturn)}</dd></div>
          </dl>
          <p>{consistency.message}</p>
        </div>
      </div>

      <details className="dcf-workings full-dcf-details">
        <summary><span className="label">What {last?.label ?? "FY reported"} reported</span></summary>
        <div className="grid-ruled full-dcf-reported">
          <div><span className="label">Revenue</span><strong>{money(last?.values.revenue, currency)}</strong></div>
          <div><span className="label">Operating margin</span><strong>{percent(last?.values.operatingMargin)}</strong></div>
          <div><span className="label">Free cash flow</span><strong>{money(last?.values.freeCashFlow, currency)}</strong></div>
          <div><span className="label">Cash / debt</span><strong>{money(base.cash, currency)} / {money(base.debt, currency)}</strong></div>
          <div><span className="label">Diluted shares</span><strong>{count(base.dilutedShares)}</strong></div>
          <div><span className="label">Filed</span><strong>{last?.filingDate ?? ABSENT}</strong></div>
        </div>
      </details>

      <details className="dcf-workings full-dcf-details">
        <summary><span className="label">What the record suggests</span></summary>
        <div className="sheet"><table><thead><tr><th className="key">Measure</th><th>Latest</th><th>3Y avg</th><th>5Y avg</th><th>10Y avg</th><th>Used initially</th></tr></thead><tbody>
          {foundation.map((row) => <tr key={row.metric}><th className="key"><span>{row.label}</span><small>{row.formula}</small></th><td>{percent(row.latest)}</td><td>{percent(row.average3)}</td><td>{percent(row.average5)}</td><td>{percent(row.average10)}</td><td>{percent(row.suggested)}</td></tr>)}
        </tbody></table></div>
      </details>

      <details className="dcf-workings full-dcf-details">
        <summary><span className="label">Every assumption and projected year</span></summary>
        <div className="full-dcf-fields full-dcf-fields-secondary">
          <label className="full-dcf-field"><span className="label">Cash-flow method</span><select value={assumptions.method} onChange={(event) => patchOne("method", event.target.value as DcfAssumptions["method"])}><option value="fcff">Reconstructed FCFF</option><option value="direct-fcf">Direct FCF fallback</option></select></label>
          <label className="full-dcf-field"><span className="label">Terminal method</span><select value={assumptions.terminalMethod} onChange={(event) => patchOne("terminalMethod", event.target.value as DcfAssumptions["terminalMethod"])}><option value="perpetual-growth">Perpetual growth</option><option value="exit-multiple">Exit multiple</option></select></label>
          {percentInput("depreciationPercentRevenue", first(assumptions.depreciationPercentRevenue), 0, 100)}
          {percentInput("capexPercentRevenue", first(assumptions.capexPercentRevenue), 0, 100)}
          {percentInput("workingCapitalPercentRevenue", first(assumptions.workingCapitalPercentRevenue))}
          {assumptions.method === "direct-fcf" ? percentInput("directFcfMargin", first(assumptions.directFcfMargin)) : null}
          {assumptions.terminalMethod === "exit-multiple" ? <label className="full-dcf-field"><span className="label">Exit multiple</span><span><input type="number" min={1} max={100} step="0.5" value={assumptions.exitMultiple} onChange={(event) => { const next = inputNumber(event); if (next != null) patchOne("exitMultiple", next); }} />×</span></label> : null}
          <label className="full-dcf-field"><span className="label">Other claims</span><input type="number" step="1000000" value={assumptions.otherClaims} onChange={(event) => { const next = inputNumber(event); if (next != null) patch("otherClaims", next); }} /></label>
        </div>
        <div className="grid-ruled full-dcf-value-bridge">
          <div><span className="label">Enterprise value</span><strong>{money(result.enterpriseValue, currency)}</strong></div>
          <div><span className="label">+ Cash</span><strong>{money(base.cash, currency)}</strong></div>
          <div><span className="label">− Debt</span><strong>{money(base.debt, currency)}</strong></div>
          <div><span className="label">− Other claims</span><strong>{money(assumptions.otherClaims, currency)}</strong></div>
          <div><span className="label">Equity value</span><strong>{money(result.equityValue, currency)}</strong></div>
          <div><span className="label">Valuation shares</span><strong>{count(result.valuationShares)}</strong></div>
        </div>
        <div className="sheet full-dcf-paths"><table><thead><tr><th className="key">Editable path</th>{result.projections.map((item) => <th key={item.year}>Year {item.year}</th>)}</tr></thead><tbody>
          {([[
            "Revenue growth", "revenueGrowth"], ["Operating margin", "operatingMargin"], ["Tax rate", "taxRate"], ["D&A / revenue", "depreciationPercentRevenue"], ["Capex / revenue", "capexPercentRevenue"], ["Δ NWC / revenue", "workingCapitalPercentRevenue"], ["Direct FCF margin", "directFcfMargin"], ["Share change", "shareChange"],
          ] as Array<[string, keyof DcfAssumptions]>).filter(([, key]) => assumptions.method === "direct-fcf" || key !== "directFcfMargin").map(([label, key]) => <tr key={key}><th className="key">{label}</th>{result.projections.map((item, index) => <td key={item.year}><span className="full-dcf-path-input"><input type="number" step="0.1" value={Number((((assumptions[key] as number[])[index] ?? 0) * 100).toFixed(2))} aria-label={`${label}, year ${item.year}`} onChange={(event) => { const next = inputNumber(event, 100); if (next != null) patchYear(key, index, next); }} />%</span></td>)}</tr>)}
        </tbody></table></div>
        <div className="sheet"><table><thead><tr><th className="key">Year</th><th>Revenue</th><th>Growth</th><th>Operating margin</th><th>NOPAT</th><th>FCFF</th><th>PV of FCFF</th></tr></thead><tbody>
          {result.projections.map((item) => <tr key={item.year}><th className="key">{item.year}</th><td>{money(item.revenue, currency)}</td><td>{percent(item.revenueGrowth)}</td><td>{percent(item.operatingMargin)}</td><td>{money(item.nopat, currency)}</td><td>{money(item.freeCashFlow, currency)}</td><td>{money(item.presentValue, currency)}</td></tr>)}
          <tr className="rule"><th className="key">Terminal</th><td colSpan={4}>{percent(result.terminalValueWeight, 0)} of enterprise value</td><td>{money(result.terminalValue, currency)}</td><td>{money(result.presentValueTerminal, currency)}</td></tr>
        </tbody></table></div>
        {result.warnings.length ? <ul className="full-dcf-warnings">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      </details>

      <section className="dcf-method-bridge" aria-labelledby="dcf-method-title">
        <div className="section-head"><div><h3 className="label" id="dcf-method-title">Why these values differ</h3><p className="full-dcf-kicker">They answer different questions with different cash-flow definitions.</p></div></div>
        <div className="sheet"><table><thead><tr><th className="key">Bridge</th><th>Quick view</th><th>Full model</th></tr></thead><tbody>
          <tr><th className="key">Cash flow</th><td>Filed free cash flow</td><td>FCFF from operating profit and reinvestment</td></tr>
          <tr><th className="key">Discount rate</th><td>Cost of equity · {percent(quickRate)}</td><td>WACC · {percent(assumptions.wacc)}</td></tr>
          <tr><th className="key">Growth</th><td>Historical / chosen · {percent(quickGrowth)}</td><td>Operating projection · {percent(first(assumptions.revenueGrowth))}</td></tr>
          <tr><th className="key">Output</th><td>{quickFair ? `${price(quickFair.low, currency)} – ${price(quickFair.high, currency)}` : ABSENT} fair-value band</td><td>{price(result.intrinsicValuePerShare, currency)} in the {titleCase(active)} case</td></tr>
        </tbody></table></div>
      </section>
    </section>
  );
}
