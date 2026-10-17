import { calculateDcf, type DcfAssumptions, type DcfBase, type DcfResult } from "@/lib/dcf";
import { terminalGrowthFor } from "@/lib/implied-erp";
import { balanceSheetIsTheBusiness } from "@/lib/business-type";
import type { BusinessType } from "@/lib/types";
import type { IoCompanyView, IoPeriod } from "./view";

/** The operating DCF: five explicit years, an editable competitive fade, then a normalized terminal year. */
export const YEARS = 10;
export const STAGE_ONE = 5;
export interface Drivers {
  growthStart: number; growthEnd: number; marginTarget: number;
  taxRate: number; terminalTaxRate: number;
  capex: number; depreciation: number; workingCapital: number;
  /** Additional unfunded dilution only. Employee compensation remains expensed in operating profit. */
  dilution: number;
  wacc: number; terminalMethod: "perpetual-growth" | "exit-multiple";
  terminalGrowth: number; exitMultiple: number;
  fadeYears: number;
  /** Zero is the competitive equilibrium: return on new capital equals WACC. */
  terminalExcessReturn: number;
  reinvestmentMethod: "capital-efficiency" | "reported-ratios";
  salesToCapital: number;
  otherClaims: number;
  /** Optional explicit first-stage assumptions, shared by valuation, reverse DCF and sensitivities. */
  research?: { growth: number[]; margin: number[] };
}
export interface DcfFoundation {
  base: DcfBase;
  basePeriod: { label: string; end: string };
  startMargin: number;
  marginNote: string | null;
  shareNote: string;
  issues: string[];
  amortization: number | null;
  otherClaims: number;
  reconciliation: { modeled: number; cashFlowProxy: number | null; residual: number | null; note: string };
  now: { growth: number | null; capex: number | null; depreciation: number | null };
  record: {
    growth3: number | null; growth5: number | null; growth10: number | null;
    margin5: number | null; marginHigh: number | null; tax5: number | null;
    capex5: number | null; depreciation5: number | null; workingCapital5: number | null;
    dilution5: number | null; capex10: number | null; costOfDebt: number | null;
    roic5: number | null; salesToCapital: number | null;
    years: Array<{ label: string; end: string; revenue: number | null; freeCashFlow: number | null }>;
  };
}
const known = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const at = (p: IoPeriod | undefined, key: string) => known(p?.values[key]) ? p!.values[key]! : null;
const mean = (v: Array<number | null>) => { const a = v.filter(known); return a.length ? a.reduce((s, n) => s + n, 0) / a.length : null; };
const median = (v: Array<number | null>) => { const a = v.filter(known).sort((a, b) => a - b); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null; };
const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.2425 * 86400000);
function latestOf(view: IoCompanyView): IoPeriod | undefined {
  return [...view.annual, ...view.trailing].sort((a, b) => a.end.localeCompare(b.end)).at(-1);
}
function operatingOf(p: IoPeriod | undefined): { value: number; derived: boolean } | null {
  const operating = at(p, "operatingIncome");
  const approximate = /income before tax.*interest|pre-tax.*interest/i.test(p?.basis?.operatingIncome ?? "");
  if (known(operating) && !approximate) return { value: operating, derived: false };
  const pretax = at(p, "incomeBeforeTax"), other = at(p, "otherIncomeExpense");
  // Nonoperating gains must not become an operating margin. All bridge components are required.
  return known(pretax) && known(other) ? { value: pretax - other, derived: true } : null;
}
function normalizedOperating(p: IoPeriod | undefined): number | null {
  const op = operatingOf(p);
  return op ? op.value + Math.max(0, at(p, "intangibleAmortization") ?? 0) : null;
}
function depreciationOf(p: IoPeriod | undefined): number | null {
  const physical = at(p, "depreciation");
  if (known(physical)) return physical;
  const total = at(p, "depreciationAndAmortization"), amort = at(p, "intangibleAmortization");
  if (known(total) && known(amort) && total >= amort) return total - amort;
  return known(amort) ? null : total;
}
/** Required observations are never substituted with zero or mixed across annual and TTM flows. */
export function dcfMissingInputs(view: IoCompanyView): string[] {
  if (balanceSheetIsTheBusiness(view.company.businessType as BusinessType | undefined)) return ["an equity valuation suited to financial institutions; industrial FCFF does not describe their balance sheets"];
  if (view.dcfDataStatus === "rebuilding") return ["the updated normalization (the previous statements remain visible while it rebuilds)"];
  const p = latestOf(view);
  if (!p) return ["a current financial period"];
  if (view.company.currency && p.currency !== view.company.currency) return ["a base period in the company's reporting currency"];
  const missing: string[] = [];
  if (!(at(p, "revenue")! > 0)) missing.push("positive revenue");
  if (!operatingOf(p)) missing.push("operating income (or pre-tax income less a complete nonoperating subtotal)");
  if (!(at(p, "dilutedShares")! > 0)) missing.push("diluted shares");
  if (at(p, "cashAndEquivalents") == null) missing.push("cash");
  if (at(p, "totalDebt") == null) missing.push("debt, including a reported zero when debt-free");
  if (at(p, "capitalExpenditures") == null) missing.push("capital expenditure");
  if (depreciationOf(p) == null) missing.push("depreciation and amortization");
  return missing;
}
export function dcfFoundation(view: IoCompanyView): DcfFoundation | null {
  if (dcfMissingInputs(view).length) return null;
  const p = latestOf(view)!;
  const annual = view.annual.filter(y => y.currency === p.currency).sort((a, b) => a.end.localeCompare(b.end));
  const revenue = at(p, "revenue")!;
  const operating = operatingOf(p)!;
  const amortization = at(p, "intangibleAmortization");
  const startMargin = normalizedOperating(p)! / revenue;
  const issues: string[] = [];
  if (yearsBetween(p.end, view.retrievedAt ?? p.end) > 1.5) issues.push("The latest usable financial period is more than 18 months old. This is a historical base, not a current operating forecast.");
  if (p.basis?.totalDebt) issues.push(`Debt boundary: ${p.basis.totalDebt}`);
  const investments = at(p, "shortTermInvestments");
  if (investments == null) issues.push("Short-term financial investments are not reported separately; the equity bridge includes observed cash only.");
  const cash = at(p, "cashAndEquivalents")! + Math.max(0, investments ?? 0);
  const debt = at(p, "totalDebt")!;
  const diluted = at(p, "dilutedShares")!;
  const basic = at(p, "basicShares"), outstanding = at(p, "sharesOutstanding");
  // A same-period point count plus the observed treasury-stock dilution increment.
  // Weighted diluted shares are an explicitly labelled proxy where this bridge is unavailable.
  const pointBasis = known(outstanding) && outstanding > 0 && known(basic) && basic > 0;
  const shares = pointBasis ? outstanding + Math.max(0, diluted - basic) : diluted;
  const shareNote = pointBasis ? "Period-end outstanding shares plus the observed diluted-minus-basic award increment; a proxy for outstanding awards, not a full option valuation." : "Diluted weighted-average shares; a proxy for today's fully diluted count.";
  if (!pointBasis) issues.push(shareNote);
  if (!known(amortization)) issues.push("No separate intangible-amortization line is available. The operating margin and D&A remain on their filed aggregate basis.");
  if (p.basis?.depreciationAndAmortization) issues.push(`D&A basis: ${p.basis.depreciationAndAmortization}`);
  if (operating.derived) issues.push("Operating income is derived from pre-tax income less the aggregate nonoperating result, which already includes interest.");
  const basis = p.operatingWorkingCapitalBasis;
  if (basis) issues.push(...basis.issues);
  else issues.push("Operating working capital coverage is unavailable in this dataset. Its forecast uses an explicit assumption until the data is refreshed.");
  const ofRevenue = (key: string, physical = false) => {
    const value = physical ? depreciationOf(p) : at(p, key);
    return known(value) ? Math.abs(value) / revenue : null;
  };
  const share = (key: string, n = 5) => annual.slice(-n).map(y => {
    const value = key === "depreciationAndAmortization" ? depreciationOf(y) : at(y, key), r = at(y, "revenue");
    return known(value) && r! > 0 ? Math.abs(value) / r! : null;
  });
  const cagr = (n: number) => {
    const end = annual.at(-1);
    if (!end) return null;
    const begin = annual.find(y => Math.abs(yearsBetween(y.end, end.end) - n) < 0.25);
    const a = at(begin, "revenue"), b = at(end, "revenue");
    return a! > 0 && b! > 0 && begin ? (b! / a!) ** (1 / yearsBetween(begin.end, end.end)) - 1 : null;
  };
  const margins = annual.slice(-10).map(y => { const v = normalizedOperating(y), r = at(y, "revenue"); return v != null && r! > 0 ? v / r! : null; });
  const working = annual.slice(-6).map((y, i, list) => {
    const before = list[i - 1], now = at(y, "operatingWorkingCapital"), prior = at(before, "operatingWorkingCapital"), r = at(y, "revenue");
    return before && Math.abs(yearsBetween(before.end, y.end) - 1) < .15 && known(now) && known(prior) && r! > 0 ? (now - prior) / r! : null;
  });
  const dilution = annual.slice(-6).map((y, i, list) => { const a = at(list[i - 1], "dilutedShares"), b = at(y, "dilutedShares"); return a! > 0 && b! > 0 && Math.abs(yearsBetween(list[i - 1].end, y.end) - 1) < .15 ? b! / a! - 1 : null; });
  // Operating capital excludes cash and observed financial investments. Acquisition goodwill remains capital paid for.
  const capital = (y: IoPeriod | undefined) => {
    const e = at(y, "totalEquity"), d = at(y, "totalDebt"), c = at(y, "cashAndEquivalents");
    if (!known(e) || !known(d) || !known(c)) return null;
    const minority = y?.equityIncludesMinorities ? 0 : Math.max(0, at(y, "minorityInterest") ?? 0);
    const v = e + d + minority + Math.max(0, at(y, "temporaryEquity") ?? 0) - c - Math.max(0, at(y, "shortTermInvestments") ?? 0);
    const assets = at(y, "totalAssets");
    return v > 0 && (assets == null || v >= .05 * assets) ? v : null;
  };
  const efficiency = annual.slice(-6).map((y, i, list) => {
    const a = capital(list[i - 1]), b = capital(y), r = at(y, "revenue");
    return known(a) && known(b) && r! > 0 && Math.abs(yearsBetween(list[i - 1].end, y.end) - 1) < .15 ? r! / ((a + b) / 2) : null;
  });
  const salesToCapital = median(efficiency);
  if (salesToCapital == null) issues.push("A reliable sales-to-operating-capital history is unavailable. Reinvestment defaults to observed spending ratios; review the growth those ratios can support.");
  const historicalTaxes = annual.slice(-5).map(y => { const t = at(y, "effectiveTaxRate"); return t != null && t >= 0 && t <= .5 ? t : null; });
  const tax = median(historicalTaxes);
  if (tax == null) issues.push("Tax defaults to an assumed 21%; no usable historical effective tax rate is available.");
  const yearAgo = [...view.trailing, ...annual].find(y => y.currency === p.currency && Math.abs(yearsBetween(y.end, p.end) - 1) < .06);
  const previousRevenue = at(yearAgo, "revenue");
  const otherClaims = Math.max(0, at(p, "minorityInterest") ?? 0) + Math.max(0, at(p, "temporaryEquity") ?? 0);
  if (at(p, "minorityInterest") == null || at(p, "temporaryEquity") == null) issues.push("Only separately reported minority interests and temporary equity are deducted. Review preferred stock, options, pensions and other claims before relying on the equity value.");
  const depreciation = depreciationOf(p)!;
  const capex = Math.abs(at(p, "capitalExpenditures")!);
  const workingRate = median(working);
  const modeled = Math.max(operating.value + (amortization ?? 0), 0) * (1 - (tax ?? .21)) + Math.min(operating.value + (amortization ?? 0), 0) + depreciation - capex - revenue * (workingRate ?? .01);
  const ocf = at(p, "operatingCashFlow"), sbc = at(p, "stockBasedCompensation"), interest = at(p, "interestExpense");
  const cashFlowProxy = known(ocf) && known(sbc) && known(interest) ? ocf - capex - Math.abs(sbc) + Math.abs(interest) * (1 - (tax ?? .21)) : null;
  return {
    base: { revenue, operatingMargin: startMargin, freeCashFlow: at(p, "freeCashFlow") ?? 0, dilutedShares: shares, cash, debt },
    basePeriod: { label: p.label, end: p.end }, startMargin, shareNote, issues, amortization, otherClaims,
    marginNote: known(amortization) ? "Before separately reported intangible amortization; employee stock compensation remains an expense. No future amortization tax shield is assumed." : operating.derived ? "Operating income derived from pre-tax income less the aggregate nonoperating result." : null,
    reconciliation: { modeled, cashFlowProxy, residual: cashFlowProxy == null ? null : modeled - cashFlowProxy, note: "Diagnostic bridge only: CFO − capex − SBC + interest after assumed tax, versus normalized operating FCFF. Cash/deferred taxes, leases, other noncash items and actual working-capital movements explain differences; this is not a certified tie-out." },
    now: { growth: previousRevenue! > 0 ? revenue / previousRevenue! - 1 : null, capex: capex / revenue, depreciation: ofRevenue("depreciationAndAmortization", true) },
    record: {
      growth3: cagr(3), growth5: cagr(5), growth10: cagr(10), margin5: mean(margins.slice(-5)), marginHigh: margins.filter(known).length ? Math.max(...margins.filter(known)) : null,
      tax5: tax, capex5: median(share("capitalExpenditures")), depreciation5: median(share("depreciationAndAmortization")), workingCapital5: workingRate,
      dilution5: mean(dilution), capex10: median(share("capitalExpenditures", 10)), salesToCapital,
      costOfDebt: known(interest) && debt > 0 ? Math.abs(interest) / debt : null,
      roic5: median(annual.slice(-5).map(y => at(y, "roic"))),
      years: annual.slice(-6).map(y => ({ label: y.label, end: y.end, revenue: at(y, "revenue"), freeCashFlow: at(y, "freeCashFlow") })),
    },
  };
}
export function weightedCost(equityCost: number, debtCost: number | null, tax: number, marketCap: number | null, debt: number): number {
  if (!known(marketCap) || marketCap <= 0 || debt <= 0) return equityCost;
  return (marketCap * equityCost + debt * (debtCost ?? .05) * (1 - tax)) / (marketCap + debt);
}
export function defaultDrivers(f: DcfFoundation, costOfEquity: number | null, marketCap: number | null, riskFree: number | null = null): Drivers {
  const record = f.record;
  const historical = record.growth3 ?? record.growth5 ?? .05;
  const recent = f.now.growth == null ? historical : .6 * f.now.growth + .4 * historical;
  const growthStart = clamp(recent, -.3, 1);
  const longer = record.growth5 ?? record.growth10 ?? historical;
  const taxRate = record.tax5 ?? .21;
  const wacc = weightedCost(costOfEquity ?? .09, record.costOfDebt, taxRate, marketCap, f.base.debt);
  return {
    growthStart, growthEnd: clamp(Math.min(growthStart, (longer + .03) / 2 + .02), -.15, .5),
    marginTarget: clamp(f.startMargin, -.5, .9), taxRate, terminalTaxRate: taxRate,
    capex: record.capex5 ?? f.now.capex!, depreciation: f.now.depreciation!, workingCapital: record.workingCapital5 ?? .01,
    dilution: 0, wacc, terminalMethod: "perpetual-growth", terminalGrowth: terminalGrowthFor(riskFree), exitMultiple: 18,
    fadeYears: 5, terminalExcessReturn: 0,
    reinvestmentMethod: record.salesToCapital != null ? "capital-efficiency" : "reported-ratios",
    salesToCapital: record.salesToCapital ?? 1, otherClaims: f.otherClaims,
  };
}
export type Scenario = "bear" | "base" | "bull";
export function scenarioDrivers(base: Drivers, scenario: Scenario): Drivers {
  if (scenario === "base") return base;
  const sign = scenario === "bull" ? 1 : -1;
  const growthStep = Math.max(.03, Math.abs(base.growthStart) * .2);
  const marginStep = Math.max(.005, Math.min(.03, Math.abs(base.marginTarget) * .2));
  return { ...base, growthStart: base.growthStart + sign * growthStep, growthEnd: base.growthEnd + sign * Math.max(.02, Math.abs(base.growthEnd) * .2),
    marginTarget: base.marginTarget + sign * marginStep,
    // Business cases share financing assumptions. Rate and terminal uncertainties have their own sensitivity grid.
    salesToCapital: base.salesToCapital * (1 + sign * .1),
    research: base.research ? { growth: base.research.growth.map(g => g + sign * growthStep), margin: base.research.margin.map(m => m + sign * marginStep) } : undefined };
}
export function forecastYears(d: Drivers): number { return STAGE_ONE + Math.round(clamp(d.fadeYears, 1, 15)); }
export function assumptionsFrom(d: Drivers, f: DcfFoundation): DcfAssumptions {
  const years = forecastYears(d);
  const landing = d.terminalMethod === "perpetual-growth" ? d.terminalGrowth : Math.min(d.growthEnd, .04);
  const fifthGrowth = d.research?.growth[4] ?? d.growthEnd;
  const fifthMargin = d.research?.margin[4] ?? d.marginTarget;
  const growth = Array.from({ length: years }, (_, i) => i < STAGE_ONE
    ? d.research?.growth[i] ?? d.growthStart + (d.growthEnd - d.growthStart) * i / (STAGE_ONE - 1)
    : fifthGrowth + (landing - fifthGrowth) * (i - STAGE_ONE + 1) / (years - STAGE_ONE));
  const margin = Array.from({ length: years }, (_, i) => i < STAGE_ONE ? d.research?.margin[i] ?? f.startMargin + (d.marginTarget - f.startMargin) * (i + 1) / STAGE_ONE : fifthMargin);
  const tax = Array.from({ length: years }, (_, i) => i < STAGE_ONE ? d.taxRate : d.taxRate + (d.terminalTaxRate - d.taxRate) * (i - STAGE_ONE + 1) / (years - STAGE_ONE));
  const repeat = (v: number) => Array.from({ length: years }, () => v);
  const path = (now: number | null, target: number) => Array.from({ length: years }, (_, i) => (now ?? target) + (target - (now ?? target)) * Math.min(1, i / 4));
  const depreciation = path(f.now.depreciation, d.depreciation);
  const working = repeat(d.workingCapital);
  const roic = d.wacc + d.terminalExcessReturn;
  let revenue = f.base.revenue;
  const capex = path(f.now.capex, d.capex);
  const reinvestment = capex.map((ratio, i) => {
    const before = revenue; revenue *= 1 + growth[i];
    const nopat = Math.max(revenue * margin[i], 0) * (1 - tax[i]) + Math.min(revenue * margin[i], 0);
    const reported = revenue * (ratio - depreciation[i] + working[i]);
    const efficient = (revenue - before) / d.salesToCapital;
    // A contraction does not automatically liquidate assets and release cash.
    const initial = d.reinvestmentMethod === "capital-efficiency" ? Math.max(0, efficient) : reported;
    const terminal = nopat * landing / roic;
    const fade = i < STAGE_ONE ? 0 : (i - STAGE_ONE + 1) / (years - STAGE_ONE);
    return (initial + (terminal - initial) * fade) / revenue;
  });
  return { method: "fcff", terminalMethod: d.terminalMethod, forecastYears: years,
    revenueGrowth: growth, operatingMargin: margin, taxRate: tax, depreciationPercentRevenue: depreciation,
    capexPercentRevenue: capex, workingCapitalPercentRevenue: working, directFcfMargin: repeat(0),
    shareChange: repeat(d.dilution), wacc: d.wacc, terminalGrowth: d.terminalGrowth, exitMultiple: d.exitMultiple,
    otherClaims: d.otherClaims,
    netReinvestmentPercentRevenue: reinvestment,
    // An independently normalized year N+1, not the final transition year's cash flow carried forward blindly.
    terminalReturnOnCapital: roic, terminalTaxRate: d.terminalTaxRate,
    stockCompensationTreatment: d.dilution > 0 ? "additional-dilution" : "expensed",
  };
}
export function valueWith(f: DcfFoundation, d: Drivers): DcfResult {
  const a = assumptionsFrom(d, f);
  const result = calculateDcf(f.base, a);
  if (d.reinvestmentMethod === "capital-efficiency" && !(d.salesToCapital > 0)) {
    result.warnings.push("Sales-to-capital must be positive."); result.enterpriseValue = result.equityValue = result.intrinsicValuePerShare = null;
  }
  return result;
}
export function impliedGrowth(f: DcfFoundation, d: Drivers, price: number): number | null {
  if (!(price > 0)) return null;
  const valueAt = (g: number) => valueWith(f, { ...d, growthStart: g, growthEnd: g, research: d.research ? { ...d.research, growth: Array(5).fill(g) } : undefined }).intrinsicValuePerShare;
  // Investment can make value nonmonotonic in growth. Find all sign-changing
  // intervals first and refuse a misleading single answer when there are several.
  const brackets: Array<[number, number]> = [];
  let previous: { g: number; value: number } | null = null;
  for (let i = 0; i <= 120; i++) {
    const g = -.3 + 1.8 * i / 120, value = valueAt(g);
    if (value == null || !Number.isFinite(value)) { previous = null; continue; }
    if (previous && (previous.value - price) * (value - price) < 0) brackets.push([previous.g, g]);
    if (Math.abs(value - price) < 1e-9) brackets.push([g, g]);
    previous = { g, value };
  }
  if (brackets.length !== 1) return null;
  let [low, high] = brackets[0];
  const left = valueAt(low)! - price;
  for (let i = 0; i < 60 && high > low; i++) {
    const m = (low + high) / 2, value = valueAt(m);
    if (value == null) return null;
    if ((value - price) * left > 0) low = m; else high = m;
  }
  return (low + high) / 2;
}
export function sensitivityGrid(f: DcfFoundation, d: Drivers, rows: { key: keyof Drivers; values: number[] }, columns: { key: keyof Drivers; values: number[] }): Array<Array<number | null>> {
  return rows.values.map(row => columns.values.map(column => {
    const next = { ...d, [rows.key]: row, [columns.key]: column } as Drivers;
    for (const [key, value] of [[rows.key, row], [columns.key, column]] as const) {
      if (key === "growthStart") { const delta = value - d.growthStart; next.growthEnd = d.growthEnd + delta; if (next.research) next.research = { ...next.research, growth: d.research!.growth.map(g => g + delta) }; }
      if (key === "marginTarget" && next.research) next.research = { ...next.research, margin: d.research!.margin.map(m => m + value - d.marginTarget) };
    }
    return valueWith(f, next).intrinsicValuePerShare;
  }));
}

/* ---- Lenders ------------------------------------------------------------ */

export interface JustifiedBook {
  bookPerShare: number;
  roe: number;
  costOfEquity: number;
  growth: number;
  /** (ROE − g) / (r − g). */
  multiple: number;
  value: number;
}

/**
 * A lender's value as a multiple of its book: a bank earning its cost of equity
 * is worth its book, one earning more is worth more, in proportion to the
 * spread it keeps earning as it grows.
 */
export function justifiedBook(view: IoCompanyView, costOfEquity: number, growth = 0.03): JustifiedBook | null {
  const latest = view.annual.at(-1);
  const equity = at(latest, "totalEquity");
  const shares = at(latest, "dilutedShares");
  const roe = mean(view.annual.slice(-5).map((period) => at(period, "returnOnEquity")));
  if (!known(equity) || equity <= 0 || !known(shares) || shares <= 0 || !known(roe) || costOfEquity <= growth) return null;
  const multiple = Math.max(0, (roe - growth) / (costOfEquity - growth));
  const bookPerShare = equity / shares;
  return { bookPerShare, roe, costOfEquity, growth, multiple, value: multiple * bookPerShare };
}
